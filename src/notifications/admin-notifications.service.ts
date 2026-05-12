import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationType } from '../users/entities/notification.entity';
import {
  Admin,
  AdminLevel,
  AdminStatus,
} from '../admins/entities/admin.entity';
import { AdminNotification } from '../admins/entities/admin-notification.entity';
import { RedisPubSubService } from '../systems/redis-pubsub.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationsStreamService } from './notifications-stream.service';

const NOTIFICATIONS_ADMIN_CHANNEL = 'notifications:admin';

export type CreateAdminNotificationInput = {
  adminId: number;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown> | null;
};

export type AdminNotificationResponse = {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
};

type AdminNotificationCreatedEvent = {
  adminId: number;
  event: 'notification.created';
  notification: AdminNotificationResponse;
};

@Injectable()
export class AdminNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(AdminNotificationsService.name);

  constructor(
    @InjectRepository(AdminNotification)
    private readonly adminNotificationRepository: Repository<AdminNotification>,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
    private readonly redisPubSubService: RedisPubSubService,
    private readonly notificationsStreamService: NotificationsStreamService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.subscribeToAdminNotificationEvents();
  }

  private async subscribeToAdminNotificationEvents(retry = 0): Promise<void> {
    try {
      await this.redisPubSubService.subscribe(
        NOTIFICATIONS_ADMIN_CHANNEL,
        (payload: AdminNotificationCreatedEvent) => {
          if (payload?.event !== 'notification.created' || !payload?.adminId) {
            return;
          }

          this.notificationsStreamService.emitToAdmin(payload.adminId, {
            type: payload.event,
            data: payload.notification,
          });
        },
      );
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      if (retry >= 4) {
        this.logger.warn(
          'Failed to subscribe admin notifications Redis channel',
        );
        return;
      }
      const delayMs = (retry + 1) * 1000;
      setTimeout(() => {
        void this.subscribeToAdminNotificationEvents(retry + 1);
      }, delayMs);
    }
  }

  private toResponse(row: AdminNotification): AdminNotificationResponse {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      data: row.data,
      is_read: row.is_read,
      read_at: row.read_at,
      created_at: row.created_at,
    };
  }

  async createForAdmin(
    input: CreateAdminNotificationInput,
  ): Promise<AdminNotificationResponse> {
    const notification = this.adminNotificationRepository.create({
      admin: { admin_id: input.adminId } as Admin,
      type: input.type,
      title: input.title,
      message: input.message,
      data: input.data ?? null,
      is_read: false,
      read_at: null,
    });

    const saved = await this.adminNotificationRepository.save(notification);
    const payload: AdminNotificationCreatedEvent = {
      adminId: input.adminId,
      event: 'notification.created',
      notification: this.toResponse(saved),
    };

    await this.redisPubSubService.publish(NOTIFICATIONS_ADMIN_CHANNEL, payload);
    return payload.notification;
  }

  /** In-app + SSE for every active super admin (product: ops alerts). */
  async notifySuperAdmins(params: {
    type: NotificationType;
    title: string;
    message: string;
    data?: Record<string, unknown> | null;
  }): Promise<void> {
    const superAdmins = await this.adminRepository.find({
      where: {
        admin_level: AdminLevel.SUPER_ADMIN,
        admin_status: AdminStatus.ACTIVE,
      },
      select: ['admin_id'],
    });
    if (superAdmins.length === 0) {
      this.logger.debug('notifySuperAdmins: no active super admins');
      return;
    }
    await Promise.allSettled(
      superAdmins.map((a) =>
        this.createForAdmin({
          adminId: a.admin_id,
          type: params.type,
          title: params.title,
          message: params.message,
          data: params.data ?? null,
        }),
      ),
    );
  }

  async listForAdmin(adminId: number, query: QueryNotificationsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.adminNotificationRepository
      .createQueryBuilder('n')
      .innerJoin('n.admin', 'a')
      .where('a.admin_id = :adminId', { adminId });

    if (typeof query.isRead === 'boolean') {
      qb.andWhere('n.is_read = :isRead', { isRead: query.isRead });
    }

    if (query.type) {
      qb.andWhere('n.type = :type', { type: query.type });
    }

    qb.orderBy('n.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    const unreadTotal = await this.adminNotificationRepository
      .createQueryBuilder('n')
      .innerJoin('n.admin', 'a')
      .where('a.admin_id = :adminId', { adminId })
      .andWhere('n.is_read = false')
      .getCount();

    return {
      statusCode: 200,
      data: rows.map((row) => this.toResponse(row)),
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
        unread_total: unreadTotal,
      },
    };
  }

  async markRead(adminId: number, notificationId: number) {
    const notification = await this.adminNotificationRepository.findOne({
      where: {
        id: notificationId,
        admin: { admin_id: adminId },
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (!notification.is_read) {
      notification.is_read = true;
      notification.read_at = new Date();
      await this.adminNotificationRepository.save(notification);
    }

    return {
      statusCode: 200,
      data: {
        id: notification.id,
        is_read: notification.is_read,
        read_at: notification.read_at,
      },
    };
  }

  async markAllRead(adminId: number) {
    const readAt = new Date();
    const result = await this.adminNotificationRepository
      .createQueryBuilder()
      .update(AdminNotification)
      .set({
        is_read: true,
        read_at: readAt,
      })
      .where('admin_id = :adminId', { adminId })
      .andWhere('is_read = false')
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
