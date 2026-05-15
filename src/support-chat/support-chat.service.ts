import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SupportChat, SupportChatStatus } from './entities/support-chat.entity';
import {
  SupportChatMessage,
  SupportChatMessageType,
  SupportChatSenderType,
  SupportChatSystemEventType,
} from './entities/support-chat-message.entity';
import { SupportChatActor } from './support-chat.types';
import { QueryConversationsDto } from './dto/query-conversations.dto';
import { QueryConversationMessagesDto } from './dto/query-conversation-messages.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { User, UserStatus } from '../users/entities/user.entity';
import { Admin } from '../admins/entities/admin.entity';
import { AdminNotificationsService } from '../notifications/admin-notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../users/entities/notification.entity';

@Injectable()
export class SupportChatService {
  private readonly logger = new Logger(SupportChatService.name);

  constructor(
    @InjectRepository(SupportChat)
    private readonly supportChatRepository: Repository<SupportChat>,
    @InjectRepository(SupportChatMessage)
    private readonly supportChatMessageRepository: Repository<SupportChatMessage>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly adminNotificationsService: AdminNotificationsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Super admins: persists {@link AdminNotification} rows in the background (non-blocking). */
  private notifySuperAdminsNewSupportConversation(
    conversation: SupportChat,
    chatUser: Pick<User, 'uid' | 'uname' | 'uemail'> | null,
  ): void {
    const label = chatUser?.uname?.trim() || `user #${conversation.user_id}`;
    this.adminNotificationsService.notifySuperAdmins({
      type: NotificationType.SUPPORT_CHAT,
      title: 'New support chat',
      message: `User ${label} opened a new support conversation (#${conversation.id}).`,
      data: {
        conversation_id: conversation.id,
        conversation_code: conversation.conversation_code,
        user_id: conversation.user_id,
      },
    });
  }

  /** Super admins: audit notification in the background when an admin starts a support thread. */
  private notifySuperAdminsAdminCreatedSupportConversation(
    conversation: SupportChat,
    admin: Admin,
    targetUser: Pick<User, 'uid' | 'uname' | 'uemail'>,
  ): void {
    const userLabel = targetUser.uname?.trim() || `user #${targetUser.uid}`;
    const adminLabel = this.adminDisplayLabel(admin);
    this.adminNotificationsService.notifySuperAdmins({
      type: NotificationType.SUPPORT_CHAT,
      title: 'Support chat opened by admin',
      message: `${adminLabel} opened a support conversation (#${conversation.id}) for ${userLabel}.`,
      data: {
        conversation_id: conversation.id,
        conversation_code: conversation.conversation_code,
        user_id: conversation.user_id,
        created_by_admin_id: admin.admin_id,
      },
    });
  }

  private adminDisplayLabel(admin: Admin): string {
    return (
      admin.admin_fullname?.trim() ||
      admin.admin_username?.trim() ||
      `Admin #${admin.admin_id}`
    );
  }

  /** Persists {@link Notification} in the background (non-blocking). */
  private notifyUserAdminCreatedSupportConversation(
    conversation: SupportChat,
    admin: Admin,
  ): void {
    void this.dispatchNotifyUserAdminCreatedSupport(conversation, admin).catch(
      (err) => {
        this.logger.warn(
          `notifyUserAdminCreatedSupportConversation failed (conversationId=${conversation.id}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      },
    );
  }

  private async dispatchNotifyUserAdminCreatedSupport(
    conversation: SupportChat,
    admin: Admin,
  ): Promise<void> {
    await this.notificationsService.createForUser({
      userId: conversation.user_id,
      type: NotificationType.SUPPORT_CHAT,
      title: 'Support',
      message: `${this.adminDisplayLabel(admin)} opened a support conversation for you.`,
      data: {
        conversation_id: conversation.id,
        conversation_code: conversation.conversation_code,
        admin_id: admin.admin_id,
      },
    });
  }

  private toConversationResponse(conversation: SupportChat) {
    return {
      id: conversation.id,
      conversation_code: conversation.conversation_code,
      user_id: conversation.user_id,
      status: conversation.status,
      last_message_at: conversation.last_message_at,
      closed_at: conversation.closed_at,
      closed_by_admin_id: conversation.closed_by_admin_id,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    };
  }

  private toMessageResponse(message: SupportChatMessage) {
    return {
      id: message.id,
      conversation_id: message.conversation_id,
      sender_type: message.sender_type,
      sender_user_id: message.sender_user_id,
      sender_admin_id: message.sender_admin_id,
      message_type: message.message_type,
      content: message.content,
      system_event_type: message.system_event_type,
      seen_by_user_at: message.seen_by_user_at,
      seen_by_admin_at: message.seen_by_admin_at,
      created_at: message.created_at,
    };
  }

  async assertCanAccessConversation(
    actor: SupportChatActor,
    conversationId: number,
  ): Promise<SupportChat> {
    const conversation = await this.supportChatRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (actor.type === 'user' && conversation.user_id !== actor.id) {
      throw new ForbiddenException('You cannot access this conversation');
    }
    return conversation;
  }

  async getConversations(
    actor: SupportChatActor,
    query: QueryConversationsDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.supportChatRepository
      .createQueryBuilder('c')
      .leftJoin(User, 'u', 'u.uid = c.user_id');

    if (query.status) {
      qb.andWhere('c.status = :status', { status: query.status });
    }
    if (query.userId) {
      qb.andWhere('c.user_id = :userId', { userId: query.userId });
    }
    if (query.username?.trim()) {
      qb.andWhere('u.uname ILIKE :username', {
        username: `%${query.username.trim()}%`,
      });
    }
    if (query.email?.trim()) {
      qb.andWhere('u.uemail ILIKE :email', {
        email: `%${query.email.trim()}%`,
      });
    }
    if (query.q?.trim()) {
      qb.andWhere('c.conversation_code ILIKE :q', {
        q: `%${query.q.trim()}%`,
      });
    }

    if (actor.type === 'user') {
      const targetUserId = query.userId ?? actor.id;
      if (targetUserId !== actor.id) {
        throw new ForbiddenException(
          'You cannot access other users conversations',
        );
      }
      qb.andWhere('c.user_id = :ownerUserId', { ownerUserId: actor.id });
    }

    qb.orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    const userIds = [...new Set(rows.map((row) => row.user_id))];
    const users = userIds.length
      ? await this.userRepository.find({
          where: { uid: In(userIds) },
          select: [
            'uid',
            'uname',
            'uemail',
            'uphone',
            'uavatar',
            'ufulllname',
            'ustatus',
          ],
        })
      : [];
    const userMap = new Map(users.map((user) => [user.uid, user]));

    return {
      statusCode: 200,
      data: rows.map((row) => {
        const user = userMap.get(row.user_id);
        return {
          ...this.toConversationResponse(row),
          user: user
            ? {
                id: user.uid,
                username: user.uname,
                email: user.uemail,
                phone: user.uphone,
                avatar: user.uavatar,
                display_name: user.ufulllname,
                status: user.ustatus,
              }
            : null,
        };
      }),
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getConversationDetail(actor: SupportChatActor, id: number) {
    const conversation = await this.assertCanAccessConversation(actor, id);
    return {
      statusCode: 200,
      data: this.toConversationResponse(conversation),
    };
  }

  async getConversationMessages(
    actor: SupportChatActor,
    id: number,
    query: QueryConversationMessagesDto,
  ) {
    await this.assertCanAccessConversation(actor, id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const [rows, total] = await this.supportChatMessageRepository.findAndCount({
      where: { conversation_id: id },
      order: { created_at: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      statusCode: 200,
      data: rows.map((row) => this.toMessageResponse(row)),
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async createConversation(
    actor: SupportChatActor,
    dto: CreateConversationDto,
  ) {
    let ownerUserId: number;
    if (actor.type === 'user') {
      if (dto.userId != null && dto.userId !== actor.id) {
        throw new ForbiddenException(
          'You cannot create a conversation for another user',
        );
      }
      ownerUserId = actor.id;
    } else {
      if (!dto.userId) {
        throw new BadRequestException(
          'userId is required when creating a conversation as admin',
        );
      }
      ownerUserId = dto.userId;
    }

    const targetUser = await this.userRepository.findOne({
      where: { uid: ownerUserId },
      select: ['uid', 'uname', 'uemail', 'ustatus'],
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }
    if (targetUser.ustatus === UserStatus.BLOCK) {
      throw new BadRequestException('User account is blocked');
    }

    const existing = await this.supportChatRepository.findOne({
      where: { user_id: ownerUserId, status: SupportChatStatus.OPEN },
      order: { id: 'DESC' },
    });
    if (existing) {
      return {
        statusCode: 200,
        data: this.toConversationResponse(existing),
        message: 'Existing active conversation returned',
      };
    }

    const conversation = this.supportChatRepository.create({
      conversation_code: `user-${ownerUserId}`,
      user_id: ownerUserId,
      status: SupportChatStatus.OPEN,
      last_message_at: null,
      closed_at: null,
      closed_by_admin_id: null,
    });
    const saved = await this.supportChatRepository.save(conversation);

    if (actor.type === 'user') {
      this.notifySuperAdminsNewSupportConversation(saved, {
        uid: targetUser.uid,
        uname: targetUser.uname,
        uemail: targetUser.uemail,
      });
    } else if (actor.type === 'admin' && actor.admin) {
      this.notifyUserAdminCreatedSupportConversation(saved, actor.admin);
      this.notifySuperAdminsAdminCreatedSupportConversation(
        saved,
        actor.admin,
        targetUser,
      );
    }

    return {
      statusCode: 201,
      data: this.toConversationResponse(saved),
    };
  }

  async closeConversation(actor: SupportChatActor, id: number) {
    const conversation = await this.assertCanAccessConversation(actor, id);
    if (conversation.status === SupportChatStatus.CLOSED) {
      throw new BadRequestException('Conversation already closed');
    }

    conversation.status = SupportChatStatus.CLOSED;
    conversation.closed_at = new Date();
    conversation.closed_by_admin_id = actor.type === 'admin' ? actor.id : null;
    await this.supportChatRepository.save(conversation);

    return {
      statusCode: 200,
      data: this.toConversationResponse(conversation),
    };
  }

  async saveUserOrAdminMessage(
    actor: SupportChatActor,
    conversationId: number,
    content?: string,
    imageUrl?: string,
  ) {
    const conversation = await this.assertCanAccessConversation(
      actor,
      conversationId,
    );
    if (conversation.status !== SupportChatStatus.OPEN) {
      throw new BadRequestException('Conversation is closed');
    }

    const text = (content ?? '').trim();
    const url = (imageUrl ?? '').trim();
    if (text && url) {
      throw new BadRequestException('Send text and image in separate messages');
    }
    if (!text && !url) {
      throw new BadRequestException('Message content or imageUrl is required');
    }

    const isImage = Boolean(url);
    const storedContent = isImage ? url : text;
    const message = this.supportChatMessageRepository.create({
      conversation_id: conversation.id,
      sender_type:
        actor.type === 'admin'
          ? SupportChatSenderType.ADMIN
          : SupportChatSenderType.USER,
      sender_admin_id: actor.type === 'admin' ? actor.id : null,
      sender_user_id: actor.type === 'user' ? actor.id : null,
      message_type: isImage
        ? SupportChatMessageType.IMAGE
        : SupportChatMessageType.TEXT,
      content: storedContent,
      system_event_type: null,
      seen_by_user_at: actor.type === 'user' ? new Date() : null,
      seen_by_admin_at: actor.type === 'admin' ? new Date() : null,
    });
    const saved = await this.supportChatMessageRepository.save(message);

    conversation.last_message_at = saved.created_at;
    await this.supportChatRepository.save(conversation);

    return this.toMessageResponse(saved);
  }

  async saveSystemEvent(
    actor: SupportChatActor,
    conversationId: number,
    eventType: SupportChatSystemEventType,
  ) {
    const conversation = await this.assertCanAccessConversation(
      actor,
      conversationId,
    );

    const message = this.supportChatMessageRepository.create({
      conversation_id: conversation.id,
      sender_type: SupportChatSenderType.SYSTEM,
      sender_admin_id: actor.type === 'admin' ? actor.id : null,
      sender_user_id: actor.type === 'user' ? actor.id : null,
      message_type: SupportChatMessageType.SYSTEM_EVENT,
      content: eventType,
      system_event_type: eventType,
      seen_by_user_at: null,
      seen_by_admin_at: null,
    });
    const saved = await this.supportChatMessageRepository.save(message);
    return this.toMessageResponse(saved);
  }

  /** Tin từ user (text/image) trong hội thoại OPEN mà admin chưa đọc. */
  async countAdminUnreadForConversation(conversationId: number): Promise<number> {
    return this.supportChatMessageRepository
      .createQueryBuilder('m')
      .innerJoin(SupportChat, 'c', 'c.id = m.conversation_id')
      .where('m.conversation_id = :conversationId', { conversationId })
      .andWhere('c.status = :status', { status: SupportChatStatus.OPEN })
      .andWhere('m.sender_type = :senderType', {
        senderType: SupportChatSenderType.USER,
      })
      .andWhere('m.seen_by_admin_at IS NULL')
      .andWhere('m.message_type IN (:...types)', {
        types: [SupportChatMessageType.TEXT, SupportChatMessageType.IMAGE],
      })
      .getCount();
  }

  /**
   * Tổng unread admin + map theo conversation (chỉ hội thoại OPEN).
   * Dùng cho sidebar badge và WS inbox sync.
   */
  async getAdminUnreadSummary() {
    const rows = await this.supportChatMessageRepository
      .createQueryBuilder('m')
      .innerJoin(SupportChat, 'c', 'c.id = m.conversation_id')
      .select('m.conversation_id', 'conversationId')
      .addSelect('COUNT(*)', 'unread')
      .where('c.status = :status', { status: SupportChatStatus.OPEN })
      .andWhere('m.sender_type = :senderType', {
        senderType: SupportChatSenderType.USER,
      })
      .andWhere('m.seen_by_admin_at IS NULL')
      .andWhere('m.message_type IN (:...types)', {
        types: [SupportChatMessageType.TEXT, SupportChatMessageType.IMAGE],
      })
      .groupBy('m.conversation_id')
      .getRawMany<{ conversationId: string; unread: string }>();

    const byConversation: Record<number, number> = {};
    let total = 0;
    for (const row of rows) {
      const id = Number(row.conversationId);
      const count = Number(row.unread) || 0;
      if (!id || count <= 0) continue;
      byConversation[id] = count;
      total += count;
    }

    return {
      statusCode: 200,
      data: { total, byConversation },
    };
  }

  async markConversationSeen(actor: SupportChatActor, conversationId: number) {
    await this.assertCanAccessConversation(actor, conversationId);

    if (actor.type === 'user') {
      await this.supportChatMessageRepository
        .createQueryBuilder()
        .update(SupportChatMessage)
        .set({ seen_by_user_at: new Date() })
        .where('conversation_id = :conversationId', { conversationId })
        .andWhere('seen_by_user_at IS NULL')
        .execute();
    } else {
      await this.supportChatMessageRepository
        .createQueryBuilder()
        .update(SupportChatMessage)
        .set({ seen_by_admin_at: new Date() })
        .where('conversation_id = :conversationId', { conversationId })
        .andWhere('seen_by_admin_at IS NULL')
        .execute();
    }
  }
}
