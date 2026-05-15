import {
  Body,
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
  UsePipes,
  ValidationPipe,
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
import { SupportChatService } from './support-chat.service';
import { SupportChatHttpAuthGuard } from './guards/support-chat-http-auth.guard';
import { SupportChatAdminGuard } from './guards/support-chat-admin.guard';
import { QueryConversationsDto } from './dto/query-conversations.dto';
import { QueryConversationMessagesDto } from './dto/query-conversation-messages.dto';
import { SupportChatGateway } from './support-chat.gateway';
import { CreateConversationDto } from './dto/create-conversation.dto';

@ApiTags('Support Chat')
@ApiCookieAuth('access_token')
@ApiCookieAuth('admin_access_token')
@Controller('conversations')
@UseGuards(SupportChatHttpAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class SupportChatController {
  constructor(
    private readonly supportChatService: SupportChatService,
    private readonly supportChatGateway: SupportChatGateway,
  ) {}

  @Get('realtime-doc')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tài liệu realtime support chat (Socket.IO)',
    description: [
      '## Realtime support chat (Socket.IO)',
      '',
      '- **Namespace**: `/support-chat`',
      '- **Auth**: cookie `access_token` hoặc `admin_access_token`, hoặc `handshake.auth.access_token` / `handshake.auth.admin_access_token`',
      '- **Room**: `conversation:{conversationId}` (mỗi conversation là một room)',
      '- **Admin inbox room**: `admin:support-inbox` — auto-join khi admin connect; nhận `support_message_pending` / `support_unread_updated`',
      '',
      '## Client → Server events',
      '',
      '### 1) join_conversation',
      '```json',
      '{ "conversationId": 12, "silent": true }',
      '```',
      '- Validate quyền truy cập conversation trước khi join room.',
      '- `silent: true` (admin): join không tạo system event — dùng khi mở panel chat.',
      '- Mặc định: tạo `SYSTEM_EVENT` (`USER_JOINED`/`ADMIN_JOINED`) và emit `receive_message` cho room.',
      '',
      '### 2) leave_conversation',
      '```json',
      '{ "conversationId": 12 }',
      '```',
      '- Tạo `SYSTEM_EVENT` (`USER_LEFT`/`ADMIN_LEFT`) và emit `receive_message` cho room (exclude sender).',
      '',
      '### 3) send_message',
      '```json',
      '{ "conversationId": 12, "content": "Xin chao admin" }',
      '```',
      '- Hoặc gửi ảnh bằng URL (https), một trong hai: `content` hoặc `imageUrl`:',
      '```json',
      '{ "conversationId": 12, "imageUrl": "https://cdn.example.com/screenshot.png" }',
      '```',
      '- Validate: actor thuộc conversation (user owner hoặc admin), conversation phải `OPEN`.',
      '- Text: `message_type`: `text`, `content` là nội dung. Ảnh: `message_type`: `image`, `content` lưu URL.',
      '- Lưu DB vào `support_chat_message` rồi emit `receive_message` cho toàn bộ room.',
      '',
      '### 4) typing',
      '```json',
      '{ "conversationId": 12 }',
      '```',
      '- Broadcast `typing` cho room (exclude sender).',
      '',
      '### 5) stop_typing',
      '```json',
      '{ "conversationId": 12 }',
      '```',
      '- Broadcast `stop_typing` cho room (exclude sender).',
      '',
      '### 6) seen',
      '```json',
      '{ "conversationId": 12 }',
      '```',
      '- Mark seen trong DB theo actor (`seen_by_user_at` hoặc `seen_by_admin_at`) rồi emit `seen` cho room.',
      '',
      '## Server → Client events',
      '- `receive_message`',
      '- `typing`',
      '- `stop_typing`',
      '- `seen`',
      '- `conversation_closed`',
      '- `support_message_pending` (admin inbox — tin user mới)',
      '- `support_unread_updated` (admin inbox — `{ total, byConversation }`)',
      '',
      '## Ack response mẫu',
      '```json',
      '{ "ok": true }',
      '```',
      '',
      '## Message emit mẫu (`receive_message`)',
      '```json',
      '{ "id": 88, "conversation_id": 12, "sender_type": "user", "sender_user_id": 1001, "sender_admin_id": null, "message_type": "text", "content": "Xin chao admin", "system_event_type": null, "seen_by_user_at": "2026-04-01T10:02:00.000Z", "seen_by_admin_at": null, "created_at": "2026-04-01T10:02:00.000Z" }',
      '',
      '`message_type`: `image` khi gửi `imageUrl` — `content` trong payload DB là URL ảnh.',
      '```',
      '',
      '## Flow',
      '```mermaid',
      'sequenceDiagram',
      '  participant UserClient',
      '  participant AdminClient',
      '  participant WS',
      '  participant Service',
      '  participant DB',
      '',
      '  UserClient->>WS: join_conversation(conversationId)',
      '  AdminClient->>WS: join_conversation(conversationId)',
      '  UserClient->>WS: send_message(conversationId,content hoặc imageUrl)',
      '  WS->>Service: validatePermission',
      '  Service->>DB: insert support_chat_message',
      '  WS-->>UserClient: receive_message',
      '  WS-->>AdminClient: receive_message',
      '```',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'Tài liệu markdown cho realtime support chat',
    schema: { example: { ok: true } },
  })
  realtimeDoc() {
    return { ok: true };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get conversations with pagination/filter' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'status', required: false, example: 'open' })
  @ApiQuery({ name: 'userId', required: false, example: 1001 })
  @ApiQuery({ name: 'username', required: false, example: 'john_doe' })
  @ApiQuery({ name: 'email', required: false, example: 'john@example.com' })
  @ApiOkResponse({
    description: 'Conversation list',
    schema: {
      example: {
        statusCode: 200,
        data: [
          {
            id: 12,
            conversation_code: 'user-1001',
            user_id: 1001,
            user: {
              id: 1001,
              username: 'john_doe',
              email: 'john@example.com',
              phone: '0900000000',
              avatar: 'https://cdn.example.com/avatar.jpg',
              display_name: 'John Doe',
              status: 'active',
            },
            status: 'open',
            last_message_at: '2026-04-01T10:00:00.000Z',
            closed_at: null,
            closed_by_admin_id: null,
            created_at: '2026-04-01T09:55:00.000Z',
            updated_at: '2026-04-01T10:00:00.000Z',
          },
        ],
        meta: { page: 1, limit: 20, total: 1, total_pages: 1 },
      },
    },
  })
  getConversations(@Request() req: any, @Query() query: QueryConversationsDto) {
    return this.supportChatService.getConversations(
      req.supportChatActor,
      query,
    );
  }

  @Get('admin/unread-summary')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupportChatAdminGuard)
  @ApiOperation({
    summary: 'Admin: unread support messages summary (open conversations)',
  })
  @ApiOkResponse({
    description: 'Total unread and per-conversation counts',
    schema: {
      example: {
        statusCode: 200,
        data: {
          total: 3,
          byConversation: { '12': 2, '15': 1 },
        },
      },
    },
  })
  getAdminUnreadSummary() {
    return this.supportChatService.getAdminUnreadSummary();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get conversation detail' })
  @ApiParam({ name: 'id', required: true, example: 12 })
  @ApiOkResponse({
    description: 'Conversation detail',
    schema: {
      example: {
        statusCode: 200,
        data: {
          id: 12,
          conversation_code: 'user-1001',
          user_id: 1001,
          status: 'open',
          last_message_at: '2026-04-01T10:00:00.000Z',
          closed_at: null,
          closed_by_admin_id: null,
          created_at: '2026-04-01T09:55:00.000Z',
          updated_at: '2026-04-01T10:00:00.000Z',
        },
      },
    },
  })
  getConversationDetail(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.supportChatService.getConversationDetail(
      req.supportChatActor,
      id,
    );
  }

  @Get(':id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get conversation message history' })
  @ApiParam({ name: 'id', required: true, example: 12 })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOkResponse({
    description: 'Conversation messages',
    schema: {
      example: {
        statusCode: 200,
        data: [
          {
            id: 88,
            conversation_id: 12,
            sender_type: 'user',
            sender_user_id: 1001,
            sender_admin_id: null,
            message_type: 'text',
            content: 'Xin chao admin',
            system_event_type: null,
            seen_by_user_at: '2026-04-01T10:02:00.000Z',
            seen_by_admin_at: null,
            created_at: '2026-04-01T10:02:00.000Z',
          },
          {
            id: 89,
            conversation_id: 12,
            sender_type: 'system',
            sender_user_id: null,
            sender_admin_id: 2,
            message_type: 'system_event',
            content: 'admin_joined',
            system_event_type: 'admin_joined',
            seen_by_user_at: null,
            seen_by_admin_at: null,
            created_at: '2026-04-01T10:02:10.000Z',
          },
        ],
        meta: { page: 1, limit: 50, total: 2, total_pages: 1 },
      },
    },
  })
  getConversationMessages(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryConversationMessagesDto,
  ) {
    return this.supportChatService.getConversationMessages(
      req.supportChatActor,
      id,
      query,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create conversation',
    description:
      'User: tạo (hoặc trả về) conversation `OPEN` của chính mình, không cần body. Admin: gửi `{ "userId": <uid> }` để tạo conversation cho user đó (hoặc trả về conversation `OPEN` hiện có của user).',
  })
  @ApiCreatedResponse({
    description: 'Conversation created',
    schema: {
      example: {
        statusCode: 201,
        data: {
          id: 15,
          conversation_code: 'user-1001',
          user_id: 1001,
          status: 'open',
          last_message_at: null,
          closed_at: null,
          closed_by_admin_id: null,
          created_at: '2026-04-01T10:05:00.000Z',
          updated_at: '2026-04-01T10:05:00.000Z',
        },
      },
    },
  })
  createConversation(@Request() req: any, @Body() body: CreateConversationDto) {
    return this.supportChatService.createConversation(
      req.supportChatActor,
      body,
    );
  }

  @Patch(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close conversation (owner user or admin)' })
  @ApiParam({ name: 'id', required: true, example: 12 })
  @ApiOkResponse({
    description: 'Conversation closed',
    schema: {
      example: {
        statusCode: 200,
        data: {
          id: 12,
          conversation_code: 'user-1001',
          user_id: 1001,
          status: 'closed',
          last_message_at: '2026-04-01T10:00:00.000Z',
          closed_at: '2026-04-01T10:10:00.000Z',
          closed_by_admin_id: 2,
          created_at: '2026-04-01T09:55:00.000Z',
          updated_at: '2026-04-01T10:10:00.000Z',
        },
      },
    },
  })
  async closeConversation(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const result = await this.supportChatService.closeConversation(
      req.supportChatActor,
      id,
    );
    this.supportChatGateway.emitConversationClosed(id, {
      closedByActorType: req.supportChatActor.type,
      closedByActorId: req.supportChatActor.id,
    });
    return result;
  }
}
