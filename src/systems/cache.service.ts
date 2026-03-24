import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

interface CacheEntry {
  value: string;
  expiresAt?: number; // timestamp in milliseconds
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private useRedis: boolean = false;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private redisConnectionFailed: boolean = false;

  async onModuleInit() {
    // Initialize memory cache cleanup interval first
    setInterval(() => this.cleanExpiredEntries(), 60000);

    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      });

      this.client.on('error', () => {
        // Silently handle error, don't log to avoid spam
        this.useRedis = false;
        this.redisConnectionFailed = true;
      });

      // Set timeout để tránh hang quá lâu
      const connectPromise = this.client.connect();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 3000),
      );

      await Promise.race([connectPromise, timeoutPromise]);
      this.useRedis = true;
      this.redisConnectionFailed = false;
      console.log('Redis connected successfully');
    } catch {
      // Disconnect client nếu đã được tạo để ngăn error events tiếp theo
      if (this.client) {
        try {
          // Safely disconnect client
          await this.client.disconnect().catch(() => {});
        } catch {
          // Ignore disconnect errors
        }
      }
      console.log('Redis not available, using in-memory cache');
      this.useRedis = false;
      this.redisConnectionFailed = true;
    }
  }

  async onModuleDestroy() {
    if (this.client && this.useRedis) {
      try {
        await this.client.disconnect();
      } catch (error) {
        console.error('Error disconnecting Redis:', error);
      }
    }
  }

  private cleanExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.memoryCache.delete(key);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.useRedis && !this.redisConnectionFailed) {
      try {
        return await this.client.get(key);
      } catch {
        // Silently fallback to memory cache on error
        this.useRedis = false;
        this.redisConnectionFailed = true;
      }
    }

    // Use in-memory cache
    const entry = this.memoryCache.get(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(
    key: string,
    value: string,
    expirationInSeconds?: number,
  ): Promise<void> {
    if (this.useRedis && !this.redisConnectionFailed) {
      try {
        if (expirationInSeconds) {
          await this.client.setEx(key, expirationInSeconds, value);
        } else {
          await this.client.set(key, value);
        }
        return;
      } catch {
        // Silently fallback to memory cache on error
        this.useRedis = false;
        this.redisConnectionFailed = true;
      }
    }

    // Use in-memory cache
    const entry: CacheEntry = {
      value,
      expiresAt: expirationInSeconds
        ? Date.now() + expirationInSeconds * 1000
        : undefined,
    };
    this.memoryCache.set(key, entry);
  }

  async del(key: string): Promise<void> {
    if (this.useRedis && !this.redisConnectionFailed) {
      try {
        await this.client.del(key);
        return;
      } catch {
        // Silently fallback to memory cache on error
        this.useRedis = false;
        this.redisConnectionFailed = true;
      }
    }

    // Use in-memory cache
    this.memoryCache.delete(key);
  }
}
