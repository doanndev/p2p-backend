import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
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
import { User } from '../users/entities/user.entity';
import { Admin } from '../admins/entities/admin.entity';
import { SupportChatActor } from './support-chat.types';
import { SupportChatService } from './support-chat.service';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConversationRoomDto } from './dto/conversation-room.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  SupportChatMessageType,
  SupportChatSenderType,
  SupportChatSystemEventType,
} from './entities/support-chat-message.entity';
import { ADMIN_SUPPORT_INBOX_ROOM } from './support-chat-inbox.constants';
import {
  AuthenticatedSocket,
  createSocketAuthMiddleware,
} from '../common/middlewares/socket-auth.middleware';

type SupportSocket = AuthenticatedSocket &
  Socket & { actor: SupportChatActor; user_id: number };

function supportRoomName(conversationId: number) {
  return `conversation:${conversationId}`;
}

@WebSocketGateway({
  namespace: '/support-chat',
  cors: {
    origin: true, // Cho phép tất cả origins (middleware sẽ xác thực)
    credentials: true,
  },
})
export class SupportChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
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

  afterInit(server: Server) {
    server.use(
      createSocketAuthMiddleware({
        jwtService: this.jwtService,
        configService: this.configService,
        userRepository: this.userRepository,
        adminRepository: this.adminRepository,
        includeEntityOnActor: true,
        logger: this.logger,
      }),
    );
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

      this.logger.debug(
        `[connection:auth-input] ${JSON.stringify({
          ...this.socketMeta(client),
          hasAuthAccessToken: Boolean(client.handshake.auth?.access_token),
          hasAuthAdminAccessToken: Boolean(
            client.handshake.auth?.admin_access_token,
          ),
          hasCookieHeader: Boolean(client.handshake.headers?.cookie),
          userId: client.user_id,
        })}`,
      );
      this.logger.log(
        `[connection:ok] ${JSON.stringify({
          ...this.socketMeta(client),
          userId: client.user_id,
        })}`,
      );

      if (client.actor?.type === 'admin') {
        await client.join(ADMIN_SUPPORT_INBOX_ROOM);
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
    await this.supportChatService.assertCanAccessConversation(
      client.actor,
      body.conversationId,
    );
    await client.join(supportRoomName(body.conversationId));

    const skipSystemEvent =
      Boolean(body.silent) && client.actor.type === 'admin';
    if (!skipSystemEvent) {
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
    }
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
    await this.supportChatService.assertCanAccessConversation(
      client.actor,
      body.conversationId,
    );
    await client.leave(supportRoomName(body.conversationId));

    const skipSystemEvent =
      Boolean(body.silent) && client.actor.type === 'admin';
    if (!skipSystemEvent) {
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
    }
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
        hasImageUrl: Boolean(body?.imageUrl?.trim?.()),
      })}`,
    );
    const message = await this.supportChatService.saveUserOrAdminMessage(
      client.actor,
      body.conversationId,
      body.content,
      body.imageUrl,
    );
    await client.join(supportRoomName(body.conversationId));
    this.server
      .to(supportRoomName(body.conversationId))
      .emit('receive_message', message);

    if (
      message.sender_type === SupportChatSenderType.USER &&
      message.message_type !== SupportChatMessageType.SYSTEM_EVENT
    ) {
      await this.emitAdminSupportInboxUpdate(body.conversationId, message);
    }

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

    if (client.actor.type === 'admin') {
      await this.emitAdminSupportUnreadSummary();
    }

    this.logger.debug(
      `[event:seen:ok] ${JSON.stringify({
        ...this.socketMeta(client),
        conversationId: body.conversationId,
      })}`,
    );
    return { ok: true };
  }

  /** Tin user mới → notify mọi admin đang online (room inbox). */
  private async emitAdminSupportInboxUpdate(
    conversationId: number,
    message: Record<string, unknown>,
  ) {
    const summary = await this.supportChatService.getAdminUnreadSummary();
    const convUnread = summary.data.byConversation[conversationId] ?? 0;
    const content = String(message.content ?? '');
    const preview =
      message.message_type === SupportChatMessageType.IMAGE
        ? '[image]'
        : content.length > 120
          ? `${content.slice(0, 120)}…`
          : content;

    this.server.to(ADMIN_SUPPORT_INBOX_ROOM).emit('support_message_pending', {
      conversationId,
      message,
      preview,
      conversationUnread: convUnread,
      totalUnread: summary.data.total,
    });
  }

  private async emitAdminSupportUnreadSummary() {
    const summary = await this.supportChatService.getAdminUnreadSummary();
    this.server
      .to(ADMIN_SUPPORT_INBOX_ROOM)
      .emit('support_unread_updated', summary.data);
  }

  emitConversationClosed(
    conversationId: number,
    payload?: Record<string, unknown>,
  ) {
    this.server
      .to(supportRoomName(conversationId))
      .emit('conversation_closed', { conversationId, ...(payload || {}) });
    void this.emitAdminSupportUnreadSummary();
  }
}
