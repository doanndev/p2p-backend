import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Shared ioredis connection for BullMQ (queues / workers).
 * Import `BullMqModule` once (e.g. in `AppModule`); `BullMqConnectionService` is then injectable everywhere.
 *
 * Redis is created in the **constructor** so `getRedis()` is non-null before any other provider's
 * `onModuleInit` runs. Otherwise `TransactionExpiryQueueService` could run first, see `null`, and
 * disable the expiry queue for the whole process lifetime.
 */
@Injectable()
export class BullMqConnectionService implements OnApplicationShutdown {
  private readonly logger = new Logger(BullMqConnectionService.name);
  private client: Redis | null = null;

  constructor() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: null,
      });
      this.client.on('error', (err: Error) => {
        this.logger.warn(`BullMQ Redis: ${err.message}`);
      });
    } catch (err) {
      this.logger.warn(
        `BullMQ Redis init failed: ${err instanceof Error ? err.message : err}`,
      );
      this.client = null;
    }
  }

  /** True when Redis client was created (may still disconnect at runtime). */
  isAvailable(): boolean {
    return this.client != null;
  }

  /**
   * Primary connection — use for {@link Queue} producers.
   */
  getRedis(): Redis | null {
    return this.client;
  }

  /**
   * Separate connection for {@link Worker} (BullMQ recommendation).
   * Caller must not call `quit` on this; closing the Worker closes it.
   */
  duplicateForWorker(): Redis | null {
    if (!this.client) return null;
    const dup = this.client.duplicate({
      maxRetriesPerRequest: null,
    });
    dup.on('error', (err: Error) => {
      this.logger.warn(`BullMQ Redis worker connection: ${err.message}`);
    });
    return dup;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => {});
      this.client = null;
    }
  }
}
