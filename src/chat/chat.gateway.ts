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
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

type AuthedSocket = Socket & { userId?: number };

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
  ) {}

  async handleConnection(client: AuthedSocket) {
    try {
      const cookieHeader =
        (client.handshake.headers?.cookie as string | undefined) ?? undefined;
      const cookies = parseCookie(cookieHeader);
      const token =
        (client.handshake.auth?.access_token as string | undefined) ||
        cookies['access_token'];
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

      client.userId = userId;
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket) {
    // no-op
    void client;
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    body: {
      transaction_id: number;
    },
  ) {
    const userId = client.userId;
    if (!userId) return { ok: false, error: 'unauthorized' };

    const transactionId = Number(body?.transaction_id);
    if (!transactionId) return { ok: false, error: 'invalid_transaction_id' };

    await this.chatService.assertUserCanAccessTransactionChat(
      userId,
      transactionId,
    );

    await client.join(roomName(transactionId));
    return { ok: true };
  }

  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    body: {
      transaction_id: number;
      content: string;
    },
  ) {
    const userId = client.userId;
    if (!userId) return { ok: false, error: 'unauthorized' };

    const transactionId = Number(body?.transaction_id);
    if (!transactionId) return { ok: false, error: 'invalid_transaction_id' };

    // đảm bảo đã join (cho phép rejoin idempotent)
    await client.join(roomName(transactionId));

    try {
      const msg = await this.chatService.saveTextMessage(
        userId,
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
