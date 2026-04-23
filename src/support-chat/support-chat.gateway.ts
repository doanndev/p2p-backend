import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { User, UserStatus } from '../users/entities/user.entity';
import { Admin, AdminStatus } from '../admins/entities/admin.entity';
import { SupportChatActor } from './support-chat.types';
import { SupportChatService } from './support-chat.service';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConversationRoomDto } from './dto/conversation-room.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SupportChatSystemEventType } from './entities/support-chat-message.entity';

type SupportSocket = Socket & { actor?: SupportChatActor };

function parseCookie(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k || rest.length === 0) return acc;
    acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function supportRoomName(conversationId: number) {
  return `conversation:${conversationId}`;
}

@WebSocketGateway({
  namespace: '/support-chat',
  cors: { origin: true, credentials: true },
})
export class SupportChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(SupportChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly supportChatService: SupportChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
  ) {}

  private maskToken(token?: string): string | null {
    if (!token) return null;
    if (token.length <= 20) return token;
    return `${token.slice(0, 10)}...${token.slice(-6)}`;
  }

  private socketMeta(client: SupportSocket) {
    return {
      socketId: client.id,
      namespace: client.nsp?.name,
      actorType: client.actor?.type,
      actorId: client.actor?.id,
    };
  }

  async handleConnection(client: SupportSocket) {
    try {
      this.logger.debug(
        `[connection:start] ${JSON.stringify({
          ...this.socketMeta(client),
          query: client.handshake.query,
          origin: client.handshake.headers?.origin,
          hasCookieHeader: Boolean(client.handshake.headers?.cookie),
        })}`,
      );

      const cookieHeader =
        (client.handshake.headers?.cookie as string | undefined) ?? undefined;
      const cookies = parseCookie(cookieHeader);

      const userToken =
        (client.handshake.auth?.access_token as string | undefined) ||
        cookies['access_token'];
      const adminToken =
        (client.handshake.auth?.admin_access_token as string | undefined) ||
        cookies['admin_access_token'];
      const token = adminToken || userToken;

      this.logger.debug(
        `[connection:auth-input] ${JSON.stringify({
          ...this.socketMeta(client),
          hasAuthAccessToken: Boolean(client.handshake.auth?.access_token),
          hasAuthAdminAccessToken: Boolean(
            client.handshake.auth?.admin_access_token,
          ),
          hasCookieAccessToken: Boolean(cookies['access_token']),
          hasCookieAdminAccessToken: Boolean(cookies['admin_access_token']),
          token: this.maskToken(token),
          userToken: this.maskToken(userToken),
          adminToken: this.maskToken(adminToken),
        })}`,
      );

      if (!token) {
        this.logger.warn(
          `[connection:reject:no-token] ${JSON.stringify(this.socketMeta(client))}`,
        );
        client.disconnect(true);
        return;
      }

      const secret =
        this.configService.get<string>('JWT_SECRET') || 'your-secret-key';
      const payload: any = await this.jwtService.verifyAsync(token, { secret });
      const actorId = Number(payload?.sub);
      this.logger.debug(
        `[connection:token-verified] ${JSON.stringify({
          ...this.socketMeta(client),
          actorId,
          isAdminToken: Boolean(adminToken),
          payloadSub: payload?.sub,
        })}`,
      );

      if (!actorId) {
        this.logger.warn(
          `[connection:reject:invalid-sub] ${JSON.stringify({
            ...this.socketMeta(client),
            payloadSub: payload?.sub,
          })}`,
        );
        client.disconnect(true);
        return;
      }

      if (adminToken) {
        const admin = await this.adminRepository.findOne({
          where: { admin_id: actorId },
        });
        if (!admin || admin.admin_status !== AdminStatus.ACTIVE) {
          this.logger.warn(
            `[connection:reject:admin-invalid] ${JSON.stringify({
              ...this.socketMeta(client),
              actorId,
              adminFound: Boolean(admin),
              adminStatus: admin?.admin_status,
            })}`,
          );
          client.disconnect(true);
          return;
        }
        client.actor = { type: 'admin', id: admin.admin_id, admin };
        this.logger.log(
          `[connection:ok] ${JSON.stringify({
            ...this.socketMeta(client),
            adminStatus: admin.admin_status,
          })}`,
        );
      } else {
        const user = await this.userRepository.findOne({
          where: { uid: actorId },
        });
        if (!user || user.ustatus === UserStatus.BLOCK) {
          this.logger.warn(
            `[connection:reject:user-invalid] ${JSON.stringify({
              ...this.socketMeta(client),
              actorId,
              userFound: Boolean(user),
              userStatus: user?.ustatus,
            })}`,
          );
          client.disconnect(true);
          return;
        }
        client.actor = { type: 'user', id: user.uid, user };
        this.logger.log(
          `[connection:ok] ${JSON.stringify({
            ...this.socketMeta(client),
            userStatus: user.ustatus,
          })}`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `[connection:error] ${JSON.stringify({
          ...this.socketMeta(client),
          name: error?.name,
          message: error?.message,
        })}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: SupportSocket) {
    this.logger.log(
      `[connection:disconnect] ${JSON.stringify(this.socketMeta(client))}`,
    );
    void client;
  }

  @SubscribeMessage('join_conversation')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async joinConversation(
    @ConnectedSocket() client: SupportSocket,
    @MessageBody() body: ConversationRoomDto,
  ) {
    this.logger.debug(
      `[event:join_conversation:start] ${JSON.stringify({
        ...this.socketMeta(client),
        conversationId: body?.conversationId,
      })}`,
    );
    if (!client.actor) {
      this.logger.warn(
        `[event:join_conversation:unauthorized] ${JSON.stringify(this.socketMeta(client))}`,
      );
      return { ok: false, error: 'unauthorized' };
    }
    await this.supportChatService.assertCanAccessConversation(
      client.actor,
      body.conversationId,
    );
    await client.join(supportRoomName(body.conversationId));

    const systemMessage = await this.supportChatService.saveSystemEvent(
      client.actor,
      body.conversationId,
      client.actor.type === 'admin'
        ? SupportChatSystemEventType.ADMIN_JOINED
        : SupportChatSystemEventType.USER_JOINED,
    );
    client
      .to(supportRoomName(body.conversationId))
      .emit('receive_message', systemMessage);
    this.logger.debug(
      `[event:join_conversation:ok] ${JSON.stringify({
        ...this.socketMeta(client),
        conversationId: body.conversationId,
      })}`,
    );
    return { ok: true };
  }

  @SubscribeMessage('leave_conversation')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async leaveConversation(
    @ConnectedSocket() client: SupportSocket,
    @MessageBody() body: ConversationRoomDto,
  ) {
    this.logger.debug(
      `[event:leave_conversation:start] ${JSON.stringify({
        ...this.socketMeta(client),
        conversationId: body?.conversationId,
      })}`,
    );
    if (!client.actor) {
      this.logger.warn(
        `[event:leave_conversation:unauthorized] ${JSON.stringify(this.socketMeta(client))}`,
      );
      return { ok: false, error: 'unauthorized' };
    }
    await this.supportChatService.assertCanAccessConversation(
      client.actor,
      body.conversationId,
    );
    await client.leave(supportRoomName(body.conversationId));

    const systemMessage = await this.supportChatService.saveSystemEvent(
      client.actor,
      body.conversationId,
      client.actor.type === 'admin'
        ? SupportChatSystemEventType.ADMIN_LEFT
        : SupportChatSystemEventType.USER_LEFT,
    );
    client
      .to(supportRoomName(body.conversationId))
      .emit('receive_message', systemMessage);
    this.logger.debug(
      `[event:leave_conversation:ok] ${JSON.stringify({
        ...this.socketMeta(client),
        conversationId: body.conversationId,
      })}`,
    );
    return { ok: true };
  }

  @SubscribeMessage('send_message')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async sendMessage(
    @ConnectedSocket() client: SupportSocket,
    @MessageBody() body: SendMessageDto,
  ) {
    this.logger.debug(
      `[event:send_message:start] ${JSON.stringify({
        ...this.socketMeta(client),
        conversationId: body?.conversationId,
        contentLength: body?.content?.length ?? 0,
      })}`,
    );
    if (!client.actor) {
      this.logger.warn(
        `[event:send_message:unauthorized] ${JSON.stringify(this.socketMeta(client))}`,
      );
      return { ok: false, error: 'unauthorized' };
    }
    const message = await this.supportChatService.saveUserOrAdminMessage(
      client.actor,
      body.conversationId,
      body.content,
    );
    await client.join(supportRoomName(body.conversationId));
    this.server
      .to(supportRoomName(body.conversationId))
      .emit('receive_message', message);
    this.logger.debug(
      `[event:send_message:ok] ${JSON.stringify({
        ...this.socketMeta(client),
        conversationId: body.conversationId,
        messageId: (message as any)?.id,
      })}`,
    );
    return { ok: true, message };
  }

  @SubscribeMessage('typing')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async typing(
    @ConnectedSocket() client: SupportSocket,
    @MessageBody() body: ConversationRoomDto,
  ) {
    if (!client.actor) {
      this.logger.warn(
        `[event:typing:unauthorized] ${JSON.stringify(this.socketMeta(client))}`,
      );
      return { ok: false, error: 'unauthorized' };
    }
    await this.supportChatService.assertCanAccessConversation(
      client.actor,
      body.conversationId,
    );
    client.to(supportRoomName(body.conversationId)).emit('typing', {
      conversationId: body.conversationId,
      actorType: client.actor.type,
      actorId: client.actor.id,
    });
    this.logger.debug(
      `[event:typing:ok] ${JSON.stringify({
        ...this.socketMeta(client),
        conversationId: body.conversationId,
      })}`,
    );
    return { ok: true };
  }

  @SubscribeMessage('stop_typing')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async stopTyping(
    @ConnectedSocket() client: SupportSocket,
    @MessageBody() body: ConversationRoomDto,
  ) {
    if (!client.actor) {
      this.logger.warn(
        `[event:stop_typing:unauthorized] ${JSON.stringify(this.socketMeta(client))}`,
      );
      return { ok: false, error: 'unauthorized' };
    }
    await this.supportChatService.assertCanAccessConversation(
      client.actor,
      body.conversationId,
    );
    client.to(supportRoomName(body.conversationId)).emit('stop_typing', {
      conversationId: body.conversationId,
      actorType: client.actor.type,
      actorId: client.actor.id,
    });
    this.logger.debug(
      `[event:stop_typing:ok] ${JSON.stringify({
        ...this.socketMeta(client),
        conversationId: body.conversationId,
      })}`,
    );
    return { ok: true };
  }

  @SubscribeMessage('seen')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async seen(
    @ConnectedSocket() client: SupportSocket,
    @MessageBody() body: ConversationRoomDto,
  ) {
    if (!client.actor) {
      this.logger.warn(
        `[event:seen:unauthorized] ${JSON.stringify(this.socketMeta(client))}`,
      );
      return { ok: false, error: 'unauthorized' };
    }
    await this.supportChatService.markConversationSeen(
      client.actor,
      body.conversationId,
    );
    client.to(supportRoomName(body.conversationId)).emit('seen', {
      conversationId: body.conversationId,
      actorType: client.actor.type,
      actorId: client.actor.id,
      seenAt: new Date(),
    });
    this.logger.debug(
      `[event:seen:ok] ${JSON.stringify({
        ...this.socketMeta(client),
        conversationId: body.conversationId,
      })}`,
    );
    return { ok: true };
  }

  emitConversationClosed(
    conversationId: number,
    payload?: Record<string, unknown>,
  ) {
    this.server
      .to(supportRoomName(conversationId))
      .emit('conversation_closed', { conversationId, ...(payload || {}) });
  }
}
