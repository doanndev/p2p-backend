import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AdminRole, RoleStatus } from './entities/admin-role.entity';
import {
  Permission,
  PermissionResource,
  PermissionAction,
  PermissionStatus,
} from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Admin, AdminLevel, AdminStatus } from './entities/admin.entity';
import {
  AdminLog,
  AdminLogAction,
  AdminLogModule,
} from './entities/admin-log.entity';
import { LoginAdminDto } from './dto/login-admin.dto';
import { CreateAdminDto } from './dto/create-admin.dto';

@Injectable()
export class AdminsAuthService {
  constructor(
    @InjectRepository(AdminRole)
    private adminRoleRepository: Repository<AdminRole>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
    @InjectRepository(AdminLog)
    private adminLogRepository: Repository<AdminLog>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(
    loginAdminDto: LoginAdminDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    admin: Admin;
    tokens: { access_token: string; refresh_token: string };
    response: {
      statusCode: number;
      message: string;
      admin: {
        id: number;
        username: string;
        email: string;
        fullname: string;
        level: string;
      };
    };
    cookieOptions: {
      admin_access_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none';
        path: string;
      };
      admin_refresh_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none';
        path: string;
      };
    };
  }> {
    // Find admin by email (can be admin_username or admin_email)
    const admin = await this.adminRepository.findOne({
      where: [
        { admin_username: loginAdminDto.email },
        { admin_email: loginAdminDto.email },
      ],
    });

    if (!admin) {
      throw new BadRequestException('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(
      loginAdminDto.password,
      admin.admin_password,
    );
    if (!isPasswordValid) {
      throw new BadRequestException('Invalid email or password');
    }

    // Check if admin is active
    if (admin.admin_status !== AdminStatus.ACTIVE) {
      throw new BadRequestException('Admin account is not active');
    }

    // Update last login and IP
    admin.admin_last_login = new Date();
    admin.admin_last_ip = ipAddress || null;
    await this.adminRepository.save(admin);

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: admin.admin_id,
      log_action: AdminLogAction.LOGIN,
      log_module: AdminLogModule.ADMINS,
      log_description: `Admin ${admin.admin_username} logged in successfully`,
      log_ip_address: ipAddress || null,
      log_user_agent: userAgent || null,
    });

    // Generate tokens
    const tokens = await this.generateTokens(admin);

    // Prepare cookie options
    const accessTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    const refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const cookieOptions = {
      admin_access_token: {
        value: tokens.access_token,
        expires: accessTokenExpires,
        httpOnly: true,
        secure: true, // Required when sameSite is 'none'
        sameSite: 'none' as const,
        path: '/',
      },
      admin_refresh_token: {
        value: tokens.refresh_token,
        expires: refreshTokenExpires,
        httpOnly: true,
        secure: true, // Required when sameSite is 'none'
        sameSite: 'none' as const,
        path: '/',
      },
    };

    // Prepare response data
    const response = {
      statusCode: 200,
      message: 'Login successful',
      admin: {
        id: admin.admin_id,
        username: admin.admin_username,
        email: admin.admin_email,
        fullname: admin.admin_fullname,
        level: admin.admin_level,
      },
    };

    return {
      admin,
      tokens,
      response,
      cookieOptions,
    };
  }

  async generateTokens(admin: Admin): Promise<{
    access_token: string;
    refresh_token: string;
  }> {
    const payload = {
      sub: admin.admin_id,
      username: admin.admin_username,
      email: admin.admin_email,
      level: admin.admin_level,
      role_id: admin.admin_role_id,
    };

    const access_token = await this.jwtService.signAsync(payload, {
      expiresIn: '15m',
    });

    const refresh_token = await this.jwtService.signAsync(payload, {
      expiresIn: '7d',
    });

    return {
      access_token,
      refresh_token,
    };
  }

  async refreshToken(
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    admin: Admin;
    tokens: { access_token: string; refresh_token: string };
    response: {
      statusCode: number;
      message: string;
      admin: {
        id: number;
        username: string;
        email: string;
        fullname: string;
        level: string;
      };
    };
    cookieOptions: {
      admin_access_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none';
        path: string;
      };
      admin_refresh_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none';
        path: string;
      };
    };
  }> {
    if (!refreshToken) {
      throw new BadRequestException('Refresh token is required');
    }

    // Verify refresh token
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(refreshToken);
    } catch {
      throw new BadRequestException('Invalid or expired refresh token');
    }

    // Find admin by ID from token
    const admin = await this.adminRepository.findOne({
      where: { admin_id: payload.sub },
    });

    if (!admin) {
      throw new BadRequestException('Admin not found');
    }

    // Check if admin is active
    if (admin.admin_status !== AdminStatus.ACTIVE) {
      throw new BadRequestException('Admin account is not active');
    }

    // Update last login and IP
    admin.admin_last_login = new Date();
    admin.admin_last_ip = ipAddress || null;
    await this.adminRepository.save(admin);

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: admin.admin_id,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.ADMINS,
      log_description: `Admin ${admin.admin_username} refreshed token`,
      log_ip_address: ipAddress || null,
      log_user_agent: userAgent || null,
    });

    // Generate new tokens
    const tokens = await this.generateTokens(admin);

    // Prepare cookie options
    const accessTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    const refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const cookieOptions = {
      admin_access_token: {
        value: tokens.access_token,
        expires: accessTokenExpires,
        httpOnly: true,
        secure: true, // Required when sameSite is 'none'
        sameSite: 'none' as const,
        path: '/',
      },
      admin_refresh_token: {
        value: tokens.refresh_token,
        expires: refreshTokenExpires,
        httpOnly: true,
        secure: true, // Required when sameSite is 'none'
        sameSite: 'none' as const,
        path: '/',
      },
    };

    // Prepare response data
    const response = {
      statusCode: 200,
      message: 'Token refreshed successfully',
      admin: {
        id: admin.admin_id,
        username: admin.admin_username,
        email: admin.admin_email,
        fullname: admin.admin_fullname,
        level: admin.admin_level,
      },
    };

    return {
      admin,
      tokens,
      response,
      cookieOptions,
    };
  }

  async getCurrentAdmin(adminId: number): Promise<{
    id: number;
    username: string;
    email: string;
    fullname: string;
    avatar: string | null;
    phone: string | null;
    level: string;
    last_login: Date | null;
    status: string;
    two_factor_enabled: boolean;
    created_at: Date;
    updated_at: Date;
  }> {
    const admin = await this.adminRepository.findOne({
      where: { admin_id: adminId },
      relations: ['admin_role'],
    });

    if (!admin) {
      throw new BadRequestException('Admin not found');
    }

    // Return admin info without sensitive data (no password, no two_factor_secret, no role_id)
    return {
      id: admin.admin_id,
      username: admin.admin_username,
      email: admin.admin_email,
      fullname: admin.admin_fullname,
      avatar: admin.admin_avatar,
      phone: admin.admin_phone,
      level: admin.admin_level,
      last_login: admin.admin_last_login,
      status: admin.admin_status,
      two_factor_enabled: admin.admin_two_factor_enabled,
      created_at: admin.created_at,
      updated_at: admin.updated_at,
    };
  }

  async getMyPermissions(adminId: number): Promise<{
    statusCode: number;
    message: string;
    data: Record<string, boolean>;
  }> {
    const admin = await this.adminRepository.findOne({
      where: { admin_id: adminId },
    });
    if (!admin) {
      throw new BadRequestException('Admin not found');
    }

    const allPermissions = await this.permissionRepository.find({
      where: { permission_status: PermissionStatus.ACTIVE },
      order: { permission_resource: 'ASC', permission_action: 'ASC' },
    });

    const grantedPermissionIds = new Set<number>();

    if (admin.admin_level === AdminLevel.SUPER_ADMIN) {
      allPermissions.forEach((p) => grantedPermissionIds.add(p.permission_id));
    } else if (admin.admin_role_id) {
      const rolePerms = await this.rolePermissionRepository.find({
        where: {
          rp_role_id: admin.admin_role_id,
          rp_granted: true,
        },
      });
      rolePerms.forEach((rp) => grantedPermissionIds.add(rp.rp_permission_id));
    }

    const data: Record<string, boolean> = {};
    for (const p of allPermissions) {
      const key = `${p.permission_resource}_${p.permission_action}`;
      data[key] = grantedPermissionIds.has(p.permission_id);
    }

    return {
      statusCode: 200,
      message: 'Permissions retrieved successfully',
      data,
    };
  }

  /**
   * Get or create the "moderator" role with permissions:
   * - users:read (xem KYC, danh sách users)
   * - users:advanced (duyệt/từ chối KYC, đặt/hủy KOL, duyệt/từ chối KOL và bài viết)
   */
  private async getOrCreateModeratorRole(): Promise<AdminRole> {
    let role = await this.adminRoleRepository.findOne({
      where: { role_name: 'moderator' },
    });
    if (!role) {
      role = this.adminRoleRepository.create({
        role_name: 'moderator',
        role_description:
          'Quản lý KYC, xem users, đặt/hủy KOL, duyệt/từ chối KOL và bài viết',
        role_status: RoleStatus.ACTIVE,
      });
      role = await this.adminRoleRepository.save(role);
    }

    const permissionsToGrant: Array<{
      resource: PermissionResource;
      action: PermissionAction;
      name: string;
    }> = [
      {
        resource: PermissionResource.USERS,
        action: PermissionAction.READ,
        name: 'users:read',
      },
      {
        resource: PermissionResource.USERS,
        action: PermissionAction.ADVANCED,
        name: 'users:advanced',
      },
    ];

    for (const { resource, action, name } of permissionsToGrant) {
      let permission = await this.permissionRepository.findOne({
        where: {
          permission_resource: resource,
          permission_action: action,
        },
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

    return role;
  }

  async createAdmin(
    createAdminDto: CreateAdminDto,
    originatorAdminId?: number,
  ): Promise<{
    statusCode: number;
    message: string;
    admin: {
      id: number;
      username: string;
      email: string;
      fullname: string;
      level: string;
    };
  }> {
    const fullname = createAdminDto.fullname?.trim() || createAdminDto.username;
    const level = createAdminDto.level.toLowerCase();

    const existingUsername = await this.adminRepository.findOne({
      where: { admin_username: createAdminDto.username.trim() },
    });
    if (existingUsername) {
      throw new BadRequestException('Username already exists');
    }
    const existingEmail = await this.adminRepository.findOne({
      where: { admin_email: createAdminDto.email.trim() },
    });
    if (existingEmail) {
      throw new BadRequestException('Email already exists');
    }

    if (level === 'super_admin') {
      throw new BadRequestException(
        'Creating super_admin via this API is not allowed.',
      );
    }

    let role: AdminRole;
    let adminLevel: AdminLevel;

    if (level === 'moderator') {
      role = await this.getOrCreateModeratorRole();
      adminLevel = AdminLevel.MODERATOR;
    } else {
      const roleName = level;
      const existingRole = await this.adminRoleRepository.findOne({
        where: { role_name: roleName },
      });
      if (!existingRole) {
        throw new BadRequestException(
          `Role for level "${level}" not found. Only level "moderator" is auto-created with permissions.`,
        );
      }
      role = existingRole;
      adminLevel = level === 'admin' ? AdminLevel.ADMIN : AdminLevel.SUPPORT;
    }

    const hashedPassword = await bcrypt.hash(createAdminDto.password, 10);

    const admin = this.adminRepository.create({
      admin_username: createAdminDto.username.trim(),
      admin_email: createAdminDto.email.trim(),
      admin_password: hashedPassword,
      admin_fullname: fullname,
      admin_level: adminLevel,
      admin_role_id: role.role_id,
      admin_status: AdminStatus.ACTIVE,
      admin_originator: originatorAdminId ?? null,
    });
    const savedAdmin = await this.adminRepository.save(admin);

    await this.adminLogRepository.save({
      log_admin_id: originatorAdminId ?? savedAdmin.admin_id,
      log_action: AdminLogAction.CREATE,
      log_module: AdminLogModule.ADMINS,
      log_description: `Admin created: ${savedAdmin.admin_username} (level: ${savedAdmin.admin_level})`,
      log_ip_address: null,
      log_user_agent: null,
    });

    return {
      statusCode: 201,
      message: 'Admin created successfully.',
      admin: {
        id: savedAdmin.admin_id,
        username: savedAdmin.admin_username,
        email: savedAdmin.admin_email,
        fullname: savedAdmin.admin_fullname,
        level: savedAdmin.admin_level,
      },
    };
  }

  async logout(
    adminId: number,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    // Find admin by ID
    const admin = await this.adminRepository.findOne({
      where: { admin_id: adminId },
    });

    if (!admin) {
      throw new BadRequestException('Admin not found');
    }

    // Create admin log for logout
    await this.adminLogRepository.save({
      log_admin_id: admin.admin_id,
      log_action: AdminLogAction.LOGOUT,
      log_module: AdminLogModule.ADMINS,
      log_description: `Admin ${admin.admin_username} logged out`,
      log_ip_address: ipAddress || null,
      log_user_agent: userAgent || null,
    });
  }
}
