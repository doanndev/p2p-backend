import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { WalletsSchedulerService } from './wallets-scheduler.service';
import { WalletsFileStorageService } from './wallets-file-storage.service';
import { UserWalletNetwork } from './entities/user-wallet-network.entity';
import { UserWallet } from './entities/user-wallet.entity';
import { WalletHistory } from './entities/wallet-history.entity';
import { ActiveWalletTracker } from './entities/active-wallet-tracker.entity';
import { WalletTransfer } from './entities/wallet-transfer.entity';
import { WalletDepositTracker } from './entities/wallet-deposit-tracker.entity';
import { User } from '../users/entities/user.entity';
import { Coin } from '../settings/entities/coin.entity';
import { Network } from '../settings/entities/network.entity';
import { CoinNetwork } from '../settings/entities/coin-network.entity';
import { AdminSetting } from '../settings/entities/admin-setting.entity';
import { SystemsModule } from '../systems/systems.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    SettingsModule,
    TypeOrmModule.forFeature([
      UserWalletNetwork,
      UserWallet,
      WalletHistory,
      ActiveWalletTracker,
      WalletTransfer,
      WalletDepositTracker,
      User,
      Coin,
      Network,
      CoinNetwork,
      AdminSetting,
    ]),
    SystemsModule,
  ],
  controllers: [WalletsController],
  providers: [
    WalletsService,
    WalletsSchedulerService,
    WalletsFileStorageService,
  ],
  exports: [WalletsService, WalletsSchedulerService],
})
export class WalletsModule {}

