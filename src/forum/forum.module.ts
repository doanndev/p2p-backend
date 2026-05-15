import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ForumPost } from './entities/forum-post.entity';
import { User } from '../users/entities/user.entity';
import { Admin } from '../admins/entities/admin.entity';
import { RolePermission } from '../admins/entities/role-permission.entity';
import { AdminRole } from '../admins/entities/admin-role.entity';
import { Permission } from '../admins/entities/permission.entity';
import { ForumService } from './forum.service';
import {
  ForumPostsController,
  AdminForumPostsController,
} from './forum.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminsModule } from '../admins/admins.module';
import { AdminPermissionReadForumGuard } from '../admins/guards/admin-permission-read-forum.guard';
import { AdminPermissionCreateForumGuard } from '../admins/guards/admin-permission-create-forum.guard';
import { AdminPermissionUpdateForumGuard } from '../admins/guards/admin-permission-update-forum.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ForumPost,
      User,
      Admin,
      RolePermission,
      AdminRole,
      Permission,
    ]),
    NotificationsModule,
    AdminsModule,
  ],
  controllers: [ForumPostsController, AdminForumPostsController],
  providers: [
    ForumService,
    AdminPermissionReadForumGuard,
    AdminPermissionCreateForumGuard,
    AdminPermissionUpdateForumGuard,
  ],
})
export class ForumModule {}
