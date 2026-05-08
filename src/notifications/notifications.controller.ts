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
import { NotificationsService } from './notifications.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationsStreamService } from './notifications-stream.service';
import { NotificationType } from '../users/entities/notification.entity';

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
