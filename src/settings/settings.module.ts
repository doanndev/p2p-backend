import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AdminSettingsConfigService } from './admin-settings-config.service';
import { Network } from './entities/network.entity';
import { Coin } from './entities/coin.entity';
import { CoinNetwork } from './entities/coin-network.entity';
import { AdminSetting } from './entities/admin-setting.entity';
import { AdminSettingTurn } from './entities/admin-setting-turn.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      Network,
      Coin,
      CoinNetwork,
      AdminSetting,
      AdminSettingTurn,
    ]),
  ],
  controllers: [SettingsController],
  providers: [SettingsService, AdminSettingsConfigService],
  exports: [SettingsService, AdminSettingsConfigService],
})
export class SettingsModule {}

