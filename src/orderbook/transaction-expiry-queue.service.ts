import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import { BullMqConnectionService } from '../infrastructure/bullmq/bullmq-connection.service';
import { TransactionStatus } from './entities/transaction.entity';

export const TRANSACTION_EXPIRY_QUEUE = 'transaction-expiry';

/** Delay before expiry job runs (30 minutes). */
export const TRANSACTION_EXPIRY_DELAY_MS = 30 * 60 * 1000;

export type TransactionExpiryJobData = {
  transactionId: number;
  expectedStatus: TransactionStatus;
};

@Injectable()
export class TransactionExpiryQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TransactionExpiryQueueService.name);
  private queue: Queue<TransactionExpiryJobData> | null = null;
  private worker: Worker<TransactionExpiryJobData> | null = null;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly bullMq: BullMqConnectionService,
  ) {}

  onModuleInit(): void {
    try {
      const redis = this.bullMq.getRedis();
      if (!redis) {
        this.logger.warn(
          'BullMQ Redis unavailable; transaction expiry queue disabled',
        );
        return;
      }

      this.queue = new Queue<TransactionExpiryJobData>(
        TRANSACTION_EXPIRY_QUEUE,
        { connection: redis },
      );

      const workerConnection = this.bullMq.duplicateForWorker();
      if (!workerConnection) {
        this.logger.warn('BullMQ worker connection unavailable');
        void this.queue.close().catch(() => {});
        this.queue = null;
        return;
      }

      this.worker = new Worker<TransactionExpiryJobData>(
        TRANSACTION_EXPIRY_QUEUE,
        async (job) => {
          const { TransactionService } = await import('./transaction.service');
          const txService = this.moduleRef.get(TransactionService, {
            strict: false,
          });
          // `pending` → fail + revert; `payment_confirmed` → auto-execute (same as confirmReceived).
          await txService.applyExpirationJob(
            job.data.transactionId,
            job.data.expectedStatus,
          );
        },
        { connection: workerConnection },
      );

      this.worker.on('failed', (job, err: Error) => {
        this.logger.error(
          `Expiry job ${job?.id ?? '?'} failed: ${err?.message ?? err}`,
        );
      });
    } catch (err) {
      this.logger.warn(
        `Transaction expiry queue init failed: ${err instanceof Error ? err.message : err}`,
      );
      this.queue = null;
      this.worker = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async scheduleExpiry(
    transactionId: number,
    expectedStatus: TransactionStatus,
  ): Promise<void> {
    if (!this.queue) {
      this.logger.warn('Expiry queue unavailable; skipped scheduling');
      return;
    }
    const jobId = `tx-expiry-${transactionId}-${expectedStatus}`;
    try {
      await this.queue.add(
        'expire',
        { transactionId, expectedStatus },
        {
          delay: TRANSACTION_EXPIRY_DELAY_MS,
          jobId,
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    } catch (err) {
      this.logger.error(
        `scheduleExpiry failed for tx ${transactionId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
