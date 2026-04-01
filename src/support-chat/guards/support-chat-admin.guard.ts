import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AdminLevel } from '../../admins/entities/admin.entity';
import { SupportChatActor } from '../support-chat.types';

@Injectable()
export class SupportChatAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const actor: SupportChatActor | undefined = request.supportChatActor;
    if (!actor || actor.type !== 'admin') {
      throw new ForbiddenException('Admin only');
    }

    const level = actor.admin?.admin_level;
    const allowed = [
      AdminLevel.SUPER_ADMIN,
      AdminLevel.ADMIN,
      AdminLevel.SUPPORT,
      AdminLevel.MODERATOR,
    ];
    if (!level || !allowed.includes(level)) {
      throw new ForbiddenException('Admin role is not allowed');
    }
    return true;
  }
}
