import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

type RedisClient = RedisClientType<any, any, any>;

@Injectable()
export class RedisPubSubService implements OnModuleInit, OnModuleDestroy {
  private pub: RedisClient | null = null;
  private sub: RedisClient | null = null;
  private ready = false;

  async onModuleInit() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
      const client = createClient({ url });
      client.on('error', () => {
        this.ready = false;
      });

      const connectPromise = client.connect();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 3000),
      );
      await Promise.race([connectPromise, timeoutPromise]);

      this.pub = client;
      this.sub = client.duplicate();
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

