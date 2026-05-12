import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import {
  Transaction,
  TransactionStatus,
} from '../orderbook/entities/transaction.entity';

const P2P_LEVELUP_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
const MAX_WINDOW_ROLLS_PER_RUN = 500;

type LevelProgressRule = {
  thresholdUsd: number;
  autoApprove: boolean;
};

@Injectable()
export class UserLevelUpWorker {
  private readonly logger = new Logger(UserLevelUpWorker.name);

  constructor(private readonly dataSource: DataSource) {}

  getRuleByCurrentLevel(level: number): LevelProgressRule | null {
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

  /**
   * Daily cron: evaluate one user for closed 10-day windows since
   * {@link User.levelup_window_started_at} (or {@link User.verify_at}) and qualifying EXECUTED volume.
   */
  async evaluateLevelUpForUser(userId: number): Promise<void> {
    if (!Number.isFinite(userId) || userId <= 0) return;

    await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { uid: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || !user.uverify) return;

      if (user.need_levelup) {
        return;
      }

      const rule = this.getRuleByCurrentLevel(user.ulevel);
      if (!rule) return;

      if (!user.verify_at) {
        return;
      }

      let windowStart =
        user.levelup_window_started_at != null
          ? new Date(user.levelup_window_started_at)
          : new Date(user.verify_at);

      const nowMs = Date.now();
      let rolls = 0;

      while (windowStart.getTime() + P2P_LEVELUP_WINDOW_MS <= nowMs) {
        if (++rolls > MAX_WINDOW_ROLLS_PER_RUN) {
          this.logger.warn(
            `level-up window roll cap hit uid=${userId}, windowStart=${windowStart.toISOString()}`,
          );
          break;
        }

        const windowEnd = new Date(
          windowStart.getTime() + P2P_LEVELUP_WINDOW_MS,
        );

        const qualifiedCount = await manager
          .createQueryBuilder(Transaction, 't')
          .where(
            '(t.trans_user_buy = :userId OR t.trans_user_sell = :userId)',
            {
              userId,
            },
          )
          .andWhere('t.trans_status = :status', {
            status: TransactionStatus.EXECUTED,
          })
          .andWhere('t.trans_total_usd >= :threshold', {
            threshold: rule.thresholdUsd,
          })
          .andWhere('t.trans_created_at >= :ws', { ws: windowStart })
          .andWhere('t.trans_created_at < :we', { we: windowEnd })
          .getCount();

        if (qualifiedCount >= 1) {
          if (rule.autoApprove) {
            const updateResult = await manager
              .createQueryBuilder()
              .update(User)
              .set({
                ulevel: () => '"ulevel" + 1',
                need_levelup: false,
                current_cycle_active_days: 0,
                levelup_window_started_at: new Date(),
              })
              .where('"uid" = :uid', { uid: userId })
              .andWhere('"ulevel" = :lvl', { lvl: user.ulevel })
              .execute();

            if (!updateResult.affected) {
              return;
            }
            return;
          }

          await manager
            .createQueryBuilder()
            .update(User)
            .set({
              need_levelup: true,
              levelup_window_started_at: windowEnd,
            })
            .where('"uid" = :uid', { uid: userId })
            .andWhere('"ulevel" = :lvl', { lvl: user.ulevel })
            .execute();
          return;
        }

        windowStart = windowEnd;
        await manager
          .createQueryBuilder()
          .update(User)
          .set({ levelup_window_started_at: windowStart })
          .where('"uid" = :uid', { uid: userId })
          .execute();
      }
    });
  }
}
