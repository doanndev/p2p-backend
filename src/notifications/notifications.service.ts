import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Notification,
  NotificationType,
} from '../users/entities/notification.entity';
import { RedisPubSubService } from '../systems/redis-pubsub.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationsStreamService } from './notifications-stream.service';

const NOTIFICATIONS_USER_CHANNEL = 'notifications:user';

export type CreateNotificationInput = {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any> | null;
};

type NotificationResponse = {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, any> | null;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
};

type NotificationCreatedEvent = {
  userId: number;
  event: 'notification.created';
  notification: NotificationResponse;
};

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly redisPubSubService: RedisPubSubService,
    private readonly notificationsStreamService: NotificationsStreamService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.subscribeToNotificationEvents();
  }

  private async subscribeToNotificationEvents(retry = 0): Promise<void> {
    try {
      await this.redisPubSubService.subscribe(
        NOTIFICATIONS_USER_CHANNEL,
        (payload: NotificationCreatedEvent) => {
          if (payload?.event !== 'notification.created' || !payload?.userId) {
            return;
          }

          this.notificationsStreamService.emitToUser(payload.userId, {
            type: payload.event,
            data: payload.notification,
          });
        },
      );
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      if (retry >= 4) {
        this.logger.warn('Failed to subscribe notifications Redis channel');
        return;
      }
      const delayMs = (retry + 1) * 1000;
      setTimeout(() => {
        void this.subscribeToNotificationEvents(retry + 1);
      }, delayMs);
    }
  }

  private toNotificationResponse(
    notification: Notification,
  ): NotificationResponse {
    return {
      id: notification.notif_id,
      type: notification.notif_type,
      title: notification.notif_title,
      message: notification.notif_message,
      data: notification.notif_data,
      is_read: notification.notif_is_read,
      read_at: notification.notif_read_at,
      created_at: notification.notif_created_at,
    };
  }

  async createForUser(
    input: CreateNotificationInput,
  ): Promise<NotificationResponse> {
    const notification = this.notificationRepository.create({
      notif_user_id: input.userId,
      notif_type: input.type,
      notif_title: input.title,
      notif_message: input.message,
      notif_data: input.data ?? null,
      notif_is_read: false,
      notif_read_at: null,
    });

    const saved = await this.notificationRepository.save(notification);
    const payload: NotificationCreatedEvent = {
      userId: input.userId,
      event: 'notification.created',
      notification: this.toNotificationResponse(saved),
    };

    await this.redisPubSubService.publish(NOTIFICATIONS_USER_CHANNEL, payload);
    return payload.notification;
  }

  async listForUser(userId: number, query: QueryNotificationsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.notificationRepository
      .createQueryBuilder('n')
      .where('n.notif_user_id = :userId', { userId });

    if (typeof query.isRead === 'boolean') {
      qb.andWhere('n.notif_is_read = :isRead', { isRead: query.isRead });
    }

    if (query.type) {
      qb.andWhere('n.notif_type = :type', { type: query.type });
    }

    qb.orderBy('n.notif_created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    const unreadTotal = await this.notificationRepository.count({
      where: {
        notif_user_id: userId,
        notif_is_read: false,
      },
    });

    return {
      statusCode: 200,
      data: rows.map((row) => this.toNotificationResponse(row)),
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
        unread_total: unreadTotal,
      },
    };
  }

  async markRead(userId: number, notificationId: number) {
    const notification = await this.notificationRepository.findOne({
      where: {
        notif_id: notificationId,
        notif_user_id: userId,
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (!notification.notif_is_read) {
      notification.notif_is_read = true;
      notification.notif_read_at = new Date();
      await this.notificationRepository.save(notification);
    }

    return {
      statusCode: 200,
      data: {
        id: notification.notif_id,
        is_read: notification.notif_is_read,
        read_at: notification.notif_read_at,
      },
    };
  }

  async markAllRead(userId: number) {
    const readAt = new Date();
    const result = await this.notificationRepository
      .createQueryBuilder()
      .update(Notification)
      .set({
        notif_is_read: true,
        notif_read_at: readAt,
      })
      .where('notif_user_id = :userId', { userId })
      .andWhere('notif_is_read = false')
      .execute();

    return {
      statusCode: 200,
      data: {
        updated: result.affected ?? 0,
        read_at: readAt,
      },
    };
  }
}
