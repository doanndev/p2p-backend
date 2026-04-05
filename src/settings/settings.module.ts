import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AdminSettingsConfigService } from './admin-settings-config.service';
import { Network } from './entities/network.entity';
import { Coin } from './entities/coin.entity';
import { CoinNetwork } from './entities/coin-network.entity';
import { AdminSetting } from './entities/admin-setting.entity';
import { AdminSettingTurn } from './entities/admin-setting-turn.entity';
import { AdminLog } from '../admins/entities/admin-log.entity';
import { AdminsModule } from '../admins/admins.module';
import { Admin } from '../admins/entities/admin.entity';
import { Permission } from '../admins/entities/permission.entity';
import { RolePermission } from '../admins/entities/role-permission.entity';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    TypeOrmModule.forFeature([
      Network,
      Coin,
      CoinNetwork,
      AdminSetting,
      AdminSettingTurn,
      AdminLog,
      // Guards trên SettingsController resolve repository trong SettingsModule
      Admin,
      Permission,
      RolePermission,
    ]),
    forwardRef(() => AdminsModule),
  ],
  controllers: [SettingsController],
  providers: [SettingsService, AdminSettingsConfigService],
  exports: [SettingsService, AdminSettingsConfigService],
})
export class SettingsModule {}
