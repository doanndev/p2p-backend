import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import {
  Transaction,
  TransactionStatus,
} from '../orderbook/entities/transaction.entity';

type LevelProgressRule = {
  thresholdUsd: number;
  autoApprove: boolean;
};

@Injectable()
export class UserLevelUpWorker {
  constructor(private readonly dataSource: DataSource) {}

  async handleTransactionSuccess(userId: number): Promise<void> {
    if (!Number.isFinite(userId) || userId <= 0) return;
    await this.applyLevelUpLogic(userId);
  }

  private getRuleByCurrentLevel(level: number): LevelProgressRule | null {
    if (level === 1) {
      return { thresholdUsd: 100, autoApprove: true };
    }
    if (level === 2) {
      return { thresholdUsd: 1000, autoApprove: true };
    }
    if (level === 3) {
      return { thresholdUsd: 1000, autoApprove: false };
    }
    if (level === 4) {
      return { thresholdUsd: 1000, autoApprove: false };
    }
    return null;
  }

  private async applyLevelUpLogic(userId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { uid: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) return;

      // When need_levelup=true, user is waiting for admin review and cannot auto-progress.
      if (user.need_levelup) return;

      const rule = this.getRuleByCurrentLevel(user.ulevel);
      if (!rule) return;

      // 1) Increment active day only once per date.
      await manager
        .createQueryBuilder()
        .update(User)
        .set({
          current_cycle_active_days: () => '"current_cycle_active_days" + 1',
          last_actived_day: () => 'CURRENT_DATE',
        })
        .where('"uid" = :uid', { uid: userId })
        .andWhere(
          '("last_actived_day" IS NULL OR "last_actived_day" < CURRENT_DATE)',
        )
        .execute();

      const refreshedUser = await manager.findOne(User, {
        where: { uid: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!refreshedUser) return;

      if (refreshedUser.current_cycle_active_days < 10) return;

      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const qualifiedCount = await manager
        .createQueryBuilder(Transaction, 't')
        .where('(t.trans_user_buy = :userId OR t.trans_user_sell = :userId)', {
          userId,
        })
        .andWhere('t.trans_status = :status', {
          status: TransactionStatus.EXECUTED,
        })
        .andWhere('t.trans_total_usd >= :threshold', {
          threshold: rule.thresholdUsd,
        })
        .andWhere('t.trans_created_at >= :tenDaysAgo', { tenDaysAgo })
        .getCount();
      if (qualifiedCount < 1) return;

      if (rule.autoApprove) {
        await manager
          .createQueryBuilder()
          .update(User)
          .set({
            ulevel: () => '"ulevel" + 1',
            current_cycle_active_days: 0,
            need_levelup: false,
          })
          .where('"uid" = :uid', { uid: userId })
          .execute();
        return;
      }

      await manager
        .createQueryBuilder()
        .update(User)
        .set({
          need_levelup: true,
        })
        .where('"uid" = :uid', { uid: userId })
        .execute();
    });
  }
}
