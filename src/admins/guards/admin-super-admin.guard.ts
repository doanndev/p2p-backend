import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Admin, AdminLevel } from '../entities/admin.entity';

@Injectable()
export class AdminSuperAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const admin: Admin = request.user;

    if (!admin) {
      throw new ForbiddenException('Admin not authenticated');
    }

    // Only super admin can access
    if (admin.admin_level !== AdminLevel.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only Super Admin can access this resource.',
      );
    }

    return true;
  }
}

