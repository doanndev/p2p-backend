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
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { Admin } from '../admins/entities/admin.entity';
import { User } from '../users/entities/user.entity';
import { createSocketAuthMiddleware } from '../common/middlewares/socket-auth.middleware';
import { SendTransactionChatMessageDto } from './dto/send-transaction-chat-message.dto';

type ChatSocket = Socket & {
  user_id: number;
  actor: { type: 'user' | 'admin'; id: number };
};

function roomName(transactionId: number) {
  return `tx:${transactionId}`;
}

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: true, // Cho phép tất cả origins (middleware sẽ xác thực)
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
  ) {}

  afterInit(server: Server) {
    server.use(
      createSocketAuthMiddleware({
        jwtService: this.jwtService,
        configService: this.configService,
        userRepository: this.userRepository,
        adminRepository: this.adminRepository,
      }),
    );
  }

  async handleConnection(client: ChatSocket) {
    void client;
  }

  handleDisconnect(client: ChatSocket) {
    // no-op
    void client;
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody()
    body: {
      transaction_id: number;
    },
  ) {
    const actor = client.actor;

    const transactionId = Number(body?.transaction_id);
    if (!transactionId) return { ok: false, error: 'invalid_transaction_id' };

    await this.chatService.assertActorCanAccessTransactionChat(
      actor,
      transactionId,
    );

    await client.join(roomName(transactionId));
    return { ok: true };
  }

  @SubscribeMessage('admin_create_room')
  async adminCreateRoom(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody()
    body: {
      transaction_id: number;
    },
  ) {
    const actor = client.actor;

    const transactionId = Number(body?.transaction_id);
    if (!transactionId) return { ok: false, error: 'invalid_transaction_id' };

    try {
      const room = await this.chatService.createChatRoomByAdmin(
        actor,
        transactionId,
      );
      await client.join(roomName(transactionId));
      this.server.to(roomName(transactionId)).emit('room_opened', {
        transaction_id: transactionId,
      });
      return { ok: true, room };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'create_room_failed' };
    }
  }

  @SubscribeMessage('admin_close_room')
  async adminCloseRoom(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody()
    body: {
      transaction_id: number;
      reason?: string;
    },
  ) {
    const actor = client.actor;

    const transactionId = Number(body?.transaction_id);
    if (!transactionId) return { ok: false, error: 'invalid_transaction_id' };

    try {
      await this.chatService.closeChatRoomByAdmin(actor, transactionId);
      this.server.to(roomName(transactionId)).emit('room_closed', {
        transaction_id: transactionId,
        reason: body?.reason || 'closed_by_admin',
      });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'close_room_failed' };
    }
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
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() body: SendTransactionChatMessageDto,
  ) {
    const actor = client.actor;

    const transactionId = Number(body.transaction_id);
    if (!transactionId) return { ok: false, error: 'invalid_transaction_id' };

    // đảm bảo đã join (cho phép rejoin idempotent)
    await client.join(roomName(transactionId));

    try {
      const msg = await this.chatService.saveTextMessage(
        actor,
        transactionId,
        body.content,
        body.imageUrl,
      );

      // emit cho tất cả participants (kể cả sender) để UI sync
      this.server.to(roomName(transactionId)).emit('message', msg);
      return { ok: true, message: msg };
    } catch (e: any) {
      this.logger.warn(
        `[send_message:fail] tx=${transactionId} ${e?.message ?? e}`,
      );
      return { ok: false, error: e?.message ?? 'send_failed' };
    }
  }

  /** Service gọi khi đóng room để broadcast realtime. */
  emitRoomClosed(transactionId: number, payload: any) {
    this.server.to(roomName(transactionId)).emit('room_closed', payload);
  }
}
