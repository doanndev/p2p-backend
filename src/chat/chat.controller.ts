import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Chat')
@ApiCookieAuth('access_token')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('realtime-doc')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tài liệu realtime chat (Socket.IO)',
    description: [
      '## Realtime chat (Socket.IO)',
      '',
      '- **Namespace**: `/chat`',
      '- **Auth**: cookie `access_token` (JWT) hoặc `handshake.auth.access_token`',
      '- **Room**: `tx:{transaction_id}` (mỗi transaction là một room)',
      '',
      '## Event list',
      '',
      '### 1) join',
      '- **Client → WS**: `join`',
      '```json',
      '{ "transaction_id": 123 }',
      '```',
      '- **WS → Client (ack)**:',
      '```json',
      '{ "ok": true }',
      '```',
      '- **Validate**: user phải là buyer/seller của transaction, room phải tồn tại.',
      '',
      '### 2) send_message',
      '- **Client → WS**: `send_message`',
      '```json',
      '{ "transaction_id": 123, "content": "hello" }',
      '```',
      '- **WS → DB**: lưu vào `chat_messages` (không cache).',
      '- **WS → Room (emit)**: `message`',
      '- **WS → Client (ack)**:',
      '```json',
      '{ "ok": true, "message": { "id": 1, "transaction_id": 123, "room_id": 10, "sender_id": 100, "type": "text", "content": "hello", "created_at": "2026-03-25T08:00:00.000Z" } }',
      '```',
      '- **Validate**:',
      '  - user thuộc transaction',
      '  - room `ACTIVE`',
      '  - transaction status phải `pendding`',
      '',
      '### 3) room_closed (server emit)',
      '- **WS → Room**: `room_closed`',
      '```json',
      '{ "transaction_id": 123, "reason": "expired" }',
      '```',
      '',
      '## Flow',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  participant A as Buyer',
      '  participant B as Seller',
      '  participant WS as Socket.IO',
      '  participant DB as Database',
      '',
      '  A->>WS: connect + join(transaction_id)',
      '  B->>WS: connect + join(transaction_id)',
      '',
      '  A->>WS: send_message',
      '  WS->>DB: save message',
      '  WS-->>B: emit message',
      '  WS-->>A: ack message',
      '',
      '  B->>WS: send_message',
      '  WS->>DB: save message',
      '  WS-->>A: emit message',
      '```',
      '',
      '## Reload page (history)',
      '- **Client → API**: `GET /api/v1/chat/transactions/{id}/messages`',
      '- **Client → WS**: reconnect + `join` lại room (rejoin idempotent).',
      '',
      '## TTL 30 phút',
      '- Chat room được tạo khi tạo transaction.',
      '- Sau **30 phút** nếu transaction vẫn `pendding` → set `failed` và room `closed`.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'Tài liệu markdown cho realtime chat',
    schema: { example: { ok: true } },
  })
  realtimeDoc() {
    return { ok: true };
  }

  /**
   * User reload flow: load chat messages from DB (no cache).
   * Path theo module chat: /api/v1/chat/transactions/:id/messages
   */
  @Get('transactions/:id/messages')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lấy messages theo transaction' })
  @ApiParam({
    name: 'id',
    required: true,
    example: '123',
    description: 'Transaction ID',
  })
  @ApiOkResponse({
    description: 'Danh sách messages (từ cũ đến mới)',
    schema: {
      example: [
        {
          id: 1,
          room_id: 10,
          sender_id: 100,
          type: 'text',
          content: 'Hello',
          file_url: null,
          file_name: null,
          file_size: null,
          is_read: false,
          created_at: '2026-03-25T08:00:00.000Z',
          read_at: null,
        },
      ],
    },
  })
  getTransactionMessages(@Request() req: any, @Param('id') id: string) {
    return this.chatService.getMessagesByTransactionId(
      req.user.uid,
      Number(id),
    );
  }
}
