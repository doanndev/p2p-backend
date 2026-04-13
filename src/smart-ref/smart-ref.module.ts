import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefWithdrawHistory } from './entities/ref-withdraw-history.entity';
import { SettingRewardSmartref } from './entities/setting-reward-smartref.entity';
import { SmartRefTree } from './entities/smart-ref-tree.entity';
import { SmartRefReward } from './entities/smart-ref-reward.entity';
import { RefMember } from './entities/ref-member.entity';
import { RefMemberReward } from './entities/ref-member-reward.entity';

/** Chỉ đăng ký entity để TypeORM tạo/sync bảng; chưa có API hay nghiệp vụ. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RefWithdrawHistory,
      SettingRewardSmartref,
      SmartRefTree,
      SmartRefReward,
      RefMember,
      RefMemberReward,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class SmartRefModule {}
