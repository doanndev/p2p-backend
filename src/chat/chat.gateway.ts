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
import { ChatService } from './chat.service';
import { Admin, AdminStatus } from '../admins/entities/admin.entity';

type ChatSocket = Socket & {
  actor?: { type: 'user' | 'admin'; id: number };
};

function parseCookie(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const parts = header.split(';').map((p) => p.trim());
  const out: Record<string, string> = {};
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = decodeURIComponent(p.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

function roomName(transactionId: number) {
  return `tx:${transactionId}`;
}

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: true, credentials: true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
  ) {}

  async handleConnection(client: ChatSocket) {
    try {
      const cookieHeader =
        (client.handshake.headers?.cookie as string | undefined) ?? undefined;
      const cookies = parseCookie(cookieHeader);
      const adminToken =
        (client.handshake.auth?.admin_access_token as string | undefined) ||
        cookies['admin_access_token'];
      const userToken =
        (client.handshake.auth?.access_token as string | undefined) ||
        cookies['access_token'];
      const token = adminToken || userToken;
      if (!token) {
        client.disconnect(true);
        return;
      }

      const secret =
        this.configService.get<string>('JWT_SECRET') || 'your-secret-key';
      const payload: any = await this.jwtService.verifyAsync(token, { secret });
      const userId = Number(payload?.sub);
      if (!userId) {
        client.disconnect(true);
        return;
      }

      if (adminToken) {
        const admin = await this.adminRepository.findOne({
          where: { admin_id: userId },
        });
        if (!admin || admin.admin_status !== AdminStatus.ACTIVE) {
          client.disconnect(true);
          return;
        }
        client.actor = { type: 'admin', id: userId };
      } else {
        client.actor = { type: 'user', id: userId };
      }
    } catch {
      client.disconnect(true);
    }
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
    if (!actor) return { ok: false, error: 'unauthorized' };

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
    if (!actor) return { ok: false, error: 'unauthorized' };

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
    if (!actor) return { ok: false, error: 'unauthorized' };

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
  async sendMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody()
    body: {
      transaction_id: number;
      content: string;
    },
  ) {
    const actor = client.actor;
    if (!actor) return { ok: false, error: 'unauthorized' };

    const transactionId = Number(body?.transaction_id);
    if (!transactionId) return { ok: false, error: 'invalid_transaction_id' };

    // đảm bảo đã join (cho phép rejoin idempotent)
    await client.join(roomName(transactionId));

    try {
      const msg = await this.chatService.saveTextMessage(
        actor,
        transactionId,
        body?.content,
      );

      // emit cho tất cả participants (kể cả sender) để UI sync
      this.server.to(roomName(transactionId)).emit('message', msg);
      return { ok: true, message: msg };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'send_failed' };
    }
  }

  /** Service gọi khi đóng room để broadcast realtime. */
  emitRoomClosed(transactionId: number, payload: any) {
    this.server.to(roomName(transactionId)).emit('room_closed', payload);
  }
}
