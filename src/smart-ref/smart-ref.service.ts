import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  RefWithdrawHistory,
  RefWithdrawHistoryStatus,
} from './entities/ref-withdraw-history.entity';
import { SmartRefTree } from './entities/smart-ref-tree.entity';
import { SettingRewardSmartref } from './entities/setting-reward-smartref.entity';
import { SmartRefReward } from './entities/smart-ref-reward.entity';
import { WalletsService } from '../wallets/wallets.service';

type SmartRefLevelSettingResponse = {
  level: number;
  percentage: number;
};

type SmartRefInviteeResponse = {
  uid: number;
  uname: string;
  uemail: string;
  uphone: string | null;
  uavatar: string | null;
  uref: string;
  ufulllname: string;
  ulevel: number;
  created_at: Date;
};

type SmartRefInviteeLevelResponse = {
  level: number;
  total_invitees: number;
  invitees: SmartRefInviteeResponse[];
};

@Injectable()
export class SmartRefService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(SmartRefTree)
    private readonly smartRefTreeRepository: Repository<SmartRefTree>,
    @InjectRepository(SettingRewardSmartref)
    private readonly settingRewardSmartrefRepository: Repository<SettingRewardSmartref>,
    @InjectRepository(SmartRefReward)
    private readonly smartRefRewardRepository: Repository<SmartRefReward>,
    @InjectRepository(RefWithdrawHistory)
    private readonly refWithdrawHistoryRepository: Repository<RefWithdrawHistory>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly walletsService: WalletsService,
  ) {}

  /** Số cấp tối đa theo cấu hình active trong setting_rewards_smartref (MAX srs_level). */
  private async getConfiguredMaxLevel(): Promise<number> {
    const raw = await this.settingRewardSmartrefRepository
      .createQueryBuilder('s')
      .select('COALESCE(MAX(s.srs_level), 0)', 'max')
      .where('s.srs_is_active = :active', { active: true })
      .getRawOne<{ max: string | null }>();
    const n = Number(raw?.max ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  async getAllLevelSettings(): Promise<SmartRefLevelSettingResponse[]> {
    const settings = await this.settingRewardSmartrefRepository.find({
      where: { srs_is_active: true },
      order: { srs_level: 'ASC' },
    });

    return settings.map((setting) => ({
      level: setting.srs_level,
      percentage: Number(setting.srs_percentage),
    }));
  }

  async getMyInviteesByLevel(
    userId: number,
  ): Promise<SmartRefInviteeLevelResponse[]> {
    const trees = await this.smartRefTreeRepository.find({
      where: { srt_referral: userId },
      order: { srt_level: 'ASC', srt_invitee: 'ASC' },
    });

    if (!trees.length) {
      return [];
    }

    const inviteeIds = [...new Set(trees.map((tree) => tree.srt_invitee))];
    const invitees = await this.userRepository.find({
      select: [
        'uid',
        'uname',
        'uemail',
        'uphone',
        'uavatar',
        'uref',
        'ufulllname',
        'ulevel',
        'created_at',
      ],
      where: { uid: In(inviteeIds) },
      order: { uid: 'ASC' },
    });

    const inviteeMap = new Map<number, SmartRefInviteeResponse>(
      invitees.map((invitee) => [invitee.uid, invitee]),
    );

    const grouped = new Map<number, SmartRefInviteeResponse[]>();
    for (const tree of trees) {
      const invitee = inviteeMap.get(tree.srt_invitee);
      if (!invitee) {
        continue;
      }

      const current = grouped.get(tree.srt_level) ?? [];
      current.push(invitee);
      grouped.set(tree.srt_level, current);
    }

    return [...grouped.entries()].map(([level, items]) => ({
      level,
      total_invitees: items.length,
      invitees: items,
    }));
  }

  async getMyRewardAmount(userId: number): Promise<number> {
    const raw = await this.smartRefRewardRepository
      .createQueryBuilder('reward')
      .innerJoin('reward.tree', 'tree')
      .select('COALESCE(SUM(reward.srr_usdt_reward), 0)', 'total')
      .where('tree.srt_referral = :userId', { userId })
      .andWhere('reward.srr_withdraw_status = false')
      .getRawOne<{ total: string | null }>();

    return Number(raw?.total ?? 0);
  }

  async withdrawMyReward(
    userId: number,
    networkId: number,
    address: string,
  ): Promise<{
    amount: number;
    withdraw_history_id: number;
    tx_hash: string;
    status: RefWithdrawHistoryStatus;
  }> {
    const normalizedAddress = address.trim();
    if (!normalizedAddress) {
      throw new BadRequestException('Withdrawal address is required');
    }

    const eligibleRewards = await this.smartRefRewardRepository
      .createQueryBuilder('reward')
      .innerJoinAndSelect('reward.tree', 'tree')
      .where('tree.srt_referral = :userId', { userId })
      .andWhere('reward.srr_withdraw_status = false')
      .orderBy('reward.srr_id', 'ASC')
      .getMany();

    const rewardIds = eligibleRewards.map((reward) => reward.srr_id);
    const amount = eligibleRewards.reduce(
      (sum, reward) => sum + Number(reward.srr_usdt_reward),
      0,
    );

    if (rewardIds.length === 0 || amount <= 0) {
      throw new BadRequestException(
        'No available smart ref reward to withdraw',
      );
    }

    let withdrawHistoryId: number | null = null;

    await this.dataSource.transaction(async (manager) => {
      const withdrawHistory = manager.create(RefWithdrawHistory, {
        rwh_user_id: userId,
        rwh_amount: amount.toString(),
        rwh_amount_usd: amount.toString(),
        rwh_status: RefWithdrawHistoryStatus.CAN_WITHDRAW,
      });

      const savedHistory = await manager.save(
        RefWithdrawHistory,
        withdrawHistory,
      );
      withdrawHistoryId = savedHistory.rwh_id;

      await manager.update(
        SmartRefReward,
        { srr_id: In(rewardIds) },
        {
          srr_withdraw_status: true,
          srr_withdraw_id: savedHistory.rwh_id,
        },
      );
    });

    try {
      const { txHash } = await this.walletsService.transferRewardFromMainWallet(
        networkId,
        normalizedAddress,
        amount,
      );

      if (!withdrawHistoryId) {
        throw new BadRequestException('Withdraw history was not created');
      }

      await this.refWithdrawHistoryRepository.update(withdrawHistoryId, {
        rwh_status: RefWithdrawHistoryStatus.WITHDRAWN,
      });

      return {
        amount,
        withdraw_history_id: withdrawHistoryId,
        tx_hash: txHash,
        status: RefWithdrawHistoryStatus.WITHDRAWN,
      };
    } catch (error) {
      if (withdrawHistoryId) {
        await this.dataSource.transaction(async (manager) => {
          await manager.update(
            SmartRefReward,
            { srr_id: In(rewardIds) },
            {
              srr_withdraw_status: false,
              srr_withdraw_id: null,
            },
          );
          await manager.delete(RefWithdrawHistory, {
            rwh_id: withdrawHistoryId as number,
          });
        });
      }

      throw error;
    }
  }

  /**
   * Ghi tuyến SmartRef cho invitee: cấp 1 là người giới thiệu trực tiếp (theo uref);
   * các cấp 2–7 là cấp 1 của người đứng ngay cấp trên trong cây (bảng smart_ref_trees).
   * Thiếu bản ghi ở cấp trên thì dừng, không ghi các cấp sâu hơn.
   */
  async recordInviteeReferralChain(
    inviteeUid: number,
    directReferrerUid: number,
  ): Promise<void> {
    const maxLevel = await this.getConfiguredMaxLevel();
    if (maxLevel < 1) {
      return;
    }

    let referralId: number | null = directReferrerUid;

    for (let level = 1; level <= maxLevel; level++) {
      if (referralId == null) {
        return;
      }

      await this.smartRefTreeRepository.save(
        this.smartRefTreeRepository.create({
          srt_invitee: inviteeUid,
          srt_referral: referralId,
          srt_level: level,
        }),
      );

      const parentOfReferral = await this.smartRefTreeRepository.findOne({
        where: { srt_invitee: referralId, srt_level: 1 },
      });

      referralId = parentOfReferral?.srt_referral ?? null;
    }
  }

  async disputeSmartref(
    inviteeUid: number,
    rewardAmount: number,
  ): Promise<void> {
    const maxLevel = await this.getConfiguredMaxLevel();
    if (maxLevel < 1) {
      return;
    }

    // Chạy vòng for qua từng cấp từ 1 đến maxLevel
    for (let level = 1; level <= maxLevel; level++) {
      // Lấy setting percentage cho cấp này
      const setting = await this.settingRewardSmartrefRepository.findOne({
        where: { srs_level: level, srs_is_active: true },
      });

      if (!setting) {
        // Nếu không có setting active cho cấp này thì skip
        continue;
      }

      // Lấy SmartRefTree cho invitee ở cấp này
      const refTree = await this.smartRefTreeRepository.findOne({
        where: { srt_invitee: inviteeUid, srt_level: level },
      });

      if (!refTree) {
        // Nếu không có referral ở cấp này thì skip
        continue;
      }

      // Tính amount cho cấp này: rewardAmount * srs_percentage / 100
      const levelAmount = (rewardAmount * Number(setting.srs_percentage)) / 100;

      // Luôn tạo mới bảng reward với status withdraw là false
      await this.smartRefRewardRepository.save(
        this.smartRefRewardRepository.create({
          srr_tree_id: refTree.srt_id,
          srr_usdt_reward: levelAmount.toString(),
          srr_usd_value: levelAmount.toString(),
          srr_withdraw_status: false,
        }),
      );
    }
  }
}
