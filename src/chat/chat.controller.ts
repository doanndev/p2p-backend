import {
  Delete,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminJwtAuthGuard } from '../admins/guards/admin-jwt-auth.guard';
import { ChatRoomStatus } from './entities/chat-room.entity';

@ApiTags('Chat')
@ApiCookieAuth('access_token')
@ApiCookieAuth('admin_access_token')
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
      '- **Validate**:',
      '  - User: phải là buyer/seller của transaction',
      '  - Admin: bypass buyer/seller validation',
      '  - Room phải tồn tại',
      '',
      '### 2) admin_create_room',
      '- **Client(Admin) → WS**: `admin_create_room`',
      '```json',
      '{ "transaction_id": 123 }',
      '```',
      '- **Quyền**: chỉ admin active được tạo/reopen room.',
      '- **WS → Room (emit)**: `room_opened`',
      '',
      '### 3) admin_close_room',
      '- **Client(Admin) → WS**: `admin_close_room`',
      '```json',
      '{ "transaction_id": 123, "reason": "manual_close" }',
      '```',
      '- **Quyền**: chỉ admin active được đóng room.',
      '- **WS → Room (emit)**: `room_closed`',
      '',
      '### 4) send_message',
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
      '  - Buyer/Seller: vẫn phải thuộc transaction',
      '  - Admin: được bypass buyer/seller validation',
      '  - Room phải `ACTIVE`',
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
      '## Room lifecycle',
      '- Transaction tạo mới **không tự tạo chat room**.',
      '- Chat room chỉ được **admin tạo/đóng thủ công**.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'Tài liệu markdown cho realtime chat',
    schema: { example: { ok: true } },
  })
  realtimeDoc() {
    return { ok: true };
  }

  @Get('rooms/active')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lấy danh sách chat room đang mở của user hiện tại',
    description:
      'Trả về các room có status active mà user là buyer hoặc seller. Nếu không có room nào thì trả về mảng rỗng.',
  })
  @ApiOkResponse({
    description: 'Danh sách room active của user (có thể rỗng)',
    schema: {
      example: [
        {
          room_id: 12,
          transaction_id: 123,
          buyer_id: 101,
          seller_id: 202,
          buyer: {
            id: 101,
            username: 'buyer_user',
            email: 'buyer@example.com',
            phone: '0900000001',
            avatar: 'https://cdn.example.com/avatar-buyer.jpg',
            display_name: 'Buyer User',
            status: 'active',
          },
          seller: {
            id: 202,
            username: 'seller_user',
            email: 'seller@example.com',
            phone: '0900000002',
            avatar: 'https://cdn.example.com/avatar-seller.jpg',
            display_name: 'Seller User',
            status: 'active',
          },
          transaction: {
            id: 123,
            reference_code: 'TX-1711223344556-XY98ZT',
            user_buy_id: 101,
            user_sell_id: 202,
            coin: 1,
            national: 2,
            order_book: 50,
            bu_id: 10,
            option: 'buy',
            type: 'banking',
            coin_symbol: 'USDT',
            national_symbol: 'VND',
            amount: '20.00000000',
            price: '25000.00000000',
            price_usd: '25000.00000000',
            total_price: '500000.00000000',
            total_usd: '500000.00000000',
            dispute_status: false,
            time_bank: '2026-04-10T08:01:00.000Z',
            status: 'pending',
            message: null,
            lock_released_at: null,
            created_at: '2026-04-10T08:00:00.000Z',
            expired_at: '2026-04-10T08:15:00.000Z',
            payment_proof_urls: [],
          },
          orderbook: {
            id: 50,
            user_id: 202,
            coin: 1,
            national: 2,
            adv_code: 'ADV-1711223344556-AB12CD',
            option: 'sell',
            coin_symbol: 'USDT',
            national_symbol: 'VND',
            amount: '100.00000000',
            amount_remaining: '80.00000000',
            price: '25000.00000000',
            national_min: '10.00000000',
            national_max: '500.00000000',
            status: 'pending',
            description: 'Giao dịch trong giờ hành chính',
            created_at: '2026-04-10T07:30:00.000Z',
          },
          status: 'active',
          created_at: '2026-04-10T08:00:00.000Z',
          closed_at: null,
        },
      ],
    },
  })
  getActiveRooms(@Request() req: any) {
    return this.chatService.getActiveRoomsByUser(req.user.uid);
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

  @Get('admin/rooms')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: list chat rooms' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ChatRoomStatus,
    example: ChatRoomStatus.ACTIVE,
  })
  @ApiQuery({ name: 'userId', required: false, example: 1001 })
  @ApiQuery({ name: 'transactionId', required: false, example: 123 })
  @ApiOkResponse({
    description: 'Danh sách chat rooms',
    schema: {
      example: [
        {
          room_id: 12,
          transaction_id: 123,
          buyer_id: 1001,
          seller_id: 1002,
          buyer: {
            id: 1001,
            username: 'buyer_user',
            email: 'buyer@example.com',
            phone: '0900000001',
            avatar: 'https://cdn.example.com/avatar-buyer.jpg',
            display_name: 'Buyer User',
            status: 'active',
          },
          seller: {
            id: 1002,
            username: 'seller_user',
            email: 'seller@example.com',
            phone: '0900000002',
            avatar: 'https://cdn.example.com/avatar-seller.jpg',
            display_name: 'Seller User',
            status: 'active',
          },
          transaction: {
            id: 123,
            reference_code: 'TX-1711223344556-XY98ZT',
            user_buy_id: 1001,
            user_sell_id: 1002,
            coin: 1,
            national: 2,
            order_book: 50,
            bu_id: 10,
            option: 'buy',
            type: 'banking',
            coin_symbol: 'USDT',
            national_symbol: 'VND',
            amount: '20.00000000',
            price: '25000.00000000',
            price_usd: '25000.00000000',
            total_price: '500000.00000000',
            total_usd: '500000.00000000',
            dispute_status: false,
            time_bank: '2026-04-10T08:01:00.000Z',
            status: 'pending',
            message: null,
            lock_released_at: null,
            created_at: '2026-04-10T08:00:00.000Z',
            expired_at: '2026-04-10T08:15:00.000Z',
            payment_proof_urls: [],
          },
          orderbook: {
            id: 50,
            user_id: 1002,
            coin: 1,
            national: 2,
            adv_code: 'ADV-1711223344556-AB12CD',
            option: 'sell',
            coin_symbol: 'USDT',
            national_symbol: 'VND',
            amount: '100.00000000',
            amount_remaining: '80.00000000',
            price: '25000.00000000',
            national_min: '10.00000000',
            national_max: '500.00000000',
            status: 'pending',
            description: 'Giao dịch trong giờ hành chính',
            created_at: '2026-04-10T07:30:00.000Z',
          },
          status: 'active',
          created_at: '2026-04-10T08:00:00.000Z',
          closed_at: null,
        },
      ],
    },
  })
  adminListRooms(
    @Query('status') status?: ChatRoomStatus,
    @Query('userId') userId?: string,
    @Query('transactionId') transactionId?: string,
  ) {
    return this.chatService.adminListRooms({
      status,
      userId: userId ? Number(userId) : undefined,
      transactionId: transactionId ? Number(transactionId) : undefined,
    });
  }

  @Get('admin/rooms/:transactionId')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: get chat room detail by transaction' })
  @ApiParam({ name: 'transactionId', required: true, example: 123 })
  @ApiOkResponse({ description: 'Chi tiết room' })
  adminGetRoomDetail(
    @Param('transactionId', ParseIntPipe) transactionId: number,
  ) {
    return this.chatService.adminGetRoomDetail(transactionId);
  }

  @Get('admin/rooms/:transactionId/messages')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: get messages by room(transaction)' })
  @ApiParam({ name: 'transactionId', required: true, example: 123 })
  @ApiOkResponse({ description: 'Danh sách messages của room' })
  adminGetRoomMessages(
    @Param('transactionId', ParseIntPipe) transactionId: number,
  ) {
    return this.chatService.adminGetRoomMessages(transactionId);
  }

  @Post('admin/rooms/:transactionId')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Admin: create or reopen chat room' })
  @ApiParam({ name: 'transactionId', required: true, example: 123 })
  @ApiCreatedResponse({ description: 'Tạo/reopen room thành công' })
  adminCreateOrReopenRoom(
    @Request() req: any,
    @Param('transactionId', ParseIntPipe) transactionId: number,
  ) {
    return this.chatService.adminCreateOrReopenRoom(
      req.user.admin_id,
      transactionId,
    );
  }

  @Patch('admin/rooms/:transactionId/close')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: close chat room' })
  @ApiParam({ name: 'transactionId', required: true, example: 123 })
  @ApiOkResponse({ description: 'Đóng room thành công' })
  adminCloseRoom(
    @Request() req: any,
    @Param('transactionId', ParseIntPipe) transactionId: number,
  ) {
    return this.chatService.adminCloseRoom(req.user.admin_id, transactionId);
  }

  @Patch('admin/rooms/:transactionId/archive')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: archive chat room' })
  @ApiParam({ name: 'transactionId', required: true, example: 123 })
  @ApiOkResponse({ description: 'Archive room thành công' })
  adminArchiveRoom(
    @Request() req: any,
    @Param('transactionId', ParseIntPipe) transactionId: number,
  ) {
    return this.chatService.adminArchiveRoom(req.user.admin_id, transactionId);
  }

  @Delete('admin/messages/:messageId')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: delete chat message' })
  @ApiParam({ name: 'messageId', required: true, example: 10001 })
  @ApiOkResponse({
    description: 'Xóa message thành công',
    schema: { example: { message: 'Message deleted successfully', id: 10001 } },
  })
  adminDeleteMessage(
    @Request() req: any,
    @Param('messageId', ParseIntPipe) messageId: number,
  ) {
    return this.chatService.adminDeleteMessage(req.user.admin_id, messageId);
  }
}
