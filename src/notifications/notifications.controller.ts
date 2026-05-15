import {
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
  Sse,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminJwtAuthGuard } from '../admins/guards/admin-jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { AdminNotificationsService } from './admin-notifications.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationsStreamService } from './notifications-stream.service';
import { NotificationType } from '../users/entities/notification.entity';
import { Admin } from '../admins/entities/admin.entity';

@ApiTags('Notifications')
@ApiCookieAuth('access_token')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationsStreamService: NotificationsStreamService,
  ) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Lấy danh sách thông báo của user hiện tại' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'isRead', required: false, type: Boolean })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: NotificationType,
    description: 'Lọc theo loại thông báo/module',
  })
  getNotifications(@Req() req: any, @Query() query: QueryNotificationsDto) {
    return this.notificationsService.listForUser(req.user.uid, query);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo là đã đọc' })
  markAllRead(@Req() req: any) {
    return this.notificationsService.markAllRead(req.user.uid);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu một thông báo là đã đọc' })
  markRead(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.notificationsService.markRead(req.user.uid, id);
  }

  @Sse('stream')
  @ApiOperation({ summary: 'Nhận thông báo realtime qua' })
  @ApiOkResponse({ description: 'Stream connected' })
  stream(
    @Req() req: Request & { user: { uid: number } },
  ): Observable<MessageEvent> {
    const { stream, disconnect } = this.notificationsStreamService.connect(
      req.user.uid,
    );

    req.on('close', disconnect);
    return stream;
  }
}

@ApiTags('Admin notifications')
@ApiCookieAuth('admin_access_token')
@Controller('admin/notifications')
@UseGuards(AdminJwtAuthGuard)
export class AdminNotificationsController {
  constructor(
    private readonly adminNotificationsService: AdminNotificationsService,
    private readonly notificationsStreamService: NotificationsStreamService,
  ) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Danh sách thông báo của admin đang đăng nhập' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'isRead', required: false, type: Boolean })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: NotificationType,
    description: 'Lọc theo loại thông báo/module',
  })
  getAdminNotifications(
    @Req() req: Request & { user: Admin },
    @Query() query: QueryNotificationsDto,
  ) {
    return this.adminNotificationsService.listForAdmin(
      req.user.admin_id,
      query,
    );
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo admin là đã đọc' })
  markAllReadAdmin(@Req() req: Request & { user: Admin }) {
    return this.adminNotificationsService.markAllRead(req.user.admin_id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu một thông báo admin là đã đọc' })
  markReadAdmin(
    @Req() req: Request & { user: Admin },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminNotificationsService.markRead(req.user.admin_id, id);
  }

  @Sse('stream')
  @ApiOperation({ summary: 'SSE thông báo realtime cho admin panel' })
  @ApiOkResponse({ description: 'Stream connected' })
  streamAdmin(@Req() req: Request & { user: Admin }): Observable<MessageEvent> {
    const { stream, disconnect } = this.notificationsStreamService.connectAdmin(
      req.user.admin_id,
    );

    req.on('close', disconnect);
    return stream;
  }
}
