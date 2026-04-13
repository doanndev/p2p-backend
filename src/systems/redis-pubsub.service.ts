import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

type RedisClient = RedisClientType<any, any, any>;

@Injectable()
export class RedisPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisPubSubService.name);
  private pub: RedisClient | null = null;
  private sub: RedisClient | null = null;
  private ready = false;

  private attachRedisErrorHandler(
    client: RedisClient,
    role: 'pub' | 'sub',
  ): void {
    client.on('error', (err: Error) => {
      this.ready = false;
      this.logger.warn(`Redis ${role} error (${err.name}): ${err.message}`);
    });
    client.on('end', () => {
      this.ready = false;
      this.logger.debug(`Redis ${role} connection ended`);
    });
  }

  async onModuleInit() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
      const client = createClient({
        url,
        socket: {
          reconnectStrategy: (retries: number) => {
            if (retries > 20) {
              this.logger.warn(
                'Redis pub: giving up reconnect after 20 attempts',
              );
              return new Error('Redis reconnect limit');
            }
            return Math.min(retries * 200, 3000);
          },
        },
      });
      this.attachRedisErrorHandler(client, 'pub');

      const connectPromise = client.connect();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 3000),
      );
      await Promise.race([connectPromise, timeoutPromise]);

      this.pub = client;
      this.sub = client.duplicate();
      // duplicate() là client riêng — bắt buộc có listener 'error' để không crash process
      this.attachRedisErrorHandler(this.sub, 'sub');

      await Promise.race([
        this.sub.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), 3000),
        ),
      ]);

      this.ready = true;
    } catch {
      this.ready = false;
      try {
        await this.pub?.disconnect().catch(() => {});
      } catch {
        // ignore
      }
      try {
        await this.sub?.disconnect().catch(() => {});
      } catch {
        // ignore
      }
      this.pub = null;
      this.sub = null;
    }
  }

  async onModuleDestroy() {
    this.ready = false;
    try {
      await this.sub?.disconnect();
    } catch {
      // ignore
    }
    try {
      await this.pub?.disconnect();
    } catch {
      // ignore
    }
    this.sub = null;
    this.pub = null;
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    if (!this.ready || !this.pub) return;
    try {
      await this.pub.publish(channel, JSON.stringify(payload));
    } catch {
      // best-effort
    }
  }

  async subscribe(
    channel: string,
    handler: (payload: any) => Promise<void> | void,
  ): Promise<void> {
    if (!this.ready || !this.sub) return;

    await this.sub.subscribe(channel, async (message) => {
      try {
        const parsed = JSON.parse(message);
        await handler(parsed);
      } catch {
        // ignore malformed messages/handler errors (best-effort)
      }
    });
  }
}
