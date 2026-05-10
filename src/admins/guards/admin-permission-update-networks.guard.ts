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
  PermissionResource,
  PermissionAction,
} from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';

@Injectable()
export class AdminPermissionUpdateNetworksGuard implements CanActivate {
  constructor(
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
    @InjectRepository(RolePermission)
    private rolePermissionRepository: Repository<RolePermission>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const admin: Admin = request.user;

    if (!admin) {
      throw new ForbiddenException('Admin not authenticated');
    }

    // Super admin bypass
    if (admin.admin_level === AdminLevel.SUPER_ADMIN) {
      return true;
    }

    // Ensure role id
    let adminWithRole = admin;
    if (!admin.admin_role_id) {
      adminWithRole = await this.adminRepository.findOne({
        where: { admin_id: admin.admin_id },
      });
    }
    if (!adminWithRole || !adminWithRole.admin_role_id) {
      throw new ForbiddenException('Admin role not found');
    }

    // Check permission networks:update
    const rolePermission = await this.rolePermissionRepository
      .createQueryBuilder('rp')
      .innerJoin('rp.permission', 'p')
      .where('rp.rp_role_id = :roleId', { roleId: adminWithRole.admin_role_id })
      .andWhere('rp.rp_granted = :granted', { granted: true })
      .andWhere('p.permission_resource = :resource', {
        resource: PermissionResource.NETWORKS,
      })
      .andWhere('p.permission_action = :action', {
        action: PermissionAction.UPDATE,
      })
      .getOne();

    if (!rolePermission) {
      throw new ForbiddenException(
        'You do not have permission to access this resource. Required: networks update permission or Super Admin role.',
      );
    }

    return true;
  }
}
