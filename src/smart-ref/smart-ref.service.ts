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
import { CacheService } from '../systems/cache.service';
import { Transaction, TransactionStatus } from '../orderbook/entities/transaction.entity';

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
  private readonly adminRefStatsCacheKey = 'smart-ref:admin:stats:v1';
  private readonly adminRefStatsCacheTtlSec = 30 * 60;

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
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly walletsService: WalletsService,
    private readonly cacheService: CacheService,
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

  async getAdminReferralStatistics(): Promise<{
    total_ref_paid_usd: number;
    total_invited_users: number;
    total_referral_transaction_value_usd: number;
  }> {
    const cached = await this.cacheService.get(this.adminRefStatsCacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as {
          total_ref_paid_usd: number;
          total_invited_users: number;
          total_referral_transaction_value_usd: number;
        };
      } catch {
        // ignore malformed cache and refresh
      }
    }

    const [paidRaw, invitedRaw] = await Promise.all([
      this.refWithdrawHistoryRepository
        .createQueryBuilder('w')
        .select('COALESCE(SUM(w.rwh_amount_usd), 0)', 'total')
        .getRawOne<{ total: string | null }>(),
      this.smartRefTreeRepository
        .createQueryBuilder('t')
        .select('COUNT(DISTINCT t.srt_invitee)', 'total')
        .getRawOne<{ total: string | null }>(),
    ]);

    const inviteeRows = await this.smartRefTreeRepository
      .createQueryBuilder('t')
      .select('DISTINCT t.srt_invitee', 'inviteeId')
      .getRawMany<{ inviteeId: string }>();
    const inviteeIds = inviteeRows
      .map((r) => Number(r.inviteeId))
      .filter((n) => Number.isInteger(n) && n > 0);

    let txValueUsd = 0;
    if (inviteeIds.length > 0) {
      const txRaw = await this.transactionRepository
        .createQueryBuilder('tx')
        .select('COALESCE(SUM(tx.trans_total_usd), 0)', 'total')
        .where('tx.trans_status = :st', { st: TransactionStatus.EXECUTED })
        .andWhere(
          '(tx.trans_user_buy IN (:...inviteeIds) OR tx.trans_user_sell IN (:...inviteeIds))',
          { inviteeIds },
        )
        .getRawOne<{ total: string | null }>();
      txValueUsd = Number(txRaw?.total ?? 0);
    }

    const payload = {
      total_ref_paid_usd: Number(paidRaw?.total ?? 0),
      total_invited_users: Number(invitedRaw?.total ?? 0),
      total_referral_transaction_value_usd: txValueUsd,
    };

    await this.cacheService.set(
      this.adminRefStatsCacheKey,
      JSON.stringify(payload),
      this.adminRefStatsCacheTtlSec,
    );

    return payload;
  }

  async getAdminReferralsWithInvitees() {
    const levelOneRows = await this.smartRefTreeRepository.find({
      where: { srt_level: 1 },
      order: { srt_referral: 'ASC', srt_invitee: 'ASC' },
    });

    if (levelOneRows.length === 0) {
      return [];
    }

    const referralIds = [...new Set(levelOneRows.map((r) => r.srt_referral))];
    const allTreeRows = await this.smartRefTreeRepository.find({
      where: { srt_referral: In(referralIds) },
      order: { srt_referral: 'ASC', srt_level: 'ASC', srt_invitee: 'ASC' },
    });

    const userIds = new Set<number>();
    for (const row of allTreeRows) {
      userIds.add(row.srt_referral);
      userIds.add(row.srt_invitee);
    }
    const users = await this.userRepository.find({
      select: ['uid', 'uname', 'uemail', 'ufulllname', 'uavatar', 'created_at'],
      where: { uid: In([...userIds]) },
    });
    const userById = new Map(users.map((u) => [u.uid, u]));

    const referralMap = new Map<
      number,
      {
        referral: {
          uid: number;
          uname: string;
          uemail: string;
          ufulllname: string;
          uavatar: string | null;
          created_at: Date;
        } | null;
        f1_count: number;
        total_invitees: number;
        invitees_by_level: Array<{
          level: number;
          count: number;
          invitees: Array<{
            uid: number;
            uname: string;
            uemail: string;
            ufulllname: string;
            uavatar: string | null;
            created_at: Date;
          }>;
        }>;
      }
    >();

    for (const referralId of referralIds) {
      const rows = allTreeRows.filter((r) => r.srt_referral === referralId);
      const levelMap = new Map<number, number[]>();
      for (const row of rows) {
        const arr = levelMap.get(row.srt_level) ?? [];
        arr.push(row.srt_invitee);
        levelMap.set(row.srt_level, arr);
      }

      const inviteesByLevel = [...levelMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([level, ids]) => ({
          level,
          count: ids.length,
          invitees: ids
            .map((uid) => userById.get(uid))
            .filter((u): u is User => Boolean(u))
            .map((u) => ({
              uid: u.uid,
              uname: u.uname,
              uemail: u.uemail,
              ufulllname: u.ufulllname,
              uavatar: u.uavatar,
              created_at: u.created_at,
            })),
        }));

      const referralUser = userById.get(referralId) ?? null;
      referralMap.set(referralId, {
        referral: referralUser
          ? {
              uid: referralUser.uid,
              uname: referralUser.uname,
              uemail: referralUser.uemail,
              ufulllname: referralUser.ufulllname,
              uavatar: referralUser.uavatar,
              created_at: referralUser.created_at,
            }
          : null,
        f1_count: levelMap.get(1)?.length ?? 0,
        total_invitees: rows.length,
        invitees_by_level: inviteesByLevel,
      });
    }

    return [...referralMap.values()].sort((a, b) => b.f1_count - a.f1_count);
  }

  async getAdminDownlineTree(userId: number, maxDepth = 5) {
    const root = await this.userRepository.findOne({
      select: ['uid', 'uname', 'uemail', 'ufulllname', 'uavatar', 'created_at'],
      where: { uid: userId },
    });
    if (!root) {
      throw new BadRequestException('User not found');
    }

    const cappedDepth = Math.min(Math.max(maxDepth, 1), 10);

    const levelOneRows = await this.smartRefTreeRepository.find({
      where: { srt_level: 1 },
      order: { srt_referral: 'ASC', srt_invitee: 'ASC' },
    });

    const childrenMap = new Map<number, number[]>();
    for (const row of levelOneRows) {
      const arr = childrenMap.get(row.srt_referral) ?? [];
      arr.push(row.srt_invitee);
      childrenMap.set(row.srt_referral, arr);
    }

    const allUserIds = new Set<number>([userId]);
    const queue: Array<{ id: number; depth: number }> = [{ id: userId, depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= cappedDepth) continue;
      const children = childrenMap.get(current.id) ?? [];
      for (const childId of children) {
        allUserIds.add(childId);
        queue.push({ id: childId, depth: current.depth + 1 });
      }
    }

    const users = await this.userRepository.find({
      select: ['uid', 'uname', 'uemail', 'ufulllname', 'uavatar', 'created_at'],
      where: { uid: In([...allUserIds]) },
    });
    const userById = new Map(users.map((u) => [u.uid, u]));

    const buildNode = (id: number, depth: number): any => {
      const u = userById.get(id);
      const childrenIds = depth >= cappedDepth ? [] : childrenMap.get(id) ?? [];
      return {
        user: u
          ? {
              uid: u.uid,
              uname: u.uname,
              uemail: u.uemail,
              ufulllname: u.ufulllname,
              uavatar: u.uavatar,
              created_at: u.created_at,
            }
          : { uid: id },
        depth,
        children: childrenIds.map((childId) => buildNode(childId, depth + 1)),
      };
    };

    return buildNode(userId, 0);
  }
}
