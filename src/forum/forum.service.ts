import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ForumPost, ForumPostStatus } from './entities/forum-post.entity';
import { CreateForumPostDto } from './dto/create-forum-post.dto';
import { UpdateForumPostDto } from './dto/update-forum-post.dto';
import { QueryForumPostsDto } from './dto/query-forum-posts.dto';
import { QueryAdminForumPostsDto } from './dto/query-admin-forum-posts.dto';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../users/entities/notification.entity';
import { AdminRole } from '../admins/entities/admin-role.entity';
import {
  Permission,
  PermissionAction,
  PermissionResource,
  PermissionStatus,
} from '../admins/entities/permission.entity';
import { RolePermission } from '../admins/entities/role-permission.entity';

const NOTIFY_USER_BATCH = 40;

@Injectable()
export class ForumService implements OnModuleInit {
  private readonly logger = new Logger(ForumService.name);

  constructor(
    @InjectRepository(ForumPost)
    private readonly forumPostRepository: Repository<ForumPost>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AdminRole)
    private readonly adminRoleRepository: Repository<AdminRole>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.syncForumPermissionsToModeratorRole();
    } catch (e) {
      this.logger.warn(
        `Forum moderator permission sync skipped: ${(e as Error).message}`,
      );
    }
  }

  /** Ensure forum read/create/update permissions exist on the `moderator` role (existing DBs / first deploy). */
  private async syncForumPermissionsToModeratorRole(): Promise<void> {
    const role = await this.adminRoleRepository.findOne({
      where: { role_name: 'moderator' },
    });
    if (!role) {
      return;
    }

    const grants: Array<{
      resource: PermissionResource;
      action: PermissionAction;
      name: string;
    }> = [
      {
        resource: PermissionResource.FORUM,
        action: PermissionAction.READ,
        name: 'forum:read',
      },
      {
        resource: PermissionResource.FORUM,
        action: PermissionAction.CREATE,
        name: 'forum:create',
      },
      {
        resource: PermissionResource.FORUM,
        action: PermissionAction.UPDATE,
        name: 'forum:update',
      },
    ];

    for (const { resource, action, name } of grants) {
      let permission = await this.permissionRepository.findOne({
        where: { permission_resource: resource, permission_action: action },
      });
      if (!permission) {
        permission = this.permissionRepository.create({
          permission_name: name,
          permission_resource: resource,
          permission_action: action,
          permission_status: PermissionStatus.ACTIVE,
        });
        permission = await this.permissionRepository.save(permission);
      }

      const existingRp = await this.rolePermissionRepository.findOne({
        where: {
          rp_role_id: role.role_id,
          rp_permission_id: permission.permission_id,
        },
      });
      if (!existingRp) {
        await this.rolePermissionRepository.save({
          rp_role_id: role.role_id,
          rp_permission_id: permission.permission_id,
          rp_granted: true,
        });
      }
    }
  }

  private toPublicRow(post: ForumPost) {
    return {
      id: post.forum_post_id,
      title: post.title,
      content: post.content,
      published_at: post.published_at,
      created_at: post.created_at,
      updated_at: post.updated_at,
    };
  }

  private toAdminRow(post: ForumPost) {
    return {
      id: post.forum_post_id,
      title: post.title,
      content: post.content,
      status: post.status,
      deleted_at: post.deleted_at,
      published_at: post.published_at,
      author_admin_id: post.author_admin_id,
      created_at: post.created_at,
      updated_at: post.updated_at,
    };
  }

  async listPublishedForUser(query: QueryForumPostsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.forumPostRepository
      .createQueryBuilder('p')
      .where('p.status = :status', { status: ForumPostStatus.PUBLISHED })
      .andWhere('p.deleted_at IS NULL')
      .orderBy('p.published_at', 'DESC', 'NULLS LAST')
      .addOrderBy('p.forum_post_id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      statusCode: 200,
      data: rows.map((r) => this.toPublicRow(r)),
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getPublishedForUser(id: number) {
    const post = await this.forumPostRepository.findOne({
      where: {
        forum_post_id: id,
        status: ForumPostStatus.PUBLISHED,
        deleted_at: IsNull(),
      },
    });

    if (!post) {
      throw new NotFoundException('Forum post not found');
    }

    return {
      statusCode: 200,
      data: this.toPublicRow(post),
    };
  }

  async listForAdmin(query: QueryAdminForumPostsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.forumPostRepository
      .createQueryBuilder('p')
      .orderBy('p.forum_post_id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (!query.include_deleted) {
      qb.andWhere('p.deleted_at IS NULL');
    }

    if (query.status) {
      qb.andWhere('p.status = :status', { status: query.status });
    }

    const [rows, total] = await qb.getManyAndCount();

    return {
      statusCode: 200,
      data: rows.map((r) => this.toAdminRow(r)),
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getForAdmin(id: number) {
    const post = await this.forumPostRepository.findOne({
      where: { forum_post_id: id },
    });

    if (!post) {
      throw new NotFoundException('Forum post not found');
    }

    return {
      statusCode: 200,
      data: this.toAdminRow(post),
    };
  }

  async createForAdmin(adminId: number, dto: CreateForumPostDto) {
    const status = dto.status ?? ForumPostStatus.DRAFT;
    const now = new Date();

    const post = this.forumPostRepository.create({
      title: dto.title.trim(),
      content: dto.content.trim(),
      status,
      author_admin_id: adminId,
      deleted_at: null,
      published_at: status === ForumPostStatus.PUBLISHED ? now : null,
    });

    const saved = await this.forumPostRepository.save(post);

    if (status === ForumPostStatus.PUBLISHED) {
      this.enqueueNotifyAllUsersOfForumPost(saved);
    }

    return {
      statusCode: 201,
      data: this.toAdminRow(saved),
    };
  }

  async updateForAdmin(id: number, dto: UpdateForumPostDto) {
    const post = await this.forumPostRepository.findOne({
      where: { forum_post_id: id },
    });

    if (!post) {
      throw new NotFoundException('Forum post not found');
    }

    const prevStatus = post.status;

    if (dto.restore === true) {
      post.deleted_at = null;
    }

    if (dto.title !== undefined) {
      post.title = dto.title.trim();
    }
    if (dto.content !== undefined) {
      post.content = dto.content.trim();
    }

    let becamePublished = false;
    if (dto.status !== undefined) {
      if (dto.status === ForumPostStatus.PUBLISHED) {
        post.deleted_at = null;
        if (!post.published_at) {
          post.published_at = new Date();
        }
        if (prevStatus !== ForumPostStatus.PUBLISHED) {
          becamePublished = true;
        }
      }
      post.status = dto.status;
    }

    const saved = await this.forumPostRepository.save(post);

    if (becamePublished) {
      this.enqueueNotifyAllUsersOfForumPost(saved);
    }

    return {
      statusCode: 200,
      data: this.toAdminRow(saved),
    };
  }

  async softDeleteForAdmin(id: number) {
    const post = await this.forumPostRepository.findOne({
      where: { forum_post_id: id },
    });

    if (!post) {
      throw new NotFoundException('Forum post not found');
    }

    if (post.deleted_at) {
      throw new BadRequestException('Post is already deleted');
    }

    post.deleted_at = new Date();
    await this.forumPostRepository.save(post);

    return {
      statusCode: 200,
      data: { id: post.forum_post_id, deleted_at: post.deleted_at },
    };
  }

  /** Fire-and-forget fan-out to all users (do not block HTTP handlers). */
  private enqueueNotifyAllUsersOfForumPost(post: ForumPost): void {
    void this.notifyAllUsersOfForumPost(post).catch((err) => {
      this.logger.error(
        `Forum broadcast job failed postId=${post.forum_post_id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    });
  }

  private async notifyAllUsersOfForumPost(post: ForumPost): Promise<void> {
    const title = `Forum: ${post.title}`.slice(0, 500);
    const message =
      post.content.length > 400
        ? `${post.content.slice(0, 400)}…`
        : post.content;

    let offset = 0;
    while (true) {
      const batch = await this.userRepository.find({
        select: ['uid'],
        order: { uid: 'ASC' },
        skip: offset,
        take: NOTIFY_USER_BATCH,
      });

      if (!batch.length) {
        break;
      }

      await Promise.all(
        batch.map((u) =>
          this.notificationsService
            .createForUser({
              userId: u.uid,
              type: NotificationType.FORUM,
              title,
              message,
              data: { forum_post_id: post.forum_post_id },
            })
            .catch((err) => {
              this.logger.warn(
                `Forum notify failed for user ${u.uid}: ${(err as Error).message}`,
              );
            }),
        ),
      );

      offset += NOTIFY_USER_BATCH;
    }
  }
}
