import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as bip39 from 'bip39';
import * as bip32 from 'bip32';
import * as tinysecp from 'tiny-secp256k1';
import { derivePath } from 'ed25519-hd-key';
import {
  Keypair,
  PublicKey,
  Connection,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  getMint,
  getAccount,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  HDNodeWallet,
  Wallet,
  parseUnits,
  Contract,
  Interface,
  getAddress,
} from 'ethers';
import { createEvmJsonRpcProvider } from '../common/evm-json-rpc-provider.factory';
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
import { User, UserSex, UserStatus } from '../users/entities/user.entity';
import {
  UserVerify,
  UserVerifyStatus,
} from '../users/entities/user-verify.entity';
import { VerifyLog } from '../users/entities/verify-log.entity';
import {
  KolRegister,
  KolRegisterStatus,
} from '../users/entities/kol-register.entity';
import {
  KolArticle,
  KolArticleStatus,
} from '../users/entities/kol-article.entity';
import {
  WalletHistory,
  WalletHistoryType,
  WalletHistoryOption,
  WalletHistoryStatus,
} from '../wallets/entities/wallet-history.entity';
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import {
  WalletTransfer,
  WalletTransferFrom,
  WalletTransferTo,
  WalletTransferStatus,
} from '../wallets/entities/wallet-transfer.entity';
import { Coin, CoinStatus } from '../settings/entities/coin.entity';
import { Network, NetStatus } from '../settings/entities/network.entity';
import { UserWalletNetwork } from '../wallets/entities/user-wallet-network.entity';
import { ActiveWalletTracker } from '../wallets/entities/active-wallet-tracker.entity';
import { WalletDepositTracker } from '../wallets/entities/wallet-deposit-tracker.entity';
import {
  CoinNetwork,
  CoinNetworkStatus,
} from '../settings/entities/coin-network.entity';
import { AddCoinDto } from './dto/add-coin.dto';
import { UpdateCoinDto } from './dto/update-coin.dto';
import { AddNetworkDto } from './dto/add-network.dto';
import { UpdateNetworkDto } from './dto/update-network.dto';
import { UpdateKycStatusDto } from './dto/update-kyc-status.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { RpcRateLimitService } from '../common/rpc-rate-limit.service';
import { AdminSettingsConfigService } from '../settings/admin-settings-config.service';

/** USDT (wrapped) mint trên Solana – dùng khi cn_coin_mint cho SOL USDT chưa đúng trong DB. */
const SOL_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

/** Thời gian tối đa còn lại đến lần chạy tự động (ms) để API main-withdraw được phép gọi. */
const MAIN_WITHDRAW_API_MAX_WAIT_MS = 3 * 60 * 1000; // 3 phút
/** Khoảng thời gian (ms) reset lịch tự động sau mỗi lần chạy (cron hoặc API thành công). */
const MAIN_WITHDRAW_AUTO_INTERVAL_MS = 10 * 60 * 1000; // 10 phút

@Injectable()
export class AdminsService implements OnModuleInit {
  private isMainWithdrawProcessing = false;
  // Ghi nhớ các network mà ví trợ phí đã hết tiền để không thử lại cho các ví sau
  private feeSupportDepletedNetworks = new Set<string>();
  // Thời điểm (timestamp) lần chạy tự động tiếp theo; dùng để kiểm tra khi gọi API
  private nextAutoMainWithdrawAt = 0;

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
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserVerify)
    private userVerifyRepository: Repository<UserVerify>,
    @InjectRepository(VerifyLog)
    private verifyLogRepository: Repository<VerifyLog>,
    @InjectRepository(WalletHistory)
    private walletHistoryRepository: Repository<WalletHistory>,
    @InjectRepository(UserWallet)
    private userWalletRepository: Repository<UserWallet>,
    @InjectRepository(WalletTransfer)
    private walletTransferRepository: Repository<WalletTransfer>,
    @InjectRepository(Coin)
    private coinRepository: Repository<Coin>,
    @InjectRepository(Network)
    private networkRepository: Repository<Network>,
    @InjectRepository(UserWalletNetwork)
    private useWalletNetworkRepository: Repository<UserWalletNetwork>,
    @InjectRepository(ActiveWalletTracker)
    private activeWalletTrackerRepository: Repository<ActiveWalletTracker>,
    @InjectRepository(WalletDepositTracker)
    private walletDepositTrackerRepository: Repository<WalletDepositTracker>,
    @InjectRepository(CoinNetwork)
    private coinNetworkRepository: Repository<CoinNetwork>,
    @InjectRepository(KolRegister)
    private kolRegisterRepository: Repository<KolRegister>,
    @InjectRepository(KolArticle)
    private kolArticleRepository: Repository<KolArticle>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private rpcRateLimitService: RpcRateLimitService,
    private adminSettingsConfigService: AdminSettingsConfigService,
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

  async getPlatformStatistics(): Promise<{
    statusCode: number;
    message: string;
    statistics: {
      total_users: number;
      total_staking_count: number;
      total_staking_amount: number;
      total_estimated_reward: number;
      total_deposit: number;
      total_withdraw: number;
      total_reward: number;
      total_balance: number;
      total_balance_gift: number;
      total_transfer_main: number;
    };
  }> {
    // 1. Tổng số users
    const totalUsers = await this.userRepository.count();

    const totalStakingCount = 0;
    const totalStakingAmount = 0;
    const totalEstimatedReward = 0;

    // 5. Tổng số tiền nạp (deposit - SUCCESS hoặc CHECKED)
    const totalDepositResult = await this.walletHistoryRepository
      .createQueryBuilder('wh')
      .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
      .where('wh.wh_option = :option', { option: WalletHistoryOption.DEPOSIT })
      .andWhere('wh.wh_status IN (:...statuses)', {
        statuses: [WalletHistoryStatus.SUCCESS, WalletHistoryStatus.CHECKED],
      })
      .getRawOne();
    const totalDeposit = parseFloat(totalDepositResult?.total || '0');

    // 6. Tổng số tiền rút (withdraw - SUCCESS hoặc CHECKED)
    const totalWithdrawResult = await this.walletHistoryRepository
      .createQueryBuilder('wh')
      .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
      .where('wh.wh_option = :option', { option: WalletHistoryOption.WITHDRAW })
      .andWhere('wh.wh_status IN (:...statuses)', {
        statuses: [WalletHistoryStatus.SUCCESS, WalletHistoryStatus.CHECKED],
      })
      .getRawOne();
    const totalWithdraw = parseFloat(totalWithdrawResult?.total || '0');

    // 7. Tổng số tiền reward (tổng uw_balance_reward trên hệ thống)
    const totalRewardResult = await this.userWalletRepository
      .createQueryBuilder('uw')
      .select('COALESCE(SUM(uw.uw_balance_reward), 0)', 'total')
      .getRawOne();
    const totalReward = parseFloat(totalRewardResult?.total || '0');

    // 8. Tổng số tiền trong hệ thống (balance)
    const totalBalanceResult = await this.userWalletRepository
      .createQueryBuilder('uw')
      .select('COALESCE(SUM(uw.uw_balance), 0)', 'total')
      .getRawOne();
    const totalBalance = parseFloat(totalBalanceResult?.total || '0');

    // 9. Tổng số tiền gift trong hệ thống
    const totalBalanceGiftResult = await this.userWalletRepository
      .createQueryBuilder('uw')
      .select('COALESCE(SUM(uw.uw_balance_gift), 0)', 'total')
      .getRawOne();
    const totalBalanceGift = parseFloat(totalBalanceGiftResult?.total || '0');

    // 10. Tổng số tiền chuyển từ gift sang main (wallet_transfers)
    const totalTransferMainResult = await this.walletTransferRepository
      .createQueryBuilder('wt')
      .select('COALESCE(SUM(wt.wt_amount), 0)', 'total')
      .where('wt.wt_from = :from', { from: WalletTransferFrom.GIFT })
      .andWhere('wt.wt_to = :to', { to: WalletTransferTo.MAIN })
      .andWhere('wt.wt_status = :status', {
        status: WalletTransferStatus.SUCCESS,
      })
      .getRawOne();
    const totalTransferMain = parseFloat(totalTransferMainResult?.total || '0');

    return {
      statusCode: 200,
      message: 'Platform statistics retrieved successfully',
      statistics: {
        total_users: totalUsers,
        total_staking_count: totalStakingCount,
        total_staking_amount: totalStakingAmount,
        total_estimated_reward: totalEstimatedReward,
        total_deposit: totalDeposit,
        total_withdraw: totalWithdraw,
        total_reward: totalReward,
        total_balance: totalBalance,
        total_balance_gift: totalBalanceGift,
        total_transfer_main: totalTransferMain,
      },
    };
  }

  async getRunningStatistics(): Promise<{
    statusCode: number;
    message: string;
    statistics: {
      total_users: number;
      total_staking_count: number;
      total_staking_amount: number;
      total_estimated_reward: number;
      total_deposit: number;
      total_withdraw: number;
      total_reward: number;
      total_balance: number;
      total_balance_gift: number;
      total_transfer_main: number;
    };
  }> {
    const platform = await this.getPlatformStatistics();
    return {
      statusCode: 200,
      message: 'Running statistics retrieved successfully',
      statistics: platform.statistics,
    };
  }

  async getUsersPaginated(
    page = 1,
    limit = 30,
  ): Promise<{
    statusCode: number;
    data: Array<{
      uid: number;
      uname: string;
      email: string;
      phone: string | null;
      avatar: string | null;
      display_name: string;
      birthday: Date | null;
      sex: UserSex;
      level: number;
      status: UserStatus;
      telegram: string | null;
      ref: string;
      active_email: boolean;
      verify: boolean;
      kol: boolean;
      created_at: Date;
    }>;
    meta: {
      page: number;
      limit: number;
      total: number;
      total_pages: number;
    };
  }> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const currentPage = Math.max(page, 1);
    const skip = (currentPage - 1) * safeLimit;

    const [items, total] = await this.userRepository.findAndCount({
      select: [
        'uid',
        'uname',
        'uemail',
        'uphone',
        'uavatar',
        'ufulllname',
        'ubirthday',
        'usex',
        'ulevel',
        'ustatus',
        'utelegram',
        'uref',
        'u_active_email',
        'uverify',
        'ukol',
        'created_at',
      ],
      order: { created_at: 'DESC' },
      skip,
      take: safeLimit,
    });

    const mapped = items.map((u) => ({
      uid: u.uid,
      uname: u.uname,
      email: u.uemail,
      phone: u.uphone,
      avatar: u.uavatar,
      display_name: u.ufulllname,
      birthday: u.ubirthday,
      sex: u.usex,
      level: u.ulevel,
      status: u.ustatus,
      telegram: u.utelegram,
      ref: u.uref,
      active_email: u.u_active_email,
      verify: u.uverify,
      kol: u.ukol,
      created_at: u.created_at,
    }));

    return {
      statusCode: 200,
      data: mapped,
      meta: {
        page: currentPage,
        limit: safeLimit,
        total,
        total_pages: Math.ceil(total / safeLimit) || 1,
      },
    };
  }

  async getUserById(uid: number): Promise<{
    statusCode: number;
    data: {
      uid: number;
      uname: string;
      email: string;
      phone: string | null;
      avatar: string | null;
      display_name: string;
      birthday: Date | null;
      sex: UserSex;
      level: number;
      status: UserStatus;
      telegram: string | null;
      ref: string;
      active_email: boolean;
      verify: boolean;
      kol: boolean;
      created_at: Date;
    };
  }> {
    if (!uid || Number.isNaN(uid)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userRepository.findOne({
      select: [
        'uid',
        'uname',
        'uemail',
        'uphone',
        'uavatar',
        'ufulllname',
        'ubirthday',
        'usex',
        'ulevel',
        'ustatus',
        'utelegram',
        'uref',
        'u_active_email',
        'uverify',
        'ukol',
        'created_at',
      ],
      where: { uid },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const mapped = {
      uid: user.uid,
      uname: user.uname,
      email: user.uemail,
      phone: user.uphone,
      avatar: user.uavatar,
      display_name: user.ufulllname,
      birthday: user.ubirthday,
      sex: user.usex,
      level: user.ulevel,
      status: user.ustatus,
      telegram: user.utelegram,
      ref: user.uref,
      active_email: user.u_active_email,
      verify: user.uverify,
      kol: user.ukol,
      created_at: user.created_at,
    };

    return {
      statusCode: 200,
      data: mapped,
    };
  }

  async toggleUserKol(
    uid: number,
    status?: 'success' | 'fail',
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      uid: number;
      kol: boolean;
    };
  }> {
    if (!uid || Number.isNaN(uid)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userRepository.findOne({
      select: ['uid', 'ukol'],
      where: { uid },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Determine new kol value
    let newKol: boolean;
    if (status !== undefined) {
      // If status is provided, set ukol based on status
      // success -> true, fail -> false
      newKol = status === 'success';
    } else {
      // If status is not provided, toggle (xen kẽ)
      newKol = !user.ukol;
    }

    // If status is provided, always update kol_registers based on status
    if (status !== undefined) {
      if (status === 'fail' && newKol === false) {
        // Update all kol_registers with status = success to fail
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.SUCCESS,
          },
          {
            kr_status: KolRegisterStatus.FAIL,
          },
        );

        // Update all kol_registers with status = pending to fail
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.PENDING,
          },
          {
            kr_status: KolRegisterStatus.FAIL,
          },
        );
      } else if (status === 'success' && newKol === true) {
        // Update all kol_registers with status = pending to success
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.PENDING,
          },
          {
            kr_status: KolRegisterStatus.SUCCESS,
          },
        );
      }
    } else {
      // If status is not provided (toggle mode), update kol_registers only when value changes
      // If changing from true to false, update kol_registers
      if (user.ukol === true && newKol === false) {
        // Update all kol_registers with status = success to fail
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.SUCCESS,
          },
          {
            kr_status: KolRegisterStatus.FAIL,
          },
        );

        // Update all kol_registers with status = pending to fail
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.PENDING,
          },
          {
            kr_status: KolRegisterStatus.FAIL,
          },
        );
      }

      // If changing from false to true, update kol_registers
      if (user.ukol === false && newKol === true) {
        // Update all kol_registers with status = pending to success
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.PENDING,
          },
          {
            kr_status: KolRegisterStatus.SUCCESS,
          },
        );
      }
    }

    await this.userRepository.update({ uid }, { ukol: newKol });

    return {
      statusCode: 200,
      message: 'User kol flag updated successfully',
      data: {
        uid: user.uid,
        kol: newKol,
      },
    };
  }

  async getKolRegisters(status?: string): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      kr_id: number;
      kr_user_id: number;
      kr_name: string;
      kr_facebook_url: string | null;
      kr_x_url: string | null;
      kr_gruop_telegram_url: string | null;
      kr_youtube_url: string | null;
      kr_website_url: string | null;
      kr_status: KolRegisterStatus;
      user: {
        uid: number;
        uname: string;
        ufulllname: string;
        uemail: string;
        uphone: string | null;
        uavatar: string | null;
      };
    }>;
  }> {
    // Build query with status filter (default to pending if not provided)
    const queryBuilder = this.kolRegisterRepository
      .createQueryBuilder('kr')
      .leftJoinAndSelect('kr.user', 'user')
      .select([
        'kr.kr_id',
        'kr.kr_user_id',
        'kr.kr_name',
        'kr.kr_facebook_url',
        'kr.kr_x_url',
        'kr.kr_gruop_telegram_url',
        'kr.kr_youtube_url',
        'kr.kr_website_url',
        'kr.kr_status',
        'user.uid',
        'user.uname',
        'user.ufulllname',
        'user.uemail',
        'user.uphone',
        'user.uavatar',
      ])
      .orderBy('kr.kr_id', 'DESC');

    // Filter by status (default to pending if not provided)
    const filterStatus = status || KolRegisterStatus.PENDING;

    // Validate status
    const validStatuses = [
      KolRegisterStatus.PENDING,
      KolRegisterStatus.SUCCESS,
      KolRegisterStatus.FAIL,
    ];

    // Check if status matches enum (case-insensitive)
    const normalizedStatus = filterStatus.toLowerCase();
    let matchedStatus: KolRegisterStatus | null = null;

    for (const validStatus of validStatuses) {
      if (validStatus.toLowerCase() === normalizedStatus) {
        matchedStatus = validStatus;
        break;
      }
    }

    // If status is provided but doesn't match, default to pending
    const finalStatus = matchedStatus || KolRegisterStatus.PENDING;
    queryBuilder.where('kr.kr_status = :status', { status: finalStatus });

    const kolRegisters = await queryBuilder.getMany();

    // Format response
    const formattedData = kolRegisters.map((kr) => ({
      kr_id: kr.kr_id,
      kr_user_id: kr.kr_user_id,
      kr_name: kr.kr_name,
      kr_facebook_url: kr.kr_facebook_url,
      kr_x_url: kr.kr_x_url,
      kr_gruop_telegram_url: kr.kr_gruop_telegram_url,
      kr_youtube_url: kr.kr_youtube_url,
      kr_website_url: kr.kr_website_url,
      kr_status: kr.kr_status,
      user: {
        uid: kr.user.uid,
        uname: kr.user.uname,
        ufulllname: kr.user.ufulllname,
        uemail: kr.user.uemail,
        uphone: kr.user.uphone,
        uavatar: kr.user.uavatar,
      },
    }));

    return {
      statusCode: 200,
      message: 'KOL registers retrieved successfully',
      data: formattedData,
    };
  }

  async updateUserStatus(
    uid: number,
    status: UserStatus,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      uid: number;
      status: UserStatus;
    };
  }> {
    if (!uid || Number.isNaN(uid)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userRepository.findOne({
      select: ['uid', 'ustatus'],
      where: { uid },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const oldStatus = user.ustatus;
    await this.userRepository.update({ uid }, { ustatus: status });

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.USERS,
      log_description: `Admin updated user status: user_id=${uid}, old_status=${oldStatus}, new_status=${status}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: uid,
      log_target_type: 'user',
      log_old_data: { status: oldStatus },
      log_new_data: { status },
    });

    return {
      statusCode: 200,
      message: 'User status updated successfully',
      data: {
        uid: user.uid,
        status,
      },
    };
  }

  /**
   * Generate exchange wallet (ví sàn) with fixed path
   * Path: m/44'/60'/0'/0'/0'/382' (ETH/BNB) or m/44'/501'/0'/0'/0'/382' (SOL)
   */
  private getExchangeWallet(
    mnemonic: string,
    networkSymbol: string,
  ): HDNodeWallet | Keypair {
    if (networkSymbol === 'SOL') {
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const derivedSeed = derivePath(
        `m/44'/501'/0'/0'/0'/382'`,
        seed.toString('hex'),
      );
      return Keypair.fromSeed(derivedSeed.key);
    } else {
      // ETH/BNB và các mạng EVM khác
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const bip32Factory = bip32.BIP32Factory(tinysecp);
      const root = bip32Factory.fromSeed(seed);

      // Derive path: m/44'/60'/0'/0'/0'/382'
      const derivedNode = root.derivePath(`m/44'/60'/0'/0'/0'/382'`);

      // Chuyển đổi private key từ bip32 sang Wallet
      const privateKeyBuffer = derivedNode.privateKey;
      const privateKey = `0x${Buffer.from(privateKeyBuffer).toString('hex')}`;
      const wallet = new Wallet(privateKey);

      return wallet as any as HDNodeWallet;
    }
  }

  /**
   * Get public key from exchange wallet
   */
  private getExchangeWalletPublicKey(
    wallet: HDNodeWallet | Keypair,
    networkSymbol: string,
  ): string {
    if (networkSymbol === 'SOL') {
      const keypair = wallet as Keypair;
      return keypair.publicKey.toBase58();
    } else {
      const hdWallet = wallet as HDNodeWallet;
      return hdWallet.address;
    }
  }

  async getMainWallets(): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      public_key: string;
      network: {
        net_id: number;
        net_name: string;
        net_symbol: string;
        net_logo: string;
        net_scan: string;
        net_status: string;
      };
    }>;
  }> {
    // Get mnemonic from config
    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic) {
      throw new BadRequestException('Wallet seed not configured');
    }

    if (!bip39.validateMnemonic(mnemonic)) {
      throw new BadRequestException('Invalid wallet seed');
    }

    // Get all active networks
    const networks = await this.networkRepository.find({
      where: { net_status: NetStatus.ACTIVE },
      order: { net_id: 'ASC' },
    });

    // Generate exchange wallet for each network
    const mainWallets = networks.map((network) => {
      const exchangeWallet = this.getExchangeWallet(
        mnemonic,
        network.net_symbol,
      );
      const publicKey = this.getExchangeWalletPublicKey(
        exchangeWallet,
        network.net_symbol,
      );

      return {
        public_key: publicKey,
        network: {
          net_id: network.net_id,
          net_name: network.net_name,
          net_symbol: network.net_symbol,
          net_logo: network.net_logo,
          net_scan: network.net_scan,
          net_status: network.net_status,
        },
      };
    });

    return {
      statusCode: 200,
      message: 'Main wallets retrieved successfully',
      data: mainWallets,
    };
  }

  /**
   * Lấy danh sách ví trợ phí (fee subsidy wallets) – path 369
   * Trả về cấu trúc giống ví main, chỉ khác public_key là từ ví trợ phí
   */
  async getFeeSubsidyWallets(): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      public_key: string;
      network: {
        net_id: number;
        net_name: string;
        net_symbol: string;
        net_logo: string;
        net_scan: string;
        net_status: string;
      };
    }>;
  }> {
    // Get mnemonic from config
    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic) {
      throw new BadRequestException('Wallet seed not configured');
    }

    if (!bip39.validateMnemonic(mnemonic)) {
      throw new BadRequestException('Invalid wallet seed');
    }

    // Get all active networks
    const networks = await this.networkRepository.find({
      where: { net_status: NetStatus.ACTIVE },
      order: { net_id: 'ASC' },
    });

    // Generate fee subsidy wallet (path 369) cho mỗi network
    const feeWallets = networks.map((network) => {
      const feeWallet = this.getFeeSupportWallet(mnemonic, network.net_symbol);
      const publicKey = this.getExchangeWalletPublicKey(
        feeWallet,
        network.net_symbol,
      );

      return {
        public_key: publicKey,
        network: {
          net_id: network.net_id,
          net_name: network.net_name,
          net_symbol: network.net_symbol,
          net_logo: network.net_logo,
          net_scan: network.net_scan,
          net_status: network.net_status,
        },
      };
    });

    return {
      statusCode: 200,
      message: 'Fee subsidy wallets retrieved successfully',
      data: feeWallets,
    };
  }

  async getListCoins(): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      coin_id: number;
      coin_name: string;
      coin_symbol: string;
      coin_logo: string;
      coin_website: string | null;
      coin_status: string;
    }>;
  }> {
    const coins = await this.coinRepository.find({
      order: { coin_id: 'ASC' },
    });

    const mapped = coins.map((coin) => ({
      coin_id: coin.coin_id,
      coin_name: coin.coin_name,
      coin_symbol: coin.coin_symbol,
      coin_logo: coin.coin_logo,
      coin_website: coin.coin_website,
      coin_status: coin.coin_status,
    }));

    return {
      statusCode: 200,
      message: 'List of coins retrieved successfully',
      data: mapped,
    };
  }

  async addCoin(
    addCoinDto: AddCoinDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      coin_id: number;
      coin_name: string;
      coin_symbol: string;
      coin_logo: string;
      coin_website: string | null;
      coin_status: string;
    };
  }> {
    // Check if coin_name already exists
    const existingCoinByName = await this.coinRepository.findOne({
      where: { coin_name: addCoinDto.name },
    });

    if (existingCoinByName) {
      throw new BadRequestException(
        `Coin with name "${addCoinDto.name}" already exists`,
      );
    }

    // Check if coin_symbol already exists
    const existingCoinBySymbol = await this.coinRepository.findOne({
      where: { coin_symbol: addCoinDto.symbol.toUpperCase() },
    });

    if (existingCoinBySymbol) {
      throw new BadRequestException(
        `Coin with symbol "${addCoinDto.symbol.toUpperCase()}" already exists`,
      );
    }

    // Create new coin
    const newCoin = this.coinRepository.create({
      coin_name: addCoinDto.name,
      coin_symbol: addCoinDto.symbol.toUpperCase(),
      coin_logo: addCoinDto.logo,
      coin_website: addCoinDto.website || null,
      coin_status: CoinStatus.ACTIVE,
    });

    const savedCoin = await this.coinRepository.save(newCoin);

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.CREATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Admin created new coin: name=${addCoinDto.name}, symbol=${addCoinDto.symbol.toUpperCase()}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: savedCoin.coin_id,
      log_target_type: 'coin',
      log_old_data: null,
      log_new_data: {
        coin_name: savedCoin.coin_name,
        coin_symbol: savedCoin.coin_symbol,
        coin_logo: savedCoin.coin_logo,
        coin_website: savedCoin.coin_website,
        coin_status: savedCoin.coin_status,
      },
    });

    return {
      statusCode: 201,
      message: 'Coin created successfully',
      data: {
        coin_id: savedCoin.coin_id,
        coin_name: savedCoin.coin_name,
        coin_symbol: savedCoin.coin_symbol,
        coin_logo: savedCoin.coin_logo,
        coin_website: savedCoin.coin_website,
        coin_status: savedCoin.coin_status,
      },
    };
  }

  async updateCoin(
    coinId: number,
    updateCoinDto: UpdateCoinDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      coin_id: number;
      coin_name: string;
      coin_symbol: string;
      coin_logo: string;
      coin_website: string | null;
      coin_status: string;
    };
  }> {
    if (!coinId || Number.isNaN(coinId)) {
      throw new BadRequestException('Invalid coin id');
    }

    // Check if coin exists
    const coin = await this.coinRepository.findOne({
      where: { coin_id: coinId },
    });

    if (!coin) {
      throw new NotFoundException('Coin not found');
    }

    // Store old data for logging
    const oldData = {
      coin_name: coin.coin_name,
      coin_logo: coin.coin_logo,
      coin_website: coin.coin_website,
    };

    // Check unique for name if provided
    if (updateCoinDto.name && updateCoinDto.name !== coin.coin_name) {
      const existingCoinByName = await this.coinRepository.findOne({
        where: { coin_name: updateCoinDto.name },
      });

      if (existingCoinByName && existingCoinByName.coin_id !== coinId) {
        throw new BadRequestException(
          `Coin with name "${updateCoinDto.name}" already exists`,
        );
      }
    }

    // Update fields if provided
    if (updateCoinDto.name !== undefined) {
      coin.coin_name = updateCoinDto.name;
    }
    if (updateCoinDto.logo !== undefined) {
      coin.coin_logo = updateCoinDto.logo;
    }
    if (updateCoinDto.website !== undefined) {
      coin.coin_website = updateCoinDto.website || null;
    }

    const updatedCoin = await this.coinRepository.save(coin);

    // Prepare new data for logging
    const newData = {
      coin_name: updatedCoin.coin_name,
      coin_logo: updatedCoin.coin_logo,
      coin_website: updatedCoin.coin_website,
    };

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Admin updated coin: coin_id=${coinId}, changes=${JSON.stringify(updateCoinDto)}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: coinId,
      log_target_type: 'coin',
      log_old_data: oldData,
      log_new_data: newData,
    });

    return {
      statusCode: 200,
      message: 'Coin updated successfully',
      data: {
        coin_id: updatedCoin.coin_id,
        coin_name: updatedCoin.coin_name,
        coin_symbol: updatedCoin.coin_symbol,
        coin_logo: updatedCoin.coin_logo,
        coin_website: updatedCoin.coin_website,
        coin_status: updatedCoin.coin_status,
      },
    };
  }

  async getListNetworks(): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      net_id: number;
      net_name: string;
      net_symbol: string;
      net_logo: string;
      net_scan: string;
      net_status: string;
    }>;
  }> {
    const networks = await this.networkRepository.find({
      order: { net_id: 'ASC' },
    });

    const mapped = networks.map((network) => ({
      net_id: network.net_id,
      net_name: network.net_name,
      net_symbol: network.net_symbol,
      net_logo: network.net_logo,
      net_scan: network.net_scan,
      net_status: network.net_status,
    }));

    return {
      statusCode: 200,
      message: 'List of networks retrieved successfully',
      data: mapped,
    };
  }

  async addNetwork(
    addNetworkDto: AddNetworkDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      net_id: number;
      net_name: string;
      net_symbol: string;
      net_logo: string;
      net_scan: string;
      net_status: string;
    };
  }> {
    // Check if net_name already exists
    const existingNetworkByName = await this.networkRepository.findOne({
      where: { net_name: addNetworkDto.name },
    });

    if (existingNetworkByName) {
      throw new BadRequestException(
        `Network with name "${addNetworkDto.name}" already exists`,
      );
    }

    // Check if net_symbol already exists
    const existingNetworkBySymbol = await this.networkRepository.findOne({
      where: { net_symbol: addNetworkDto.symbol.toUpperCase() },
    });

    if (existingNetworkBySymbol) {
      throw new BadRequestException(
        `Network with symbol "${addNetworkDto.symbol.toUpperCase()}" already exists`,
      );
    }

    // Check if net_scan already exists
    const existingNetworkByScan = await this.networkRepository.findOne({
      where: { net_scan: addNetworkDto.scan },
    });

    if (existingNetworkByScan) {
      throw new BadRequestException(
        `Network with scan "${addNetworkDto.scan}" already exists`,
      );
    }

    // Create new network
    const newNetwork = this.networkRepository.create({
      net_name: addNetworkDto.name,
      net_symbol: addNetworkDto.symbol.toUpperCase(),
      net_logo: addNetworkDto.logo,
      net_scan: addNetworkDto.scan,
      net_status: NetStatus.ACTIVE,
    });

    const savedNetwork = await this.networkRepository.save(newNetwork);

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.CREATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Admin created new network: name=${addNetworkDto.name}, symbol=${addNetworkDto.symbol.toUpperCase()}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: savedNetwork.net_id,
      log_target_type: 'network',
      log_old_data: null,
      log_new_data: {
        net_name: savedNetwork.net_name,
        net_symbol: savedNetwork.net_symbol,
        net_logo: savedNetwork.net_logo,
        net_scan: savedNetwork.net_scan,
        net_status: savedNetwork.net_status,
      },
    });

    return {
      statusCode: 201,
      message: 'Network created successfully',
      data: {
        net_id: savedNetwork.net_id,
        net_name: savedNetwork.net_name,
        net_symbol: savedNetwork.net_symbol,
        net_logo: savedNetwork.net_logo,
        net_scan: savedNetwork.net_scan,
        net_status: savedNetwork.net_status,
      },
    };
  }

  async updateNetwork(
    networkId: number,
    updateNetworkDto: UpdateNetworkDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      net_id: number;
      net_name: string;
      net_symbol: string;
      net_logo: string;
      net_scan: string;
      net_status: string;
    };
  }> {
    if (!networkId || Number.isNaN(networkId)) {
      throw new BadRequestException('Invalid network id');
    }

    // Check if network exists
    const network = await this.networkRepository.findOne({
      where: { net_id: networkId },
    });

    if (!network) {
      throw new NotFoundException('Network not found');
    }

    // Store old data for logging
    const oldData = {
      net_name: network.net_name,
      net_logo: network.net_logo,
      net_scan: network.net_scan,
    };

    // Check unique for name if provided
    if (updateNetworkDto.name && updateNetworkDto.name !== network.net_name) {
      const existingNetworkByName = await this.networkRepository.findOne({
        where: { net_name: updateNetworkDto.name },
      });

      if (existingNetworkByName && existingNetworkByName.net_id !== networkId) {
        throw new BadRequestException(
          `Network with name "${updateNetworkDto.name}" already exists`,
        );
      }
    }

    // Check unique for scan if provided
    if (updateNetworkDto.scan && updateNetworkDto.scan !== network.net_scan) {
      const existingNetworkByScan = await this.networkRepository.findOne({
        where: { net_scan: updateNetworkDto.scan },
      });

      if (existingNetworkByScan && existingNetworkByScan.net_id !== networkId) {
        throw new BadRequestException(
          `Network with scan "${updateNetworkDto.scan}" already exists`,
        );
      }
    }

    // Update fields if provided
    if (updateNetworkDto.name !== undefined) {
      network.net_name = updateNetworkDto.name;
    }
    if (updateNetworkDto.logo !== undefined) {
      network.net_logo = updateNetworkDto.logo;
    }
    if (updateNetworkDto.scan !== undefined) {
      network.net_scan = updateNetworkDto.scan;
    }

    const updatedNetwork = await this.networkRepository.save(network);

    // Prepare new data for logging
    const newData = {
      net_name: updatedNetwork.net_name,
      net_logo: updatedNetwork.net_logo,
      net_scan: updatedNetwork.net_scan,
    };

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Admin updated network: network_id=${networkId}, changes=${JSON.stringify(updateNetworkDto)}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: networkId,
      log_target_type: 'network',
      log_old_data: oldData,
      log_new_data: newData,
    });

    return {
      statusCode: 200,
      message: 'Network updated successfully',
      data: {
        net_id: updatedNetwork.net_id,
        net_name: updatedNetwork.net_name,
        net_symbol: updatedNetwork.net_symbol,
        net_logo: updatedNetwork.net_logo,
        net_scan: updatedNetwork.net_scan,
        net_status: updatedNetwork.net_status,
      },
    };
  }

  async getUserWallets(uid: number): Promise<{
    statusCode: number;
    message: string;
    data: {
      user: {
        uid: number;
        uname: string;
        email: string;
      };
      balances: Array<{
        coin_id: number | null;
        coin_name: string | null;
        coin_symbol: string | null;
        balance: number;
        balance_gift: number;
        balance_reward: number;
      }>;
      wallet_networks: Array<{
        uwn_id: number;
        network_id: number;
        network_name: string;
        network_symbol: string;
        public_key: string;
        created_at: Date;
      }>;
    };
  }> {
    if (!uid || Number.isNaN(uid)) {
      throw new BadRequestException('Invalid user id');
    }

    // Check if user exists
    const user = await this.userRepository.findOne({
      select: ['uid', 'uname', 'uemail'],
      where: { uid },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get all user wallets (balances)
    const userWallets = await this.userWalletRepository.find({
      where: { uw_user_id: uid },
      relations: [],
    });

    // Get coin information for each wallet
    const balances = await Promise.all(
      userWallets.map(async (wallet) => {
        let coinName: string | null = null;
        let coinSymbol: string | null = null;

        if (wallet.uw_wallet_coins) {
          const coin = await this.coinRepository.findOne({
            where: { coin_id: wallet.uw_wallet_coins },
            select: ['coin_name', 'coin_symbol'],
          });
          if (coin) {
            coinName = coin.coin_name;
            coinSymbol = coin.coin_symbol;
          }
        }

        return {
          coin_id: wallet.uw_wallet_coins,
          coin_name: coinName,
          coin_symbol: coinSymbol,
          balance: parseFloat(wallet.uw_balance?.toString() || '0'),
          balance_gift: parseFloat(wallet.uw_balance_gift?.toString() || '0'),
          balance_reward: parseFloat(
            wallet.uw_balance_reward?.toString() || '0',
          ),
        };
      }),
    );

    // Get all user wallet networks
    const walletNetworks = await this.useWalletNetworkRepository.find({
      where: { uwn_user_id: uid },
      relations: [],
    });

    // Get network information for each wallet network
    const walletNetworksWithInfo = await Promise.all(
      walletNetworks.map(async (wn) => {
        const network = await this.networkRepository.findOne({
          where: { net_id: wn.uwn_network_id },
          select: ['net_name', 'net_symbol'],
        });

        return {
          uwn_id: wn.uwn_id,
          network_id: wn.uwn_network_id,
          network_name: network?.net_name || null,
          network_symbol: network?.net_symbol || null,
          public_key: wn.uwn_public_key,
          created_at: wn.created_at,
        };
      }),
    );

    return {
      statusCode: 200,
      message: 'User wallets retrieved successfully',
      data: {
        user: {
          uid: user.uid,
          uname: user.uname,
          email: user.uemail,
        },
        balances,
        wallet_networks: walletNetworksWithInfo,
      },
    };
  }

  async getUserWalletHistories(
    userId: number,
    option?: string,
  ): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      wh_id: number;
      wh_wallet_netword_id: number | null;
      wh_type: string;
      wh_option: string;
      wh_coins: number | null;
      wh_amount: number;
      wh_hash: string | null;
      wh_status: string;
      wh_node: string | null;
      wh_user: number | null;
      created_at: Date;
      updated_at: Date;
      coin_name: string | null;
      coin_symbol: string | null;
      network_name: string | null;
      network_symbol: string | null;
    }>;
  }> {
    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    // Check if user exists
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      select: ['uid'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Determine which options to filter
    let options: WalletHistoryOption[] = [];
    if (option === 'deposit') {
      options = [
        WalletHistoryOption.DEPOSIT,
        WalletHistoryOption.ADMIN_DEPOSIT,
      ];
    } else if (option === 'withdraw') {
      options = [WalletHistoryOption.WITHDRAW];
    } else {
      // Default: get both deposit and withdraw
      options = [
        WalletHistoryOption.DEPOSIT,
        WalletHistoryOption.ADMIN_DEPOSIT,
        WalletHistoryOption.WITHDRAW,
      ];
    }

    // Get wallet histories for this user
    const histories = await this.walletHistoryRepository.find({
      where: {
        wh_user: userId,
        wh_option: In(options),
      },
      order: { created_at: 'DESC' },
    });

    // Enrich with coin and network information
    const enrichedHistories = await Promise.all(
      histories.map(async (history) => {
        let coinName: string | null = null;
        let coinSymbol: string | null = null;

        if (history.wh_coins) {
          const coin = await this.coinRepository.findOne({
            where: { coin_id: history.wh_coins },
            select: ['coin_name', 'coin_symbol'],
          });
          if (coin) {
            coinName = coin.coin_name;
            coinSymbol = coin.coin_symbol;
          }
        }

        let networkName: string | null = null;
        let networkSymbol: string | null = null;

        if (history.wh_wallet_netword_id) {
          const walletNetwork = await this.useWalletNetworkRepository.findOne({
            where: { uwn_id: history.wh_wallet_netword_id },
            select: ['uwn_network_id'],
          });

          if (walletNetwork) {
            const network = await this.networkRepository.findOne({
              where: { net_id: walletNetwork.uwn_network_id },
              select: ['net_name', 'net_symbol'],
            });
            if (network) {
              networkName = network.net_name;
              networkSymbol = network.net_symbol;
            }
          }
        }

        return {
          wh_id: history.wh_id,
          wh_wallet_netword_id: history.wh_wallet_netword_id,
          wh_type: history.wh_type,
          wh_option: history.wh_option,
          wh_coins: history.wh_coins,
          wh_amount: parseFloat(history.wh_amount?.toString() || '0'),
          wh_hash: history.wh_hash,
          wh_status: history.wh_status,
          wh_node: history.wh_node,
          wh_user: history.wh_user,
          created_at: history.created_at,
          updated_at: history.updated_at,
          coin_name: coinName,
          coin_symbol: coinSymbol,
          network_name: networkName,
          network_symbol: networkSymbol,
        };
      }),
    );

    return {
      statusCode: 200,
      message: 'User wallet histories retrieved successfully',
      data: enrichedHistories,
    };
  }

  async getKycList(status?: string): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      uv_id: number;
      uv_user_id: number;
      uv_id_card_number: string;
      uv_front_image: string;
      uv_backside_image: string | null;
      uv_paper_image: string | null;
      uv_challenge_code: string | null;
      uv_challenge_expires_at: Date | null;
      uv_status: UserVerifyStatus;
      user: {
        uid: number;
        uname: string;
        ufulllname: string;
        uemail: string;
        uphone: string | null;
        uavatar: string | null;
      };
    }>;
  }> {
    // Build query with optional status filter
    const queryBuilder = this.userVerifyRepository
      .createQueryBuilder('uv')
      .leftJoinAndSelect('uv.user', 'user')
      .select([
        'uv.uv_id',
        'uv.uv_user_id',
        'uv.uv_id_card_number',
        'uv.uv_front_image',
        'uv.uv_backside_image',
        'uv.uv_paper_image',
        'uv.uv_challenge_code',
        'uv.uv_challenge_expires_at',
        'uv.uv_status',
        'user.uid',
        'user.uname',
        'user.ufulllname',
        'user.uemail',
        'user.uphone',
        'user.uavatar',
      ])
      .orderBy('uv.uv_id', 'DESC');

    // Filter by status if provided
    if (status) {
      const validStatuses = [
        UserVerifyStatus.PENDING,
        UserVerifyStatus.CHALLENGE_PENDING,
        UserVerifyStatus.VERIFY,
        UserVerifyStatus.CANCEL,
        UserVerifyStatus.RETRY,
      ];

      const normalizedStatus = status.toLowerCase();
      let matchedStatus: UserVerifyStatus | null = null;

      for (const validStatus of validStatuses) {
        if (validStatus.toLowerCase() === normalizedStatus) {
          matchedStatus = validStatus;
          break;
        }
      }

      if (matchedStatus) {
        queryBuilder.where('uv.uv_status = :status', { status: matchedStatus });
        if (matchedStatus === UserVerifyStatus.PENDING) {
          queryBuilder.andWhere('uv.uv_paper_image IS NOT NULL');
        }
      }
    }

    const kycList = await queryBuilder.getMany();

    const formattedData = kycList.map((kyc) => ({
      uv_id: kyc.uv_id,
      uv_user_id: kyc.uv_user_id,
      uv_id_card_number: kyc.uv_id_card_number,
      uv_front_image: kyc.uv_front_image,
      uv_backside_image: kyc.uv_backside_image,
      uv_paper_image: kyc.uv_paper_image,
      uv_challenge_code: kyc.uv_challenge_code,
      uv_challenge_expires_at: kyc.uv_challenge_expires_at,
      uv_status: kyc.uv_status,
      user: {
        uid: kyc.user.uid,
        uname: kyc.user.uname,
        ufulllname: kyc.user.ufulllname,
        uemail: kyc.user.uemail,
        uphone: kyc.user.uphone,
        uavatar: kyc.user.uavatar,
      },
    }));

    return {
      statusCode: 200,
      message: 'KYC list retrieved successfully',
      data: formattedData,
    };
  }

  async getUserKycHistory(userId: number): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      uv_id: number;
      uv_user_id: number;
      uv_id_card_number: string;
      uv_front_image: string;
      uv_backside_image: string | null;
      uv_paper_image: string | null;
      uv_challenge_code: string | null;
      uv_challenge_expires_at: Date | null;
      uv_status: UserVerifyStatus;
      created_at?: Date;
    }>;
  }> {
    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    // Check if user exists
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const kycHistory = await this.userVerifyRepository
      .createQueryBuilder('uv')
      .where('uv.uv_user_id = :userId', { userId })
      .select([
        'uv.uv_id',
        'uv.uv_user_id',
        'uv.uv_id_card_number',
        'uv.uv_front_image',
        'uv.uv_backside_image',
        'uv.uv_paper_image',
        'uv.uv_challenge_code',
        'uv.uv_challenge_expires_at',
        'uv.uv_status',
      ])
      .orderBy(
        `CASE 
          WHEN uv.uv_status = '${UserVerifyStatus.PENDING}' THEN 1
          WHEN uv.uv_status = '${UserVerifyStatus.CHALLENGE_PENDING}' THEN 2
          WHEN uv.uv_status = '${UserVerifyStatus.RETRY}' THEN 3
          ELSE 4
        END`,
        'ASC',
      )
      .addOrderBy('uv.uv_id', 'DESC')
      .getMany();

    const formattedData = kycHistory.map((kyc) => ({
      uv_id: kyc.uv_id,
      uv_user_id: kyc.uv_user_id,
      uv_id_card_number: kyc.uv_id_card_number,
      uv_front_image: kyc.uv_front_image,
      uv_backside_image: kyc.uv_backside_image,
      uv_paper_image: kyc.uv_paper_image,
      uv_challenge_code: kyc.uv_challenge_code,
      uv_challenge_expires_at: kyc.uv_challenge_expires_at,
      uv_status: kyc.uv_status,
    }));

    return {
      statusCode: 200,
      message: 'KYC history retrieved successfully',
      data: formattedData,
    };
  }

  async checkUserKycStatus(userId: number): Promise<{
    statusCode: number;
    message: string;
    status:
      | 'verify'
      | 'retry'
      | 'pending'
      | 'not-verified'
      | 'awaiting_paper'
      | 'challenge_expired';
    notes?: Array<{ id: number; message: string | null }>;
    challenge_code?: string;
    challenge_expires_at?: string;
  }> {
    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    // First, check uverify field of the user
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // If uverify = true, return verify immediately
    if (user.uverify === true) {
      return {
        statusCode: 200,
        message: 'KYC status retrieved successfully',
        status: 'verify',
      };
    }

    // If uverify = false, continue with existing logic
    // Get all KYC verifications for this user
    const verifications = await this.userVerifyRepository.find({
      where: {
        uv_user_id: userId,
      },
    });

    // Check in priority order:
    // 1. If at least one record has uv_status = "verify" → status = "verify"
    const hasVerify = verifications.some(
      (v) => v.uv_status === UserVerifyStatus.VERIFY,
    );

    if (hasVerify) {
      // Update uverify to true if at least one verification is verified
      user.uverify = true;
      await this.userRepository.save(user);
      return {
        statusCode: 200,
        message: 'KYC status retrieved successfully',
        status: 'verify',
      };
    }

    // 2. If no verify, check if at least one record has uv_status = "retry" → status = "retry"
    const hasRetry = verifications.some(
      (v) => v.uv_status === UserVerifyStatus.RETRY,
    );

    if (hasRetry) {
      // Get all retry verifications' uv_id
      const retryVerifications = verifications.filter(
        (v) => v.uv_status === UserVerifyStatus.RETRY,
      );
      const retryVerifyIds = retryVerifications.map((v) => v.uv_id);

      // Get all verify_logs for these uv_ids
      const verifyLogs = await this.verifyLogRepository.find({
        where: {
          vl_verify_id: In(retryVerifyIds),
        },
      });

      // Format notes with id (vl_id) and message (vl_note)
      const notes = verifyLogs.map((log) => ({
        id: log.vl_id,
        message: log.vl_note,
      }));

      return {
        statusCode: 200,
        message: 'KYC status retrieved successfully',
        status: 'retry',
        notes: notes,
      };
    }

    const challengeRecords = verifications.filter(
      (v) => v.uv_status === UserVerifyStatus.CHALLENGE_PENDING,
    );
    if (challengeRecords.length > 0) {
      const challenge = challengeRecords.sort((a, b) => b.uv_id - a.uv_id)[0];
      const now = new Date();
      if (
        challenge.uv_challenge_expires_at &&
        now > challenge.uv_challenge_expires_at
      ) {
        return {
          statusCode: 200,
          message: 'KYC status retrieved successfully',
          status: 'challenge_expired',
        };
      }
      return {
        statusCode: 200,
        message: 'KYC status retrieved successfully',
        status: 'awaiting_paper',
        challenge_code: challenge.uv_challenge_code ?? undefined,
        challenge_expires_at: challenge.uv_challenge_expires_at
          ? challenge.uv_challenge_expires_at.toISOString()
          : undefined,
      };
    }

    const hasPending = verifications.some(
      (v) => v.uv_status === UserVerifyStatus.PENDING,
    );

    if (hasPending) {
      return {
        statusCode: 200,
        message: 'KYC status retrieved successfully',
        status: 'pending',
      };
    }

    return {
      statusCode: 200,
      message: 'KYC status retrieved successfully',
      status: 'not-verified',
    };
  }

  async updateKycStatus(
    userId: number,
    updateKycStatusDto: UpdateKycStatusDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
  }> {
    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    // Check if user exists
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check current KYC status (similar to checkUserKycStatus but without returning)
    let statusCheck: 'verify' | 'retry' | 'pending' | 'not-verified';

    // If uverify = true, status is verify
    if (user.uverify === true) {
      statusCheck = 'verify';
    } else {
      const verifications = await this.userVerifyRepository.find({
        where: {
          uv_user_id: userId,
        },
      });

      const hasChallengePending = verifications.some(
        (v) => v.uv_status === UserVerifyStatus.CHALLENGE_PENDING,
      );
      if (hasChallengePending) {
        throw new BadRequestException(
          'Cannot update KYC: user has not submitted the paper-holding photo yet (status: challenge_pending).',
        );
      }

      const hasVerify = verifications.some(
        (v) => v.uv_status === UserVerifyStatus.VERIFY,
      );
      const hasRetry = verifications.some(
        (v) => v.uv_status === UserVerifyStatus.RETRY,
      );
      const hasPending = verifications.some(
        (v) => v.uv_status === UserVerifyStatus.PENDING,
      );

      if (hasVerify) {
        statusCheck = 'verify';
      } else if (hasRetry) {
        statusCheck = 'retry';
      } else if (hasPending) {
        statusCheck = 'pending';
      } else {
        statusCheck = 'not-verified';
      }
    }

    if (statusCheck === 'verify' || statusCheck === 'not-verified') {
      throw new BadRequestException(
        'Cannot update KYC status. User KYC status is already verified or not-verified.',
      );
    }

    if (statusCheck === 'retry' || statusCheck === 'pending') {
      if (
        updateKycStatusDto.status !== 'verify' &&
        updateKycStatusDto.status !== 'retry'
      ) {
        throw new BadRequestException(
          'Status must be either "verify" or "retry" when current status is retry or pending',
        );
      }

      const verificationsToUpdate = await this.userVerifyRepository
        .createQueryBuilder('uv')
        .where('uv.uv_user_id = :userId', { userId })
        .andWhere(
          '(uv.uv_status = :retry OR (uv.uv_status = :pending AND uv.uv_paper_image IS NOT NULL))',
          {
            retry: UserVerifyStatus.RETRY,
            pending: UserVerifyStatus.PENDING,
          },
        )
        .getMany();

      if (verificationsToUpdate.length === 0) {
        throw new BadRequestException(
          'No verification records ready for review (pending with paper proof, or retry).',
        );
      }

      if (updateKycStatusDto.status === 'retry') {
        // If status = retry, message is required
        if (
          !updateKycStatusDto.message ||
          updateKycStatusDto.message.trim() === ''
        ) {
          throw new BadRequestException(
            'Message is required when status is retry',
          );
        }

        // Update all verification records to retry
        for (const verification of verificationsToUpdate) {
          verification.uv_status = UserVerifyStatus.RETRY;
          await this.userVerifyRepository.save(verification);

          // Create verify_log with message
          await this.verifyLogRepository.save({
            vl_verify_id: verification.uv_id,
            vl_admin_id: adminId,
            vl_note: updateKycStatusDto.message.trim(),
          });
        }

        return {
          statusCode: 200,
          message: 'KYC status updated to retry successfully',
        };
      } else if (updateKycStatusDto.status === 'verify') {
        // If status = verify, no message needed
        // Update all verification records to verify
        for (const verification of verificationsToUpdate) {
          verification.uv_status = UserVerifyStatus.VERIFY;
          await this.userVerifyRepository.save(verification);
        }

        // Update uverify to true
        user.uverify = true;
        await this.userRepository.save(user);

        return {
          statusCode: 200,
          message: 'KYC status updated to verify successfully',
        };
      }
    }

    // Should not reach here
    throw new BadRequestException('Invalid status update');
  }

  async searchWallet(query: string): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      wallet_network: {
        uwn_id: number;
        public_key: string;
        created_at: Date;
      };
      user: {
        uid: number;
        uname: string;
        email: string;
        logo: string | null;
      };
      network: {
        net_id: number;
        net_name: string;
        net_symbol: string;
        net_logo: string;
        net_scan: string;
      } | null;
    }>;
  }> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Search query is required');
    }

    // Search for wallet networks with public key matching query (LIKE)
    const walletNetworks = await this.useWalletNetworkRepository
      .createQueryBuilder('uwn')
      .where('uwn.uwn_public_key ILIKE :query', { query: `%${query}%` })
      .getMany();

    if (walletNetworks.length === 0) {
      return {
        statusCode: 200,
        message: 'No wallets found',
        data: [],
      };
    }

    // Get user and network information for each wallet network
    const results = await Promise.all(
      walletNetworks.map(async (wn) => {
        // Get user information
        const user = await this.userRepository.findOne({
          select: ['uid', 'uname', 'uemail', 'uavatar'],
          where: { uid: wn.uwn_user_id },
        });

        // Get network information
        const network = await this.networkRepository.findOne({
          where: { net_id: wn.uwn_network_id },
          select: ['net_id', 'net_name', 'net_symbol', 'net_logo', 'net_scan'],
        });

        return {
          wallet_network: {
            uwn_id: wn.uwn_id,
            public_key: wn.uwn_public_key,
            created_at: wn.created_at,
          },
          user: user
            ? {
                uid: user.uid,
                uname: user.uname,
                email: user.uemail,
                logo: user.uavatar,
              }
            : null,
          network: network
            ? {
                net_id: network.net_id,
                net_name: network.net_name,
                net_symbol: network.net_symbol,
                net_logo: network.net_logo,
                net_scan: network.net_scan,
              }
            : null,
        };
      }),
    );

    // Filter out results where user is null (shouldn't happen, but just in case)
    const validResults = results.filter(
      (
        r,
      ): r is {
        wallet_network: {
          uwn_id: number;
          public_key: string;
          created_at: Date;
        };
        user: {
          uid: number;
          uname: string;
          email: string;
          logo: string | null;
        };
        network: {
          net_id: number;
          net_name: string;
          net_symbol: string;
          net_logo: string;
          net_scan: string;
        } | null;
      } => r.user !== null,
    );

    return {
      statusCode: 200,
      message: 'Wallets found successfully',
      data: validResults,
    };
  }

  /**
   * Calculate path components from user ID
   */
  private calculatePathComponents(userId: number): {
    a: number;
    b: number;
    c: number;
  } {
    const a = Math.floor(userId / 100000) % 100;
    const b = Math.floor(userId / 1000) % 100;
    const c = userId % 1000;
    return { a, b, c };
  }

  /**
   * Lấy địa chỉ (string) từ ví derive – dùng để check balance và rút đúng ví sẽ ký giao dịch.
   */
  private getDerivedWalletAddressString(
    wallet: HDNodeWallet | Keypair,
    networkSymbol: string,
  ): string {
    if (networkSymbol === 'SOL') {
      return (wallet as Keypair).publicKey.toBase58();
    }
    return (wallet as HDNodeWallet).address;
  }

  /**
   * Generate user wallet from mnemonic and path components
   */
  private generateUserWallet(
    mnemonic: string,
    userId: number,
    endPath: number | null,
    networkSymbol: string,
  ): HDNodeWallet | Keypair {
    const { a, b, c } = this.calculatePathComponents(userId);
    const d = endPath || 0;

    if (networkSymbol === 'SOL') {
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const path = `m/44'/501'/0'/${a}'/${b}'/${c}'/${d}'`;
      const derivedSeed = derivePath(path, seed.toString('hex'));
      return Keypair.fromSeed(derivedSeed.key);
    } else {
      // EVM
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const bip32Factory = bip32.BIP32Factory(tinysecp);
      const root = bip32Factory.fromSeed(seed);
      const path = `m/44'/60'/0'/${a}'/${b}'/${c}'/${d}'`;
      const derivedNode = root.derivePath(path);

      if (!derivedNode.privateKey) {
        throw new BadRequestException('Failed to derive private key');
      }

      const privateKeyBuffer = derivedNode.privateKey;
      const privateKey = `0x${Buffer.from(privateKeyBuffer).toString('hex')}`;
      const wallet = new Wallet(privateKey);
      return wallet as any as HDNodeWallet;
    }
  }

  /**
   * Lấy ví trợ phí (fee support wallet) từ HD Wallet
   * Path cố định:
   * - ETH / BNB (EVM): m/44'/60'/0'/0'/0'/369'
   * - SOL:            m/44'/501'/0'/0'/0'/369'
   */
  private getFeeSupportWallet(
    mnemonic: string,
    networkSymbol: string,
  ): HDNodeWallet | Keypair {
    if (networkSymbol === 'SOL') {
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const derivedSeed = derivePath(
        `m/44'/501'/0'/0'/0'/369'`,
        seed.toString('hex'),
      );
      return Keypair.fromSeed(derivedSeed.key);
    } else {
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const bip32Factory = bip32.BIP32Factory(tinysecp);
      const root = bip32Factory.fromSeed(seed);
      const derivedNode = root.derivePath(`m/44'/60'/0'/0'/0'/369'`);

      if (!derivedNode.privateKey) {
        throw new BadRequestException('Failed to derive fee support wallet');
      }

      const privateKeyBuffer = derivedNode.privateKey;
      const privateKey = `0x${Buffer.from(privateKeyBuffer).toString('hex')}`;
      const wallet = new Wallet(privateKey);
      return wallet as any as HDNodeWallet;
    }
  }

  /**
   * Chỉ kiểm tra và tạo ATA USDT trên SOL cho ví CEO (hoặc main path 382).
   * Ví trợ phí (path 369) không cần ATA và không bao giờ được dùng làm đích; nếu target trùng ví trợ phí thì dùng main 382.
   */
  private async ensureTargetHasSolUsdtAta(
    network: Network,
    usdtCoin: Coin,
    coinNetwork: CoinNetwork,
    targetWalletAddress: string,
    mainWalletAddress: string,
    mnemonic: string,
  ): Promise<void> {
    if (network.net_symbol !== 'SOL') return;

    const solUrls = await this.adminSettingsConfigService.getRpcSolUrlsToTry();
    if (solUrls.length === 0) return;

    const wssUrl = this.configService.get<string>('SOLANA_WSS_URL');
    await this.runWithSolRpcUrl(async (rpcUrl) => {
      const connection = new Connection(rpcUrl, {
        commitment: 'confirmed',
        wsEndpoint: wssUrl || undefined,
      });

      // Đảm bảo đích là ví CEO/main, không bao giờ là ví trợ phí (path 369)
      const feeSupportWallet = this.getFeeSupportWallet(
        mnemonic,
        'SOL',
      ) as Keypair;
      const feeSupportAddress = feeSupportWallet.publicKey.toBase58();
      let effectiveTarget = targetWalletAddress;
      if (effectiveTarget === feeSupportAddress) {
        effectiveTarget = mainWalletAddress;
      }

      const mintAddress = SOL_USDT_MINT; // SOL: chỉ tạo ATA USDT, dùng mint chuẩn
      const mintPublicKey = new PublicKey(mintAddress);
      const targetPublicKey = new PublicKey(effectiveTarget);
      const toTokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        targetPublicKey,
      );

      try {
        await this.rpcRateLimitService.withRpcLimit(() =>
          getAccount(connection, toTokenAccount),
        );
        return; // ATA đã tồn tại
      } catch {
        // ATA chưa có, tạo bằng ví trợ phí (path 369)
      }

      if (this.feeSupportDepletedNetworks.has('SOL')) {
        return;
      }

      const supportBalance = await this.rpcRateLimitService.withRpcLimit(() =>
        connection.getBalance(feeSupportWallet.publicKey),
      );
      const rentExempt = 2039280; // ~min rent for ATA
      if (supportBalance < rentExempt) {
        return;
      }

      try {
        // Payer = ví trợ phí (369); owner của ATA = ví CEO/main (effectiveTarget)
        const transaction = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            feeSupportWallet.publicKey,
            toTokenAccount,
            targetPublicKey,
            mintPublicKey,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
        const { blockhash } = await this.rpcRateLimitService.withRpcLimit(() =>
          connection.getLatestBlockhash('confirmed'),
        );
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = feeSupportWallet.publicKey;

        const signature = await this.rpcRateLimitService.withRpcLimit(() =>
          connection.sendTransaction(transaction, [feeSupportWallet]),
        );
        await this.rpcRateLimitService.withRpcLimit(() =>
          connection.confirmTransaction(signature, 'confirmed'),
        );
      } catch (err: any) {
        if (
          err?.message?.includes('insufficient') ||
          err?.message?.includes('balance')
        ) {
          this.feeSupportDepletedNetworks.add('SOL');
        }
      }
    });
  }

  /**
   * Gửi native fee từ ví trợ phí tới ví user để đủ gas rút USDT
   */
  private async sendGasFromSupportWallet(
    network: Network,
    nativeCoin: Coin | null,
    nativeCoinNetwork: CoinNetwork | null,
    mnemonic: string,
    toAddress: string,
    amount: number,
  ): Promise<string | null> {
    if (amount <= 0) {
      return null;
    }

    // Nếu đã biết ví trợ phí trên network này hết tiền thì bỏ qua luôn
    if (this.feeSupportDepletedNetworks.has(network.net_symbol)) {
      return null;
    }

    const feeWallet = this.getFeeSupportWallet(mnemonic, network.net_symbol);

    try {
      // SOL: không cần nativeCoin từ DB, xử lý trực tiếp; thử DB rồi env khi lỗi/rate limit
      if (network.net_symbol === 'SOL') {
        const wssUrl = this.configService.get<string>('SOLANA_WSS_URL');
        return this.runWithSolRpcUrl(async (rpcUrl) => {
          const connection = new Connection(rpcUrl, {
            commitment: 'confirmed',
            wsEndpoint: wssUrl || undefined,
          });

          const keypair = feeWallet as Keypair;
          const feeSupportAddress = keypair.publicKey.toBase58();
          const toPubkey = new PublicKey(toAddress);

          const lamports = Math.floor(amount * 1e9);

          const supportBalance = await this.rpcRateLimitService.withRpcLimit(
            () => connection.getBalance(keypair.publicKey),
          );
          if (supportBalance < lamports) {
            console.warn(
              `[SOL] Fee support (${feeSupportAddress}) insufficient: has ${supportBalance / 1e9} SOL, need ${lamports / 1e9}. Nạp SOL vào địa chỉ trên. Marking depleted.`,
            );
            this.feeSupportDepletedNetworks.add(network.net_symbol);
            return null;
          }

          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey,
              lamports,
            }),
          );

          const signature = await this.rpcRateLimitService.withRpcLimit(() =>
            connection.sendTransaction(transaction, [keypair]),
          );
          try {
            await this.rpcRateLimitService.withRpcLimit(() =>
              Promise.race([
                connection.confirmTransaction(signature, 'confirmed'),
                new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error('Confirm timeout 30s')),
                    30000,
                  ),
                ),
              ]),
            );
          } catch {
            // Tx may still succeed on-chain
          }
          return signature;
        });
      }

      // EVM (ETH/BNB) – gửi native từ ví 369, không bắt buộc nativeCoin trong DB
      const rpcUrls = await this.getEvmRpcUrls(network);
      const valueWei = parseUnits(amount.toString(), 18);
      for (const rpcUrl of rpcUrls) {
        try {
          const provider = createEvmJsonRpcProvider(rpcUrl);
          const evmWallet = feeWallet as HDNodeWallet;
          const connected = evmWallet.connect(provider);
          const supportBalance = await this.rpcRateLimitService.withRpcLimit(
            () => provider.getBalance(connected.address),
          );
          if (supportBalance < valueWei) {
            if (rpcUrls.indexOf(rpcUrl) < rpcUrls.length - 1) continue;
            console.warn(
              `[${network.net_symbol}] Fee support (369) insufficient: has ${Number(supportBalance) / 1e18}, need ${amount}`,
            );
            this.feeSupportDepletedNetworks.add(network.net_symbol);
            return null;
          }
          const tx = await this.rpcRateLimitService.withRpcLimit(() =>
            connected.sendTransaction({
              to: toAddress,
              value: valueWei,
            }),
          );
          await this.rpcRateLimitService.withRpcLimit(() => tx.wait());
          return tx.hash;
        } catch (err: any) {
          const isEvmWithFallbacks =
            (network.net_symbol === 'BNB' ||
              network.net_symbol === 'BSC' ||
              network.net_symbol === 'ETH') &&
            rpcUrls.indexOf(rpcUrl) < rpcUrls.length - 1;
          if (isEvmWithFallbacks) {
            continue;
          }
          throw err;
        }
      }
      return null;
    } catch (error: any) {
      const msg = String(error?.message ?? '');
      if (
        msg.includes('insufficient') ||
        msg.includes('balance') ||
        msg.includes('depleted')
      ) {
        this.feeSupportDepletedNetworks.add(network.net_symbol);
      }
      return null;
    }
  }

  /**
   * Send transaction from user wallet to main wallet (USDT hoặc native)
   */
  private async sendTransactionToMain(
    network: Network,
    coin: Coin,
    coinNetwork: CoinNetwork,
    userWallet: HDNodeWallet | Keypair,
    mainWalletAddress: string,
    amount: number,
  ): Promise<string> {
    if (network.net_symbol === 'SOL') {
      const wssUrl = this.configService.get<string>('SOLANA_WSS_URL');
      return this.runWithSolRpcUrl(async (rpcUrl) => {
        const connection = new Connection(rpcUrl, {
          commitment: 'confirmed',
          wsEndpoint: wssUrl || undefined,
        });

        const keypair = userWallet as Keypair;
        const toPublicKey = new PublicKey(mainWalletAddress);

        if (coin.coin_symbol === 'SOL') {
          // Native SOL transfer
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: toPublicKey,
              lamports: amount * 1e9,
            }),
          );

          const signature = await this.rpcRateLimitService.withRpcLimit(() =>
            connection.sendTransaction(transaction, [keypair]),
          );
          await this.rpcRateLimitService.withRpcLimit(() =>
            connection.confirmTransaction(signature, 'confirmed'),
          );
          return signature;
        } else {
          // SPL Token transfer (USDT)
          const mintStr = this.getMintForSolUsdt(network, coin, coinNetwork);
          if (!mintStr) {
            throw new BadRequestException(
              `SPL ${coin.coin_symbol} requires cn_coin_mint (or USDT mint override) on SOL`,
            );
          }
          const mintPublicKey = new PublicKey(mintStr);
          const mintInfo = await this.rpcRateLimitService.withRpcLimit(() =>
            getMint(connection, mintPublicKey),
          );
          const decimals = mintInfo.decimals;

          const fromTokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            keypair.publicKey,
          );
          const toTokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            toPublicKey,
          );

          // Kiểm tra balance
          let fromTokenAccountInfo;
          try {
            fromTokenAccountInfo = await this.rpcRateLimitService.withRpcLimit(
              () => getAccount(connection, fromTokenAccount),
            );
          } catch {
            throw new BadRequestException(
              `Sender token account does not exist or has no balance`,
            );
          }

          const transferAmount = BigInt(
            Math.floor(amount * Math.pow(10, decimals)),
          );
          if (fromTokenAccountInfo.amount < transferAmount) {
            throw new BadRequestException('Insufficient token balance');
          }

          // Kiểm tra token account của receiver
          let toTokenAccountInfo;
          try {
            toTokenAccountInfo = await this.rpcRateLimitService.withRpcLimit(
              () => getAccount(connection, toTokenAccount),
            );
          } catch {
            toTokenAccountInfo = null;
          }

          // Tạo transaction
          const transaction = new Transaction();

          if (!toTokenAccountInfo) {
            transaction.add(
              createAssociatedTokenAccountInstruction(
                keypair.publicKey,
                toTokenAccount,
                toPublicKey,
                mintPublicKey,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
              ),
            );
          }

          transaction.add(
            createTransferInstruction(
              fromTokenAccount,
              toTokenAccount,
              keypair.publicKey,
              transferAmount,
              [],
              TOKEN_PROGRAM_ID,
            ),
          );

          const { blockhash } = await this.rpcRateLimitService.withRpcLimit(
            () => connection.getLatestBlockhash('confirmed'),
          );
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = keypair.publicKey;

          const feePayerBalance = await this.rpcRateLimitService.withRpcLimit(
            () => connection.getBalance(keypair.publicKey),
          );
          if (feePayerBalance < AdminsService.MIN_SOL_LAMPORTS_FOR_SPL_FEE) {
            throw new BadRequestException(
              `Insufficient SOL for tx fee (${feePayerBalance / 1e9} SOL). Need ~${AdminsService.MIN_SOL_LAMPORTS_FOR_SPL_FEE / 1e9} SOL.`,
            );
          }

          const signature = await this.rpcRateLimitService.withRpcLimit(() =>
            connection.sendTransaction(transaction, [keypair]),
          );
          await this.rpcRateLimitService.withRpcLimit(() =>
            connection.confirmTransaction(signature, 'confirmed'),
          );
          return signature;
        }
      });
    } else {
      // EVM transaction – thử lần lượt nhiều RPC (BNB có fallback) giống getWalletBalance
      const rpcUrls = await this.getEvmRpcUrls(network);
      if (!rpcUrls.length) {
        throw new BadRequestException(
          `RPC endpoint not configured for network ${network.net_symbol}`,
        );
      }

      const wallet = userWallet as HDNodeWallet;
      const isNativeToken =
        coin.coin_symbol === network.net_symbol ||
        (network.net_symbol === 'ETH' && coin.coin_symbol === 'ETH') ||
        (network.net_symbol === 'BNB' && coin.coin_symbol === 'BNB');

      let lastEvmError: Error | null = null;
      for (const rpcUrl of rpcUrls) {
        try {
          const provider = createEvmJsonRpcProvider(rpcUrl);

          const connectedWallet = wallet.connect(provider);

          if (isNativeToken) {
            const transferAmount = parseUnits(amount.toString(), 18);
            const senderBalance = await this.rpcRateLimitService.withRpcLimit(
              () => provider.getBalance(connectedWallet.address),
            );
            const feeData = await this.rpcRateLimitService.withRpcLimit(() =>
              provider.getFeeData(),
            );
            const estimatedGasLimit = 21000;
            const estimatedGasFee = feeData.gasPrice
              ? feeData.gasPrice * BigInt(estimatedGasLimit)
              : BigInt(0);
            if (senderBalance < transferAmount + estimatedGasFee) {
              throw new BadRequestException(
                'Insufficient balance (including gas fee)',
              );
            }
            const tx = await this.rpcRateLimitService.withRpcLimit(() =>
              connectedWallet.sendTransaction({
                to: mainWalletAddress,
                value: transferAmount,
              }),
            );
            await this.rpcRateLimitService.withRpcLimit(() => tx.wait());
            return tx.hash;
          } else {
            if (!coinNetwork.cn_coin_mint) {
              throw new BadRequestException(
                `Token ${coin.coin_symbol} requires cn_coin_mint on network ${network.net_symbol}`,
              );
            }
            const erc20Abi = [
              'function transfer(address to, uint256 amount) returns (bool)',
              'function decimals() view returns (uint8)',
            ];
            const tokenContractAddress = this.normalizeEvmAddress(
              coinNetwork.cn_coin_mint,
            );
            const tokenContract = new Contract(
              tokenContractAddress,
              new Interface(erc20Abi),
              connectedWallet,
            );
            const decimalsRaw = await this.rpcRateLimitService.withRpcLimit(
              () => tokenContract.decimals(),
            );
            const decimals =
              typeof decimalsRaw === 'bigint'
                ? Number(decimalsRaw)
                : Number(decimalsRaw);
            const transferAmount = parseUnits(amount.toString(), decimals);
            const tx = await this.rpcRateLimitService.withRpcLimit(() =>
              tokenContract.transfer(mainWalletAddress, transferAmount),
            );
            await this.rpcRateLimitService.withRpcLimit(() => tx.wait());
            return tx.hash;
          }
        } catch (err: any) {
          lastEvmError = err;
          const tryNextRpc =
            (network.net_symbol === 'BNB' ||
              network.net_symbol === 'BSC' ||
              network.net_symbol === 'ETH') &&
            rpcUrls.indexOf(rpcUrl) < rpcUrls.length - 1;
          if (tryNextRpc) {
            continue;
          }
          throw err;
        }
      }
      throw lastEvmError ?? new Error('EVM sendTransactionToMain failed');
    }
  }

  /**
   * Process main withdraw - rút USDT từ các ví active về ví main
   * Chạy background, không block response.
   * @param fromApi - true khi gọi từ API: chỉ cho phép nếu thời gian đến lần chạy tự động còn dưới 3 phút; khi chạy xong sẽ reset lịch tự động 10 phút.
   */
  async processMainWithdraw(
    adminId: number,
    options?: { fromApi?: boolean },
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      total_wallets: number;
      processing: boolean;
    };
  }> {
    const fromApi = options?.fromApi === true;

    if (fromApi) {
      const now = Date.now();
      const remainingMs =
        this.nextAutoMainWithdrawAt > 0 ? this.nextAutoMainWithdrawAt - now : 0;
      if (remainingMs > MAIN_WITHDRAW_API_MAX_WAIT_MS) {
        const remainingMin = Math.ceil(remainingMs / 60000);
        throw new BadRequestException(
          `Chỉ được gọi API main-withdraw khi thời gian đến lần chạy tự động còn dưới 3 phút. Thời gian còn lại: ${remainingMin} phút.`,
        );
      }
    }

    // Check if process is already running (set ngay để tránh 2 request cùng lúc cùng pass check)
    if (this.isMainWithdrawProcessing) {
      throw new BadRequestException(
        'Main withdraw process is already running. Please wait for the current process to complete.',
      );
    }
    this.isMainWithdrawProcessing = true;

    // Mỗi lần chạy main withdraw reset danh sách "ví trợ phí hết" để lần này thử lại (admin có thể đã nạp thêm vào ví trợ phí)
    this.feeSupportDepletedNetworks.clear();

    // Get USDT coin
    const usdtCoin = await this.coinRepository.findOne({
      where: { coin_symbol: 'USDT' },
    });

    if (!usdtCoin) {
      this.isMainWithdrawProcessing = false;
      throw new BadRequestException('USDT coin not found');
    }

    // Lấy danh sách ví đã từng nạp tiền nhưng chưa được xử lý main withdraw
    const depositTrackers = await this.walletDepositTrackerRepository.find({
      where: { wdt_withdraw: false },
    });

    if (depositTrackers.length === 0) {
      this.isMainWithdrawProcessing = false;
      return {
        statusCode: 200,
        message: 'No deposit wallets pending for main withdraw',
        data: {
          total_wallets: 0,
          processing: false,
        },
      };
    }

    // Lọc danh sách user và network từ wallet_deposit_tracker
    const userIds = Array.from(
      new Set(depositTrackers.map((t) => t.wdt_user_id)),
    );
    const networkIds = Array.from(
      new Set(depositTrackers.map((t) => t.wdt_network_id)),
    );

    // Lấy các ví active tương ứng với các user/network này
    const activeWallets = await this.activeWalletTrackerRepository.find({
      where: {
        awt_user_id: In(userIds),
        awt_network_id: In(networkIds),
      },
      relations: ['network', 'wallet_network'],
      order: { awt_last_accessed_at: 'DESC' },
    });

    if (activeWallets.length === 0) {
      this.isMainWithdrawProcessing = false;
      return {
        statusCode: 200,
        message: 'No active wallets found for deposit wallets',
        data: {
          total_wallets: 0,
          processing: false,
        },
      };
    }

    // Get mnemonic for main wallet
    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
      this.isMainWithdrawProcessing = false;
      throw new BadRequestException('Wallet seed not configured or invalid');
    }

    // Process in background (không await)
    this.processWithdrawsInBackground(
      activeWallets,
      usdtCoin,
      mnemonic,
      adminId,
    )
      .catch((error) => {
        console.error('Error processing main withdraws:', error);
      })
      .finally(() => {
        this.isMainWithdrawProcessing = false;
        // Reset lịch tự động: lần chạy tự động tiếp theo sau 10 phút (cron hoặc API thành công)
        this.nextAutoMainWithdrawAt =
          Date.now() + MAIN_WITHDRAW_AUTO_INTERVAL_MS;
      });

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Admin triggered main withdraw process for ${activeWallets.length} active wallets (from wallet_deposit_tracker)`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_type: 'wallet',
      log_old_data: null,
      log_new_data: { total_wallets: activeWallets.length },
    });

    return {
      statusCode: 200,
      message: `Main withdraw process started for ${activeWallets.length} wallets`,
      data: {
        total_wallets: activeWallets.length,
        processing: true,
      },
    };
  }

  /**
   * Get CEO wallet address from .env or fallback to main wallet
   */
  private getCeoWalletAddress(
    networkSymbol: string,
    mainWalletAddress: string,
  ): string {
    let ceoWalletAddress: string | undefined;

    if (networkSymbol === 'ETH') {
      ceoWalletAddress = this.configService.get<string>('WALLET_CEO_ETH');
    } else if (networkSymbol === 'BNB' || networkSymbol === 'BSC') {
      ceoWalletAddress = this.configService.get<string>('WALLET_CEO_BNB');
    } else if (networkSymbol === 'SOL') {
      ceoWalletAddress = this.configService.get<string>('WALLET_CEO_SOL');
    }

    // Validate CEO wallet address
    if (
      ceoWalletAddress &&
      this.isValidWalletAddress(ceoWalletAddress, networkSymbol)
    ) {
      return ceoWalletAddress;
    }

    // Fallback to main wallet
    return mainWalletAddress;
  }

  /**
   * Validate wallet address format
   */
  private isValidWalletAddress(
    address: string,
    networkSymbol: string,
  ): boolean {
    if (!address || address.trim().length === 0) {
      return false;
    }

    if (networkSymbol === 'SOL') {
      // Solana addresses are base58 encoded, typically 32-44 characters
      try {
        new PublicKey(address);
        return true;
      } catch {
        return false;
      }
    } else {
      // EVM addresses (ETH, BNB) are 0x followed by 40 hex characters
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    }
  }

  /** Tối thiểu SOL (lamports) để trả phí giao dịch SPL (~5000 + buffer). */
  private static readonly MIN_SOL_LAMPORTS_FOR_SPL_FEE = 50_000;

  /** Lấy mint address cho SOL USDT (ưu tiên SOL_USDT_MINT); các network/coin khác dùng cn_coin_mint. */
  private getMintForSolUsdt(
    network: Network,
    coin: Coin,
    coinNetwork: CoinNetwork,
  ): string | null {
    if (network.net_symbol === 'SOL' && coin.coin_symbol === 'USDT') {
      return SOL_USDT_MINT;
    }
    return coinNetwork.cn_coin_mint;
  }

  /**
   * SOL SPL token: trả về true nếu nên skip rút (ATA không tồn tại, balance < withdrawAmount, hoặc ví không đủ SOL trả phí).
   * Tránh lỗi simulation "Attempt to debit an account but found no record of a prior credit".
   */
  private async shouldSkipSolTokenWithdraw(
    network: Network,
    coin: Coin,
    coinNetwork: CoinNetwork,
    keypair: Keypair,
    withdrawAmount: number,
    derivedAddress: string,
  ): Promise<boolean> {
    try {
      const solUrls =
        await this.adminSettingsConfigService.getRpcSolUrlsToTry();
      if (solUrls.length === 0) return true;
      return await this.runWithSolRpcUrl(async (rpcUrl) => {
        const connection = new Connection(rpcUrl, { commitment: 'confirmed' });

        const solBalance = await this.rpcRateLimitService.withRpcLimit(() =>
          connection.getBalance(keypair.publicKey),
        );
        if (solBalance < AdminsService.MIN_SOL_LAMPORTS_FOR_SPL_FEE) {
          console.log(
            `SOL skip: ${derivedAddress} insufficient SOL for fee (${solBalance / 1e9} SOL), skipping`,
          );
          return true;
        }

        const mintStr = this.getMintForSolUsdt(network, coin, coinNetwork);
        if (!mintStr) {
          return true;
        }
        const mintPublicKey = new PublicKey(mintStr);
        const fromTokenAccount = await getAssociatedTokenAddress(
          mintPublicKey,
          keypair.publicKey,
        );
        const accountInfo = await this.rpcRateLimitService.withRpcLimit(() =>
          getAccount(connection, fromTokenAccount),
        );
        const mintInfo = await this.rpcRateLimitService.withRpcLimit(() =>
          getMint(connection, mintPublicKey),
        );
        const balanceNum =
          Number(accountInfo.amount) / Math.pow(10, mintInfo.decimals);
        const requiredRaw = Math.floor(
          withdrawAmount * Math.pow(10, mintInfo.decimals),
        );
        if (Number(accountInfo.amount) < requiredRaw) {
          console.log(
            `SOL skip: ${derivedAddress} ${coin.coin_symbol} ATA balance ${balanceNum} < withdraw ${withdrawAmount}`,
          );
          return true;
        }
        return false;
      });
    } catch {
      console.log(
        `SOL skip: ${derivedAddress} ${coin.coin_symbol} ATA missing or error, skipping withdraw`,
      );
      return true;
    }
  }

  /**
   * Normalize EVM address to checksummed form (tránh lỗi "bad address checksum" khi DB lưu sai).
   */
  private normalizeEvmAddress(address: string): string {
    if (!address || !address.startsWith('0x')) return address;
    try {
      return getAddress(address);
    } catch {
      return getAddress(address.toLowerCase());
    }
  }

  /**
   * Get coin price in USD (simplified - using fixed prices)
   * In production, this should fetch from an API like CoinGecko
   */
  private getCoinPriceUSD(coinSymbol: string): number {
    const prices: Record<string, number> = {
      ETH: 3000,
      BNB: 600,
      SOL: 150,
      USDT: 1,
    };
    return prices[coinSymbol.toUpperCase()] || 0;
  }

  onModuleInit(): void {
    // Chạy main withdraw một lần khi start server, sau 3s để app khởi động xong
    setTimeout(() => {
      this.handleAutoMainWithdraw().catch(() => {});
    }, 3000);
  }

  /**
   * Cron job: tự động xử lý main withdraw mỗi 10 phút
   * API POST /admins/wallets/main-withdraw chỉ được gọi khi thời gian đến lần chạy tự động còn dưới 3 phút; khi gọi thành công thì reset lịch 10 phút.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleAutoMainWithdraw(): Promise<void> {
    // Lấy admin_id đầu tiên (cũ nhất) trong database để ghi log
    const oldestAdmin = await this.adminRepository.find({
      order: { admin_id: 'ASC' },
      take: 1,
    });

    if (!oldestAdmin || oldestAdmin.length === 0) {
      console.warn(
        'handleAutoMainWithdraw: no admin found in database, skipping',
      );
      return;
    }

    const adminId = oldestAdmin[0].admin_id;

    try {
      await this.processMainWithdraw(adminId, { fromApi: false });
    } catch (error: any) {
      // Nếu đang có tiến trình chạy rồi thì bỏ qua, không log lỗi nặng
      if (
        error instanceof BadRequestException &&
        typeof error.message === 'string' &&
        error.message.includes('Main withdraw process is already running')
      ) {
        return;
      }

      console.error('Auto main withdraw cron error:', error.message);
    }
  }

  /**
   * Process withdrawals in background
   */
  private async processWithdrawsInBackground(
    activeWallets: ActiveWalletTracker[],
    usdtCoin: Coin,
    mnemonic: string,
    adminId: number,
  ): Promise<void> {
    // Group by network
    const walletsByNetwork = new Map<number, ActiveWalletTracker[]>();
    for (const wallet of activeWallets) {
      const networkId = wallet.awt_network_id;
      if (!walletsByNetwork.has(networkId)) {
        walletsByNetwork.set(networkId, []);
      }
      walletsByNetwork.get(networkId)!.push(wallet);
    }

    // Process each network in parallel
    const networkPromises = Array.from(walletsByNetwork.entries()).map(
      async ([networkId, wallets]) => {
        const network = await this.networkRepository.findOne({
          where: { net_id: networkId },
        });

        if (!network) {
          console.warn(`Network ${networkId} not found, skipping`);
          return;
        }

        // Get main wallet for this network
        const mainWallet = this.getExchangeWallet(mnemonic, network.net_symbol);
        const mainWalletAddress = this.getExchangeWalletPublicKey(
          mainWallet,
          network.net_symbol,
        );

        // Get CEO wallet address (fallback to main wallet if not configured)
        let targetWalletAddress = this.getCeoWalletAddress(
          network.net_symbol,
          mainWalletAddress,
        );

        // SOL: ví trợ phí (369) không bao giờ là đích rút tiền; nếu CEO trùng ví trợ phí thì dùng main (382)
        if (network.net_symbol === 'SOL') {
          const feeSupportWallet = this.getFeeSupportWallet(
            mnemonic,
            'SOL',
          ) as Keypair;
          const feeSupportAddress = feeSupportWallet.publicKey.toBase58();
          if (targetWalletAddress === feeSupportAddress) {
            console.warn(
              'Main withdraw SOL: target was fee support wallet (369), using main wallet (382) for withdrawals.',
            );
            targetWalletAddress = mainWalletAddress;
          }
        }

        // Get USDT coin network config
        const coinNetwork = await this.coinNetworkRepository.findOne({
          where: {
            cn_coin_id: usdtCoin.coin_id,
            cn_network_id: network.net_id,
            cn_status: CoinNetworkStatus.ACTIVE,
          },
        });

        if (!coinNetwork) {
          console.warn(
            `USDT not configured for network ${network.net_symbol}, skipping`,
          );
          return;
        }

        // SOL: kiểm tra/tạo ATA CEO (hoặc main 382) chỉ một lần mỗi network, trước khi xử lý ví đầu tiên; các ví sau không cần bước này
        if (network.net_symbol === 'SOL') {
          await this.ensureTargetHasSolUsdtAta(
            network,
            usdtCoin,
            coinNetwork,
            targetWalletAddress,
            mainWalletAddress,
            mnemonic,
          );
        }

        // Process each wallet in parallel (with error handling)
        const walletPromises = wallets.map(async (tracker) => {
          try {
            await this.processSingleWalletWithdraw(
              tracker,
              network,
              usdtCoin,
              coinNetwork,
              targetWalletAddress,
              adminId,
              mnemonic,
            );
          } catch (error) {
            console.error(
              `Error processing wallet ${tracker.awt_address} on ${network.net_symbol}:`,
              error.message,
            );
            // Continue with other wallets
          }
        });

        await Promise.allSettled(walletPromises);
      },
    );

    await Promise.allSettled(networkPromises);
  }

  /**
   * Process withdraw for a single wallet
   */
  private async processSingleWalletWithdraw(
    tracker: ActiveWalletTracker,
    network: Network,
    usdtCoin: Coin,
    coinNetwork: CoinNetwork,
    targetWalletAddress: string,
    adminId: number,
    mnemonic: string,
  ): Promise<void> {
    const userWalletAddress = tracker.awt_address;

    // Get wallet network to get end_path
    const walletNetwork = await this.useWalletNetworkRepository.findOne({
      where: { uwn_id: tracker.uwn_id },
      select: ['uwn_end_path'],
    });

    if (!walletNetwork) {
      console.warn(`Wallet network ${tracker.uwn_id} not found, skipping`);
      return;
    }

    // Generate ví derive (ví thực sự ký và gửi) và dùng địa chỉ này để check balance,
    // tránh lỗi SOL "Attempt to debit an account but found no record of a prior credit".
    const userWallet = this.generateUserWallet(
      mnemonic,
      tracker.awt_user_id,
      walletNetwork.uwn_end_path,
      network.net_symbol,
    );
    const derivedAddress = this.getDerivedWalletAddressString(
      userWallet,
      network.net_symbol,
    );
    // Check native coin balance first (for gas fee and threshold check)
    let nativeCoin: Coin | null = null;
    if (network.net_symbol === 'SOL') {
      nativeCoin = await this.coinRepository.findOne({
        where: { coin_symbol: 'SOL' },
      });
    } else if (network.net_symbol === 'ETH') {
      nativeCoin = await this.coinRepository.findOne({
        where: { coin_symbol: 'ETH' },
      });
    } else if (network.net_symbol === 'BNB') {
      nativeCoin = await this.coinRepository.findOne({
        where: { coin_symbol: 'BNB' },
      });
    }

    let nativeBalance = 0;
    let nativeCoinNetwork: CoinNetwork | null = null;
    let nativeCoinError = false;

    if (nativeCoin) {
      nativeCoinNetwork = await this.coinNetworkRepository.findOne({
        where: {
          cn_coin_id: nativeCoin.coin_id,
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
      });

      const minGasThreshold = network.net_symbol === 'SOL' ? 0.001 : 0.0001; // 0.001 SOL or 0.0001 ETH/BNB

      if (nativeCoinNetwork) {
        try {
          nativeBalance = await this.getWalletBalance(
            network,
            nativeCoin,
            nativeCoinNetwork,
            derivedAddress,
          );
        } catch (error) {
          console.error(
            `Error checking native coin balance for ${derivedAddress}:`,
            error.message,
          );
          nativeCoinError = true;
        }
      } else if (network.net_symbol === 'SOL') {
        // SOL: không có coin_network trong DB vẫn lấy balance qua RPC và nạp phí từ ví 369 (thử DB rồi env)
        try {
          const solUrls =
            await this.adminSettingsConfigService.getRpcSolUrlsToTry();
          if (solUrls.length > 0) {
            nativeBalance = await this.runWithSolRpcUrl(async (rpcUrl) => {
              const connection = new Connection(rpcUrl, {
                commitment: 'confirmed',
              });
              const lamports = await this.rpcRateLimitService.withRpcLimit(() =>
                connection.getBalance((userWallet as Keypair).publicKey),
              );
              return lamports / 1e9;
            });
          }
        } catch (error) {
          console.error(
            `Error getting SOL balance for ${derivedAddress}:`,
            error?.message ?? error,
          );
          nativeCoinError = true;
        }
      } else {
        nativeCoinError = true;
      }

      // SOL: nếu chưa có balance tin cậy (lỗi hoặc chưa lấy), thử lấy trực tiếp qua RPC (DB rồi env)
      if (
        network.net_symbol === 'SOL' &&
        (nativeCoinError || nativeBalance < minGasThreshold)
      ) {
        try {
          const solUrls =
            await this.adminSettingsConfigService.getRpcSolUrlsToTry();
          if (solUrls.length > 0) {
            nativeBalance = await this.runWithSolRpcUrl(async (rpcUrl) => {
              const connection = new Connection(rpcUrl, {
                commitment: 'confirmed',
              });
              const lamports = await this.rpcRateLimitService.withRpcLimit(() =>
                connection.getBalance((userWallet as Keypair).publicKey),
              );
              return lamports / 1e9;
            });
            nativeCoinError = false;
          }
        } catch {
          // Giữ nguyên nativeBalance / nativeCoinError
        }
      }

      // Nạp native (SOL/ETH/BNB) từ ví trợ phí (path 369) nếu ví user thiếu phí. SOL luôn thử; EVM cần có nativeCoinNetwork.
      const canTopUp =
        network.net_symbol === 'SOL' || nativeCoinNetwork != null;
      if (nativeBalance < minGasThreshold && canTopUp) {
        const targetBalance = minGasThreshold * 2;
        const topupAmount = targetBalance - nativeBalance;

        const topupTxHash = await this.sendGasFromSupportWallet(
          network,
          nativeCoin,
          nativeCoinNetwork ?? (null as any),
          mnemonic,
          derivedAddress,
          topupAmount,
        );

        if (!topupTxHash) {
          return;
        }
      }
    } else {
      nativeCoinError = true;
    }

    // SOL: luôn đảm bảo ví user có đủ SOL trả phí (từ ví trợ phí 369), không phụ thuộc nativeCoin/nativeCoinNetwork trong DB
    if (
      network.net_symbol === 'SOL' &&
      !this.feeSupportDepletedNetworks.has('SOL')
    ) {
      try {
        const solUrls =
          await this.adminSettingsConfigService.getRpcSolUrlsToTry();
        if (solUrls.length > 0) {
          const solBalance = await this.runWithSolRpcUrl(async (rpcUrl) => {
            const connection = new Connection(rpcUrl, {
              commitment: 'confirmed',
            });
            const lamports = await this.rpcRateLimitService.withRpcLimit(() =>
              connection.getBalance((userWallet as Keypair).publicKey),
            );
            return lamports / 1e9;
          });
          const minSol = 0.001;
          if (solBalance < minSol) {
            const topupAmount = 0.002;
            const txHash = await this.sendGasFromSupportWallet(
              network,
              null,
              null,
              mnemonic,
              derivedAddress,
              topupAmount,
            );
            if (!txHash) {
              // Fee support depleted or error
            }
          }
        }
      } catch {
        // Ignore SOL top-up errors
      }
    }

    // BNB/ETH: đảm bảo ví user có đủ native (BNB/ETH) trả phí, trợ từ ví 369 nếu thiếu
    const isEvmNetwork =
      network.net_symbol === 'BNB' ||
      network.net_symbol === 'BSC' ||
      network.net_symbol === 'ETH';
    if (
      isEvmNetwork &&
      !this.feeSupportDepletedNetworks.has(network.net_symbol)
    ) {
      try {
        const rpcUrls = await this.getEvmRpcUrls(network);
        const minNativeWei = BigInt('100000000000000'); // 0.0001
        const topupAmount = 0.001;
        let nativeBalanceWei = BigInt(0);
        for (const rpcUrl of rpcUrls) {
          try {
            const provider = createEvmJsonRpcProvider(rpcUrl);
            nativeBalanceWei = await this.rpcRateLimitService.withRpcLimit(() =>
              provider.getBalance(derivedAddress),
            );
            break;
          } catch {
            if (rpcUrls.indexOf(rpcUrl) < rpcUrls.length - 1) continue;
          }
        }
        if (nativeBalanceWei < minNativeWei) {
          const txHash = await this.sendGasFromSupportWallet(
            network,
            null,
            null,
            mnemonic,
            derivedAddress,
            topupAmount,
          );
          if (!txHash) {
            // Fee support depleted or error
          }
        }
      } catch {
        // Ignore native top-up errors
      }
    }

    // Get USDT balance from blockchain (địa chỉ ví derive = ví sẽ gửi, tránh lỗi SOL token account không tồn tại)
    let usdtBalance = 0;
    let usdtBalanceError = false;
    try {
      usdtBalance = await this.getWalletBalance(
        network,
        usdtCoin,
        coinNetwork,
        derivedAddress,
      );
    } catch (error) {
      console.error(
        `Error getting USDT balance for ${derivedAddress}:`,
        error.message,
      );
      usdtBalanceError = true;
      // Continue to check native coin if USDT check fails
    }

    // Điều kiện mới: chỉ xử lý main withdraw nếu USDT > 10
    if (!usdtBalanceError && usdtBalance <= 10) {
      console.log(
        `Wallet ${derivedAddress} has USDT balance <= 10 (${usdtBalance}), skipping main withdraw`,
      );
      return;
    }

    // Check native coin value in USD (for threshold check)
    let nativeCoinValueUSD = 0;
    if (!nativeCoinError && nativeCoin && nativeBalance > 0) {
      const nativeCoinPrice = this.getCoinPriceUSD(nativeCoin.coin_symbol);
      nativeCoinValueUSD = nativeBalance * nativeCoinPrice;
    }

    // Check threshold: Skip if USDT < 1 AND native coin < $2
    // If either check fails (error), proceed with withdrawal
    if (!usdtBalanceError && !nativeCoinError) {
      if (usdtBalance < 1 && nativeCoinValueUSD < 2) {
        return;
      }
    }
    // If there's an error in checking, proceed with withdrawal (as per requirement)

    // Process withdrawals for coins that meet conditions
    const coinsToWithdraw: Array<{
      coin: Coin;
      coinNetwork: CoinNetwork;
      balance: number;
      needsBalanceCheck: boolean; // Flag to indicate if balance needs to be fetched during withdrawal
    }> = [];

    // Add USDT: chỉ thêm khi balance > 0; nếu lỗi đọc balance thì thử đọc lại trong loop (trừ SOL: không thử rút khi chưa biết balance)
    if (usdtBalance > 0) {
      coinsToWithdraw.push({
        coin: usdtCoin,
        coinNetwork: coinNetwork,
        balance: usdtBalance,
        needsBalanceCheck: usdtBalanceError,
      });
    } else if (usdtBalanceError && network.net_symbol !== 'SOL') {
      // EVM: có thể RPC lỗi tạm thời, thử đọc balance lại trong loop
      coinsToWithdraw.push({
        coin: usdtCoin,
        coinNetwork: coinNetwork,
        balance: 0,
        needsBalanceCheck: true,
      });
    }
    // SOL: không thêm khi usdtBalance = 0 (tránh thử rút khi ATA không tồn tại / balance 0)

    // Process each coin that meets withdrawal conditions
    for (const {
      coin,
      coinNetwork: cn,
      balance,
      needsBalanceCheck,
    } of coinsToWithdraw) {
      try {
        let actualBalance = balance;

        // If balance check failed, try to get balance directly from blockchain (dùng derived address)
        if (needsBalanceCheck) {
          try {
            actualBalance = await this.getWalletBalance(
              network,
              coin,
              cn,
              derivedAddress,
            );

            if (actualBalance <= 0) {
              continue;
            }
          } catch (error) {
            console.error(
              `Error getting ${coin.coin_symbol} balance during withdrawal for ${derivedAddress}:`,
              error.message,
            );
            // If still can't get balance, skip this coin
            continue;
          }
        }

        // Rút 100% USDT trên mọi mạng (SOL, BNB, ETH); gas trả bằng native, không cần giữ lại % USDT
        const withdrawAmount = actualBalance;

        if (withdrawAmount <= 0) {
          continue;
        }

        // SOL SPL: ví có USDT nhưng thiếu SOL trả phí thì thử nạp từ ví trợ phí (path 369) trước khi skip
        if (
          network.net_symbol === 'SOL' &&
          coin.coin_symbol !== 'SOL' &&
          nativeCoin &&
          !this.feeSupportDepletedNetworks.has('SOL')
        ) {
          try {
            const solUrls =
              await this.adminSettingsConfigService.getRpcSolUrlsToTry();
            if (solUrls.length > 0) {
              const solLamports = await this.runWithSolRpcUrl(
                async (rpcUrl) => {
                  const connection = new Connection(rpcUrl, {
                    commitment: 'confirmed',
                  });
                  const keypair = userWallet as Keypair;
                  return this.rpcRateLimitService.withRpcLimit(() =>
                    connection.getBalance(keypair.publicKey),
                  );
                },
              );
              if (solLamports < AdminsService.MIN_SOL_LAMPORTS_FOR_SPL_FEE) {
                const topupAmount = 0.002;
                const topupTx = await this.sendGasFromSupportWallet(
                  network,
                  nativeCoin,
                  nativeCoinNetwork ?? (null as any),
                  mnemonic,
                  derivedAddress,
                  topupAmount,
                );
                if (topupTx) {
                  // SOL topped up for USDT withdraw
                }
              }
            }
          } catch {
            // Bỏ qua lỗi, tiếp tục kiểm tra shouldSkipSolTokenWithdraw
          }
        }

        // SOL SPL: xác nhận ATA tồn tại và đủ balance trước khi gửi, tránh lỗi "no record of a prior credit"
        if (network.net_symbol === 'SOL' && coin.coin_symbol !== 'SOL') {
          const solSkip = await this.shouldSkipSolTokenWithdraw(
            network,
            coin,
            cn,
            userWallet as Keypair,
            withdrawAmount,
            derivedAddress,
          );
          if (solSkip) {
            continue;
          }
        }

        // userWallet đã tạo ở đầu hàm (ví derive), dùng luôn để gửi
        // Send transaction from user wallet to target wallet (CEO or main)
        const txHash = await this.sendTransactionToMain(
          network,
          coin,
          cn,
          userWallet,
          targetWalletAddress,
          withdrawAmount,
        );

        // Chỉ ghi wallet_histories nếu chưa tồn tại bản ghi cùng wh_hash + admin-deposit (tránh trùng khi cron + API hoặc retry)
        const existingByHash = await this.walletHistoryRepository.findOne({
          where: {
            wh_hash: txHash,
            wh_option: WalletHistoryOption.ADMIN_DEPOSIT,
          },
        });
        if (!existingByHash) {
          await this.walletHistoryRepository.save({
            wh_wallet_netword_id: tracker.uwn_id,
            wh_type: WalletHistoryType.CRYPTO,
            wh_option: WalletHistoryOption.ADMIN_DEPOSIT,
            wh_coins: coin.coin_id,
            wh_amount: withdrawAmount,
            wh_hash: txHash,
            wh_status: WalletHistoryStatus.SUCCESS,
            wh_user: tracker.awt_user_id,
            wh_node: network.net_symbol,
          });
        }

        // Create admin log for successful withdrawal
        await this.adminLogRepository.save({
          log_admin_id: adminId,
          log_action: AdminLogAction.UPDATE,
          log_module: AdminLogModule.SYSTEM,
          log_description: `Main withdraw: ${withdrawAmount} ${coin.coin_symbol} from ${derivedAddress} to ${targetWalletAddress} on ${network.net_symbol}. TxHash: ${txHash}`,
          log_ip_address: null,
          log_user_agent: null,
          log_target_id: tracker.uwn_id,
          log_target_type: 'wallet',
          log_old_data: { balance },
          log_new_data: {
            withdrawAmount,
            txHash,
            targetWallet: targetWalletAddress,
          },
        });

        // Sau khi rút tiền thành công, cập nhật wdt_withdraw = true
        // cho tất cả các bản ghi có cùng địa chỉ ví (wdt_address) của user trên network này
        try {
          await this.walletDepositTrackerRepository.update(
            {
              wdt_user_id: tracker.awt_user_id,
              wdt_network_id: network.net_id,
              wdt_address: userWalletAddress,
            },
            { wdt_withdraw: true },
          );
        } catch (updateError: any) {
          console.error(
            `Error updating wallet_deposit_tracker for ${userWalletAddress} on ${network.net_symbol}:`,
            updateError.message,
          );
        }
      } catch (error) {
        console.error(
          `Error withdrawing ${coin.coin_symbol} from ${derivedAddress} on ${network.net_symbol}:`,
          error.message,
        );
        // Continue with other coins - don't throw
      }
    }
  }

  /** Fallback RPC cho BNB khi RPC chính trả về invalid JSON / lỗi. */
  private static readonly BNB_RPC_FALLBACKS = [
    'https://bsc-dataseed.bnbchain.org',
    'https://bsc-dataseed1.defibit.io',
    'https://rpc.ankr.com/bsc',
    'https://bsc-dataseed.ninicoin.io',
  ];

  /** Fallback RPC cho ETH khi RPC chính lỗi. */
  private static readonly ETH_RPC_FALLBACKS = [
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
    'https://ethereum.publicnode.com',
    'https://1rpc.io/eth',
    'https://cloudflare-eth.com',
  ];

  /** RPC SOL: từ admin_settings (as_config_rps_sol) hoặc .env SOLANA_RPC_URL. */
  private async getEffectiveRpcSol(): Promise<string> {
    const url = await this.adminSettingsConfigService.getEffectiveRpcSol();
    if (!url) {
      throw new BadRequestException(
        'SOLANA_RPC_URL not configured (admin_settings or .env)',
      );
    }
    return url;
  }

  private static normalizeRpcUrl(url: string): string {
    return url.replace(/\/+$/, '').trim();
  }

  /** Thử lần lượt từng SOL RPC (DB rồi env nếu khác); khi lỗi/rate limit sẽ thử URL tiếp theo. */
  private async runWithSolRpcUrl<T>(
    fn: (rpcUrl: string) => Promise<T>,
  ): Promise<T> {
    const urls = await this.adminSettingsConfigService.getRpcSolUrlsToTry();
    if (urls.length === 0) {
      throw new BadRequestException(
        'SOLANA_RPC_URL not configured (admin_settings or .env)',
      );
    }
    let lastErr: Error | null = null;
    for (const rpcUrl of urls) {
      try {
        return await fn(rpcUrl);
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        continue;
      }
    }
    throw lastErr ?? new BadRequestException('SOLANA_RPC_URL not configured');
  }

  private async getEvmRpcUrls(network: Network): Promise<string[]> {
    const primaryUrls =
      await this.adminSettingsConfigService.getRpcUrlsToTryByNetwork(
        network.net_symbol,
      );
    const urls = primaryUrls.length ? [...primaryUrls] : [];
    const normalizedSet = new Set(urls.map(AdminsService.normalizeRpcUrl));
    if (network.net_symbol === 'BNB' || network.net_symbol === 'BSC') {
      for (const fallback of AdminsService.BNB_RPC_FALLBACKS) {
        if (!normalizedSet.has(AdminsService.normalizeRpcUrl(fallback)))
          urls.push(fallback);
      }
    } else if (network.net_symbol === 'ETH') {
      for (const fallback of AdminsService.ETH_RPC_FALLBACKS) {
        if (!normalizedSet.has(AdminsService.normalizeRpcUrl(fallback)))
          urls.push(fallback);
      }
    }
    return urls;
  }

  /**
   * Get wallet balance from blockchain
   */
  private async getWalletBalance(
    network: Network,
    coin: Coin,
    coinNetwork: CoinNetwork,
    address: string,
  ): Promise<number> {
    if (network.net_symbol === 'SOL') {
      return this.runWithSolRpcUrl(async (rpcUrl) => {
        const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
        const addressPublicKey = new PublicKey(address);

        if (coin.coin_symbol === 'SOL') {
          const balance = await this.rpcRateLimitService.withRpcLimit(() =>
            connection.getBalance(addressPublicKey),
          );
          return balance / 1e9; // Convert lamports to SOL
        } else {
          // SPL Token
          const mintStr = this.getMintForSolUsdt(network, coin, coinNetwork);
          if (!mintStr) {
            return 0;
          }
          const mintPublicKey = new PublicKey(mintStr);
          const tokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            addressPublicKey,
          );
          try {
            const accountInfo = await this.rpcRateLimitService.withRpcLimit(
              () => getAccount(connection, tokenAccount),
            );
            const mintInfo = await this.rpcRateLimitService.withRpcLimit(() =>
              getMint(connection, mintPublicKey),
            );
            return Number(accountInfo.amount) / Math.pow(10, mintInfo.decimals);
          } catch {
            return 0; // Token account doesn't exist or has no balance
          }
        }
      });
    } else {
      // EVM – thử nhiều RPC (BNB có fallback), retry khi invalid JSON / lỗi mạng
      const rpcUrls = await this.getEvmRpcUrls(network);
      if (rpcUrls.length === 0) {
        throw new BadRequestException(
          `RPC endpoint not configured for network ${network.net_symbol}`,
        );
      }

      const delayMs = 800;
      let lastError: Error | null = null;

      for (let urlIndex = 0; urlIndex < rpcUrls.length; urlIndex++) {
        const rpcUrl = rpcUrls[urlIndex];
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const provider = createEvmJsonRpcProvider(rpcUrl);

            if (
              coin.coin_symbol === network.net_symbol ||
              (network.net_symbol === 'ETH' && coin.coin_symbol === 'ETH') ||
              (network.net_symbol === 'BNB' && coin.coin_symbol === 'BNB')
            ) {
              const balance = await this.rpcRateLimitService.withRpcLimit(() =>
                provider.getBalance(address),
              );
              const balanceStr =
                typeof balance === 'bigint'
                  ? balance.toString()
                  : String(balance);
              return parseFloat(parseUnits(balanceStr, 0).toString()) / 1e18;
            } else {
              if (!coinNetwork.cn_coin_mint) {
                return 0;
              }
              const erc20Abi = [
                'function balanceOf(address owner) view returns (uint256)',
                'function decimals() view returns (uint8)',
              ];
              const tokenContractAddress = this.normalizeEvmAddress(
                coinNetwork.cn_coin_mint,
              );
              const tokenContract = new Contract(
                tokenContractAddress,
                new Interface(erc20Abi),
                provider,
              );
              const balance = await this.rpcRateLimitService.withRpcLimit(() =>
                tokenContract.balanceOf(address),
              );
              const decimalsRaw = await this.rpcRateLimitService.withRpcLimit(
                () => tokenContract.decimals(),
              );
              const decimals =
                typeof decimalsRaw === 'bigint'
                  ? Number(decimalsRaw)
                  : Number(decimalsRaw);
              const balanceNum =
                typeof balance === 'bigint'
                  ? Number(balance)
                  : parseFloat(balance.toString());
              return balanceNum / Math.pow(10, decimals);
            }
          } catch (err: any) {
            lastError = err;
            const isRetryable =
              err?.code === 'UNSUPPORTED_OPERATION' ||
              (typeof err?.message === 'string' &&
                (err.message.includes('valid JSON') ||
                  err.message.includes('ECONNRESET') ||
                  err.message.includes('ETIMEDOUT') ||
                  err.message.includes('network')));
            if (isRetryable && attempt < 2) {
              await new Promise((r) => setTimeout(r, delayMs));
              continue;
            }
            if (urlIndex < rpcUrls.length - 1) {
              break;
            }
            throw err;
          }
        }
      }
      throw lastError ?? new Error('EVM getWalletBalance failed after retries');
    }
  }

  /**
   * Chuyển toàn bộ tài sản từ ví trợ phí (path 369) sang ví CEO (fallback ví main 382).
   * - USDT: chỉ chuyển nếu balance >= 1 USDT.
   * - Native (SOL/ETH/BNB): chuyển gần như toàn bộ, giữ lại một ít làm phí.
   */
  async feeSubsidyToMain(adminId: number): Promise<{
    statusCode: number;
    message: string;
    data: {
      results: Array<{
        network: string;
        usdtTransferred: number;
        nativeTransferred: number;
        usdtTxHash?: string | null;
        nativeTxHash?: string | null;
      }>;
    };
  }> {
    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
      throw new BadRequestException('Wallet seed not configured or invalid');
    }

    const usdtCoin = await this.coinRepository.findOne({
      where: { coin_symbol: 'USDT' },
    });
    if (!usdtCoin) {
      throw new BadRequestException('USDT coin not found');
    }

    // Lấy các network đang active
    const networks = await this.networkRepository.find({
      where: { net_status: NetStatus.ACTIVE },
      order: { net_id: 'ASC' },
    });

    const results: Array<{
      network: string;
      usdtTransferred: number;
      nativeTransferred: number;
      usdtTxHash?: string | null;
      nativeTxHash?: string | null;
    }> = [];

    for (const network of networks) {
      const feeWallet = this.getFeeSupportWallet(mnemonic, network.net_symbol);
      const feeWalletAddress = this.getExchangeWalletPublicKey(
        feeWallet,
        network.net_symbol,
      );

      const mainWallet = this.getExchangeWallet(mnemonic, network.net_symbol);
      const mainWalletAddress = this.getExchangeWalletPublicKey(
        mainWallet,
        network.net_symbol,
      );
      const targetWalletAddress = this.getCeoWalletAddress(
        network.net_symbol,
        mainWalletAddress,
      );

      console.log(
        '[feeSubsidyToMain] Start network',
        network.net_symbol,
        '| feeWallet =',
        feeWalletAddress,
        '| targetWallet =',
        targetWalletAddress,
      );

      let usdtTransferred = 0;
      let nativeTransferred = 0;
      let usdtTxHash: string | null = null;
      let nativeTxHash: string | null = null;

      // 1. Chuyển USDT từ ví trợ phí (path 369) sang ví CEO (fallback main 382) nếu balance >= 1 USDT
      const usdtCoinNetwork = await this.coinNetworkRepository.findOne({
        where: {
          cn_coin_id: usdtCoin.coin_id,
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
      });

      if (usdtCoinNetwork) {
        try {
          const usdtBalance = await this.getWalletBalance(
            network,
            usdtCoin,
            usdtCoinNetwork,
            feeWalletAddress,
          );

          console.log(
            '[feeSubsidyToMain] USDT balance',
            usdtBalance,
            'on',
            network.net_symbol,
            'for fee wallet',
            feeWalletAddress,
          );

          if (usdtBalance >= 1) {
            const sendAmount = usdtBalance;
            console.log(
              '[feeSubsidyToMain] Sending USDT',
              sendAmount,
              'from fee wallet',
              feeWalletAddress,
              'to',
              targetWalletAddress,
              'on',
              network.net_symbol,
            );
            try {
              usdtTxHash = await this.sendTransactionToMain(
                network,
                usdtCoin,
                usdtCoinNetwork,
                feeWallet,
                targetWalletAddress,
                sendAmount,
              );
              usdtTransferred = sendAmount;
            } catch (error: any) {
              console.error(
                `feeSubsidyToMain USDT transfer failed on ${network.net_symbol}:`,
                error?.message || error,
              );
            }
          } else {
            console.log(
              '[feeSubsidyToMain] Skip USDT on',
              network.net_symbol,
              'because balance < 1 USDT:',
              usdtBalance,
            );
          }
        } catch (error: any) {
          console.error(
            `feeSubsidyToMain get USDT balance failed on ${network.net_symbol}:`,
            error?.message || error,
          );
        }
      }

      // 2. Chuyển native coin (SOL / ETH / BNB) còn lại từ ví trợ phí sang ví CEO (fallback main 382)
      try {
        let nativeBalance = 0;

        if (network.net_symbol === 'SOL') {
          nativeBalance = await this.runWithSolRpcUrl(async (rpcUrl) => {
            const connection = new Connection(rpcUrl, {
              commitment: 'confirmed',
            });
            const balanceLamports = await this.rpcRateLimitService.withRpcLimit(
              () => connection.getBalance(new PublicKey(feeWalletAddress)),
            );
            return balanceLamports / 1e9;
          });
        } else {
          const rpcUrls = await this.getEvmRpcUrls(network);
          if (rpcUrls.length === 0) {
            throw new BadRequestException(
              `RPC endpoint not configured for network ${network.net_symbol}`,
            );
          }

          let lastError: Error | null = null;
          for (let urlIndex = 0; urlIndex < rpcUrls.length; urlIndex++) {
            const rpcUrl = rpcUrls[urlIndex];
            try {
              const provider = createEvmJsonRpcProvider(rpcUrl);
              const balanceWei = await this.rpcRateLimitService.withRpcLimit(
                () => provider.getBalance(feeWalletAddress),
              );
              const balanceStr =
                typeof balanceWei === 'bigint'
                  ? balanceWei.toString()
                  : String(balanceWei);
              nativeBalance =
                parseFloat(parseUnits(balanceStr, 0).toString()) / 1e18;
              lastError = null;
              break;
            } catch (err: any) {
              lastError = err;
              if (urlIndex < rpcUrls.length - 1) continue;
            }
          }
          if (lastError) throw lastError;
        }

        const minRemain = network.net_symbol === 'SOL' ? 0.001 : 0.0001;
        console.log(
          '[feeSubsidyToMain] Native balance',
          nativeBalance,
          'on',
          network.net_symbol,
          'for fee wallet',
          feeWalletAddress,
          '| minRemain =',
          minRemain,
        );

        if (nativeBalance > minRemain) {
          const sendAmount = nativeBalance - minRemain;
          console.log(
            '[feeSubsidyToMain] Sending native',
            sendAmount,
            'from fee wallet',
            feeWalletAddress,
            'to',
            targetWalletAddress,
            'on',
            network.net_symbol,
          );
          try {
            nativeTxHash = await this.sendGasFromSupportWallet(
              network,
              null,
              null,
              mnemonic,
              targetWalletAddress,
              sendAmount,
            );
            nativeTransferred = sendAmount;
          } catch (error: any) {
            console.error(
              `feeSubsidyToMain native transfer failed on ${network.net_symbol}:`,
              error?.message || error,
            );
          }
        } else {
          console.log(
            '[feeSubsidyToMain] Skip native on',
            network.net_symbol,
            'because balance <= minRemain:',
            nativeBalance,
            '<=',
            minRemain,
          );
        }
      } catch (error: any) {
        console.error(
          `feeSubsidyToMain get native balance failed on ${network.net_symbol}:`,
          error?.message || error,
        );
      }

      results.push({
        network: network.net_symbol,
        usdtTransferred,
        nativeTransferred,
        usdtTxHash,
        nativeTxHash,
      });
    }

    // Ghi log admin cho action này
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Super admin triggered fee-subsidy to main for ${networks.length} fee wallets`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_type: 'wallet',
      log_old_data: null,
      log_new_data: { networks: networks.map((n) => n.net_symbol) },
    });

    return {
      statusCode: 200,
      message: 'Fee subsidy wallets transferred to CEO/main wallets',
      data: {
        results,
      },
    };
  }

  /**
   * Lấy danh sách KOL articles với filter
   * @param status - Filter theo status (optional)
   * @param userId - Filter theo user_id (optional)
   * @returns Danh sách KOL articles
   */
  async getKolArticles(
    status?: string,
    userId?: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      ka_id: number;
      ka_user_id: number;
      ka_article_url: string;
      ka_status: KolArticleStatus;
      created_at: Date;
      user: {
        uid: number;
        uname: string;
        ufulllname: string;
        uemail: string;
        uphone: string | null;
        uavatar: string | null;
      };
    }>;
  }> {
    const queryBuilder = this.kolArticleRepository
      .createQueryBuilder('ka')
      .leftJoinAndSelect('ka.user', 'user')
      .orderBy('ka.created_at', 'DESC');

    // Filter theo status
    if (status) {
      const validStatuses = [
        KolArticleStatus.PENDING,
        KolArticleStatus.APPROVED,
        KolArticleStatus.REJECTED,
      ];

      let matchedStatus: KolArticleStatus | null = null;
      for (const validStatus of validStatuses) {
        if (validStatus.toLowerCase() === status.toLowerCase()) {
          matchedStatus = validStatus;
          break;
        }
      }

      const finalStatus = matchedStatus || KolArticleStatus.PENDING;
      queryBuilder.andWhere('ka.ka_status = :status', { status: finalStatus });
    }

    // Filter theo user_id
    if (userId && !Number.isNaN(userId)) {
      queryBuilder.andWhere('ka.ka_user_id = :userId', { userId });
    }

    const kolArticles = await queryBuilder.getMany();

    const formattedData = kolArticles.map((ka) => ({
      ka_id: ka.ka_id,
      ka_user_id: ka.ka_user_id,
      ka_article_url: ka.ka_article_url,
      ka_status: ka.ka_status,
      created_at: ka.created_at,
      user: {
        uid: ka.user.uid,
        uname: ka.user.uname,
        ufulllname: ka.user.ufulllname,
        uemail: ka.user.uemail,
        uphone: ka.user.uphone,
        uavatar: ka.user.uavatar,
      },
    }));

    return {
      statusCode: 200,
      message: 'KOL articles retrieved successfully',
      data: formattedData,
    };
  }

  /**
   * Cập nhật status của KOL article
   * @param articleId - ID của article
   * @param status - Status mới
   * @param adminId - ID của admin thực hiện
   * @returns KOL article đã được cập nhật
   */
  async updateKolArticleStatus(
    articleId: number,
    status: KolArticleStatus,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      ka_id: number;
      ka_user_id: number;
      ka_article_url: string;
      ka_status: KolArticleStatus;
      created_at: Date;
    };
  }> {
    if (!articleId || Number.isNaN(articleId)) {
      throw new BadRequestException('Invalid article id');
    }

    const kolArticle = await this.kolArticleRepository.findOne({
      where: { ka_id: articleId },
    });

    if (!kolArticle) {
      throw new NotFoundException('KOL article not found');
    }

    const oldStatus = kolArticle.ka_status;
    kolArticle.ka_status = status;
    await this.kolArticleRepository.save(kolArticle);

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.USERS,
      log_description: `Admin updated KOL article status: article_id=${articleId}, old_status=${oldStatus}, new_status=${status}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: articleId,
      log_target_type: 'kol_article',
      log_old_data: { status: oldStatus },
      log_new_data: { status },
    });

    return {
      statusCode: 200,
      message: 'KOL article status updated successfully',
      data: {
        ka_id: kolArticle.ka_id,
        ka_user_id: kolArticle.ka_user_id,
        ka_article_url: kolArticle.ka_article_url,
        ka_status: kolArticle.ka_status,
        created_at: kolArticle.created_at,
      },
    };
  }
}
