import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transaction, TransactionStatus } from './entities/transaction.entity';
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import {
  Notification,
  NotificationType,
} from '../users/entities/notification.entity';

const UNLOCK_BATCH_SIZE = 100;

@Injectable()
export class P2pCoinUnlockSchedulerService {
  private readonly logger = new Logger(P2pCoinUnlockSchedulerService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  private async notifyBuyerUnlockFailure(
    buyerId: number,
    transId: number,
  ): Promise<void> {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await this.notificationRepository
        .createQueryBuilder('n')
        .where('n.notif_user_id = :uid', { uid: buyerId })
        .andWhere("n.notif_data->>'transaction_id' = :tid", {
          tid: String(transId),
        })
        .andWhere('n.notif_created_at > :since', { since })
        .getCount();
      if (recent > 0) {
        return;
      }

      const row = this.notificationRepository.create({
        notif_user_id: buyerId,
        notif_type: NotificationType.SYSTEM,
        notif_title: 'Transaction settlement issue',
        notif_message:
          'An error occurred while releasing coins for your completed trade. Please contact support for assistance.',
        notif_data: { transaction_id: transId },
        notif_is_read: false,
      });
      await this.notificationRepository.save(row);
    } catch (err) {
      this.logger.error(
        `Failed to persist unlock-failure notification user=${buyerId} trans=${transId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async releaseDueBuyerLocks(): Promise<void> {
    const now = new Date();
    const due = await this.dataSource
      .getRepository(Transaction)
      .createQueryBuilder('t')
      .where('t.trans_status = :st', { st: TransactionStatus.EXECUTED })
      .andWhere('t.trans_coin_unlock_at IS NOT NULL')
      .andWhere('t.trans_coin_unlock_at <= :now', { now })
      .andWhere('t.trans_lock_released_at IS NULL')
      .orderBy('t.trans_id', 'ASC')
      .take(UNLOCK_BATCH_SIZE)
      .getMany();

    for (const row of due) {
      try {
        await this.dataSource.transaction(async (manager) => {
          const tx = await manager.findOne(Transaction, {
            where: { trans_id: row.trans_id },
            lock: { mode: 'pessimistic_write' },
          });
          if (
            !tx ||
            tx.trans_lock_released_at != null ||
            tx.trans_status !== TransactionStatus.EXECUTED ||
            !tx.trans_coin_unlock_at ||
            tx.trans_coin_unlock_at > new Date()
          ) {
            return;
          }

          const amount = Number(tx.trans_amount);
          const buyerWallet = await manager.findOne(UserWallet, {
            where: {
              uw_user_id: tx.trans_user_buy,
              uw_wallet_coins: tx.trans_coin,
            },
            lock: { mode: 'pessimistic_write' },
          });
          if (!buyerWallet) {
            throw new Error('Buyer wallet not found');
          }

          const lockBal = Number(buyerWallet.uw_lock_balance);
          if (lockBal < amount) {
            throw new Error(
              `Insufficient buyer lock_balance: need ${amount}, have ${lockBal}`,
            );
          }

          buyerWallet.uw_lock_balance = lockBal - amount;
          buyerWallet.uw_balance = Number(buyerWallet.uw_balance) + amount;

          await manager.save(UserWallet, buyerWallet);
          tx.trans_lock_released_at = new Date();
          await manager.save(Transaction, tx);
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const stack = e instanceof Error ? e.stack : undefined;
        this.logger.error(
          `P2P coin unlock failed trans_id=${row.trans_id} buyer=${row.trans_user_buy}: ${msg}`,
          stack,
        );
        await this.notifyBuyerUnlockFailure(row.trans_user_buy, row.trans_id);
      }
    }
  }
}
