import { Injectable } from '@nestjs/common';
import { AdminSettingsConfigService } from '../settings/admin-settings-config.service';

/**
 * Rate limit chung cho mọi gọi RPC (SOL/ETH/BNB) – tránh vượt giới hạn Quicknode.
 * Giới hạn/giây: as_config_rps_rate_limit (DB) → RPC_RATE_LIMIT_PER_SECOND (.env) → 50.
 * Chỉ chờ khi đã đạt ngưỡng; 50 là giới hạn tối đa/giây, không phải mục tiêu cần đủ 50 mới chạy.
 */
@Injectable()
export class RpcRateLimitService {
  private lastRpcTimestamps: number[] = [];
  private rpcSlotQueue: Promise<void> = Promise.resolve();
  private cachedLimit: number | null = null;
  private cachedLimitAt = 0;
  private readonly CACHE_MS = 60_000; // 60s

  constructor(private adminSettingsConfigService: AdminSettingsConfigService) {}

  private async getLimit(): Promise<number> {
    const now = Date.now();
    if (this.cachedLimit != null && now - this.cachedLimitAt < this.CACHE_MS) {
      return this.cachedLimit;
    }
    this.cachedLimit =
      await this.adminSettingsConfigService.getEffectiveRpcRateLimit();
    this.cachedLimitAt = now;
    return this.cachedLimit;
  }

  async acquireRpcSlot(): Promise<void> {
    const limit = await this.getLimit();
    if (limit <= 0) return;
    const prev = this.rpcSlotQueue;
    this.rpcSlotQueue = (async () => {
      await prev;
      let now = Date.now();
      this.lastRpcTimestamps = this.lastRpcTimestamps.filter(
        (t) => now - t < 1000,
      );
      while (this.lastRpcTimestamps.length >= limit) {
        const waitMs = this.lastRpcTimestamps[0] + 1000 - now;
        await new Promise((r) => setTimeout(r, Math.max(1, waitMs)));
        now = Date.now();
        this.lastRpcTimestamps = this.lastRpcTimestamps.filter(
          (t) => now - t < 1000,
        );
      }
      this.lastRpcTimestamps.push(Date.now());
    })();
    await this.rpcSlotQueue;
  }

  /** Gọi fn sau khi đã chiếm 1 slot RPC (rate limit chung cho tất cả mạng). */
  async withRpcLimit<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireRpcSlot();
    return fn();
  }
}
