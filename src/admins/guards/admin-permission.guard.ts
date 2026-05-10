import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin, AdminLevel } from '../entities/admin.entity';
import {
  Permission,
  PermissionResource,
  PermissionAction,
} from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private rolePermissionRepository: Repository<RolePermission>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const admin: Admin = request.user;

    if (!admin) {
      throw new ForbiddenException('Admin not authenticated');
    }

    // Check if admin is super_admin
    if (admin.admin_level === AdminLevel.SUPER_ADMIN) {
      return true;
    }

    // Check if admin has advanced permission on settings
    // Load admin with role if not already loaded
    let adminWithRole = admin;
    if (!admin.admin_role_id) {
      adminWithRole = await this.adminRepository.findOne({
        where: { admin_id: admin.admin_id },
      });
    }

    if (!adminWithRole || !adminWithRole.admin_role_id) {
      throw new ForbiddenException('Admin role not found');
    }

    // Find the advanced permission for settings and check role permission in one query
    const rolePermission = await this.rolePermissionRepository
      .createQueryBuilder('rp')
      .innerJoin('rp.permission', 'p')
      .where('rp.rp_role_id = :roleId', { roleId: adminWithRole.admin_role_id })
      .andWhere('rp.rp_granted = :granted', { granted: true })
      .andWhere('p.permission_resource = :resource', {
        resource: PermissionResource.SETTINGS,
      })
      .andWhere('p.permission_action = :action', {
        action: PermissionAction.ADVANCED,
      })
      .getOne();

    if (!rolePermission) {
      throw new ForbiddenException(
        'You do not have permission to access this resource. Required: Advanced settings permission or Super Admin role.',
      );
    }

    return true;
  }
}
