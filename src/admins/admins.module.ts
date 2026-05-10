import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminsController } from './admins.controller';
import { AdminsStatisticalController } from './admins-statistical.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminWalletController } from './admin-wallet.controller';
import { AdminsKycController } from './admins-kyc.controller';
import { AdminsAuthService } from './admins-auth.service';
import { AdminsStatisticsService } from './admins-statistics.service';
import { AdminsUsersOpsService } from './admins-users-ops.service';
import { AdminsWalletOpsService } from './admins-wallet-ops.service';
import { AdminsKycService } from './admins-kyc.service';
import { AdminRole } from './entities/admin-role.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Admin } from './entities/admin.entity';
import { AdminLog } from './entities/admin-log.entity';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from './guards/admin-permission.guard';
import { User } from '../users/entities/user.entity';
import { BankUser } from '../users/entities/bank-user.entity';
import { WalletHistory } from '../wallets/entities/wallet-history.entity';
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import { WalletTransfer } from '../wallets/entities/wallet-transfer.entity';
import { Coin } from '../settings/entities/coin.entity';
import { Network } from '../settings/entities/network.entity';
import { UserWalletNetwork } from '../wallets/entities/user-wallet-network.entity';
import { ActiveWalletTracker } from '../wallets/entities/active-wallet-tracker.entity';
import { WalletDepositTracker } from '../wallets/entities/wallet-deposit-tracker.entity';
import { CoinNetwork } from '../settings/entities/coin-network.entity';
import { Transaction } from '../orderbook/entities/transaction.entity';
import { VerifyLog } from '../users/entities/verify-log.entity';
import { UserVerify } from '../users/entities/user-verify.entity';
import { KolRegister } from '../users/entities/kol-register.entity';
import { KolArticle } from '../users/entities/kol-article.entity';
import { AdminPermissionReadSettingsGuard } from './guards/admin-permission-read-settings.guard';
import { AdminPermissionReadUsersGuard } from './guards/admin-permission-read-users.guard';
import { AdminPermissionAdvancedUsersGuard } from './guards/admin-permission-advanced-users.guard';
import { AdminPermissionReadCoinsGuard } from './guards/admin-permission-read-coins.guard';
import { AdminPermissionCreateCoinsGuard } from './guards/admin-permission-create-coins.guard';
import { AdminPermissionUpdateCoinsGuard } from './guards/admin-permission-update-coins.guard';
import { AdminPermissionReadNetworksGuard } from './guards/admin-permission-read-networks.guard';
import { AdminPermissionCreateNetworksGuard } from './guards/admin-permission-create-networks.guard';
import { AdminPermissionUpdateNetworksGuard } from './guards/admin-permission-update-networks.guard';
import { AdminSuperAdminGuard } from './guards/admin-super-admin.guard';
import { SettingsModule } from '../settings/settings.module';
import { OrderbookModule } from '../orderbook/orderbook.module';

@Module({
  imports: [
    forwardRef(() => SettingsModule),
    OrderbookModule,
    TypeOrmModule.forFeature([
      AdminRole,
      Permission,
      RolePermission,
      Admin,
      AdminLog,
      User,
      BankUser,
      WalletHistory,
      UserWallet,
      WalletTransfer,
      Coin,
      Network,
      UserWalletNetwork,
      ActiveWalletTracker,
      WalletDepositTracker,
      CoinNetwork,
      VerifyLog,
      UserVerify,
      KolRegister,
      KolArticle,
      Transaction,
    ]),
    PassportModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: {
          expiresIn: '15m', // access_token expires in 15 minutes
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    AdminsController,
    AdminsStatisticalController,
    AdminUsersController,
    AdminWalletController,
    AdminsKycController,
  ],
  providers: [
    AdminsAuthService,
    AdminsStatisticsService,
    AdminsUsersOpsService,
    AdminsWalletOpsService,
    AdminsKycService,
    AdminJwtStrategy,
    AdminJwtAuthGuard,
    AdminPermissionGuard,
    AdminPermissionReadSettingsGuard,
    AdminPermissionReadUsersGuard,
    AdminPermissionAdvancedUsersGuard,
    AdminPermissionReadCoinsGuard,
    AdminPermissionCreateCoinsGuard,
    AdminPermissionUpdateCoinsGuard,
    AdminPermissionReadNetworksGuard,
    AdminPermissionCreateNetworksGuard,
    AdminPermissionUpdateNetworksGuard,
    AdminSuperAdminGuard,
  ],
  exports: [
    AdminJwtAuthGuard,
    AdminPermissionGuard,
    AdminPermissionReadSettingsGuard,
    AdminJwtStrategy,
  ],
})
export class AdminsModule {}
