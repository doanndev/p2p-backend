import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../users/entities/notification.entity';
import { Admin } from '../admins/entities/admin.entity';
import { AdminNotification } from '../admins/entities/admin-notification.entity';
import {
  NotificationsController,
  AdminNotificationsController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AdminNotificationsService } from './admin-notifications.service';
import { NotificationsStreamService } from './notifications-stream.service';
import { AdminsModule } from '../admins/admins.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, AdminNotification, Admin]),
    forwardRef(() => AdminsModule),
  ],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [
    NotificationsService,
    AdminNotificationsService,
    NotificationsStreamService,
  ],
  exports: [NotificationsService, AdminNotificationsService],
})
export class NotificationsModule {}
