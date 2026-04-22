import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletsModule } from '../wallets/wallets.module';
import { Admin } from '../admins/entities/admin.entity';
import { RolePermission } from '../admins/entities/role-permission.entity';
import { AdminPermissionReadReferralGuard } from '../admins/guards/admin-permission-read-referral.guard';
import { Transaction } from '../orderbook/entities/transaction.entity';
import { User } from '../users/entities/user.entity';
import { RefWithdrawHistory } from './entities/ref-withdraw-history.entity';
import { SettingRewardSmartref } from './entities/setting-reward-smartref.entity';
import { SmartRefTree } from './entities/smart-ref-tree.entity';
import { SmartRefReward } from './entities/smart-ref-reward.entity';
import { RefMember } from './entities/ref-member.entity';
import { RefMemberReward } from './entities/ref-member-reward.entity';
import { SmartRefController } from './smart-ref.controller';
import { SmartRefService } from './smart-ref.service';

@Module({
  imports: [
    WalletsModule,
    TypeOrmModule.forFeature([
      User,
      RefWithdrawHistory,
      SettingRewardSmartref,
      SmartRefTree,
      SmartRefReward,
      RefMember,
      RefMemberReward,
      Transaction,
      Admin,
      RolePermission,
    ]),
  ],
  controllers: [SmartRefController],
  providers: [SmartRefService, AdminPermissionReadReferralGuard],
  exports: [TypeOrmModule, SmartRefService],
})
export class SmartRefModule {}
