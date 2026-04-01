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
import { UsePipes, ValidationPipe } from '@nestjs/common';
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

  async handleConnection(client: SupportSocket) {
    try {
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

      if (!token) {
        client.disconnect(true);
        return;
      }

      const secret =
        this.configService.get<string>('JWT_SECRET') || 'your-secret-key';
      const payload: any = await this.jwtService.verifyAsync(token, { secret });
      const actorId = Number(payload?.sub);
      if (!actorId) {
        client.disconnect(true);
        return;
      }

      if (adminToken) {
        const admin = await this.adminRepository.findOne({
          where: { admin_id: actorId },
        });
        if (!admin || admin.admin_status !== AdminStatus.ACTIVE) {
          client.disconnect(true);
          return;
        }
        client.actor = { type: 'admin', id: admin.admin_id, admin };
      } else {
        const user = await this.userRepository.findOne({
          where: { uid: actorId },
        });
        if (!user || user.ustatus === UserStatus.BLOCK) {
          client.disconnect(true);
          return;
        }
        client.actor = { type: 'user', id: user.uid, user };
      }
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: SupportSocket) {
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
    if (!client.actor) return { ok: false, error: 'unauthorized' };
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
    if (!client.actor) return { ok: false, error: 'unauthorized' };
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
    if (!client.actor) return { ok: false, error: 'unauthorized' };
    const message = await this.supportChatService.saveUserOrAdminMessage(
      client.actor,
      body.conversationId,
      body.content,
    );
    await client.join(supportRoomName(body.conversationId));
    this.server
      .to(supportRoomName(body.conversationId))
      .emit('receive_message', message);
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
    if (!client.actor) return { ok: false, error: 'unauthorized' };
    await this.supportChatService.assertCanAccessConversation(
      client.actor,
      body.conversationId,
    );
    client.to(supportRoomName(body.conversationId)).emit('typing', {
      conversationId: body.conversationId,
      actorType: client.actor.type,
      actorId: client.actor.id,
    });
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
    if (!client.actor) return { ok: false, error: 'unauthorized' };
    await this.supportChatService.assertCanAccessConversation(
      client.actor,
      body.conversationId,
    );
    client.to(supportRoomName(body.conversationId)).emit('stop_typing', {
      conversationId: body.conversationId,
      actorType: client.actor.type,
      actorId: client.actor.id,
    });
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
    if (!client.actor) return { ok: false, error: 'unauthorized' };
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
    return { ok: true };
  }

  emitConversationClosed(conversationId: number, payload?: Record<string, unknown>) {
    this.server
      .to(supportRoomName(conversationId))
      .emit('conversation_closed', { conversationId, ...(payload || {}) });
  }
}
