import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AdminSetting,
  AdminSettingStatus,
  FundType,
} from './entities/admin-setting.entity';

/** Giá trị từ DB được coi là hợp lệ nếu không rỗng sau khi trim. */
function validString(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/** Chuẩn hóa URL để so sánh (bỏ slash ở cuối). */
function normalizeRpcUrl(url: string): string {
  return url.replace(/\/+$/, '').trim();
}

/**
 * Cấu hình RPC / Zerion: ưu tiên từ admin_settings (setting_name), không có hoặc không hợp lệ thì fallback sang biến môi trường .env.
 */
@Injectable()
export class AdminSettingsConfigService {
  private cachedMap: Map<string, AdminSetting> | null = null;
  private cachedAt = 0;
  private readonly CACHE_MS = 60_000; // 60s
  private readonly DEFAULT_LOCK_HOURS_BY_LEVEL: Record<string, number> = {
    lv1: 24,
    lv2: 12,
    lv3: 4,
    lv4: 3,
    lv5: 2,
    lv6: 1,
  };

  constructor(
    @InjectRepository(AdminSetting)
    private adminSettingRepository: Repository<AdminSetting>,
    private configService: ConfigService,
  ) {}

  private async getMap(): Promise<Map<string, AdminSetting>> {
    const now = Date.now();
    if (this.cachedMap != null && now - this.cachedAt < this.CACHE_MS) {
      return this.cachedMap;
    }
    const rows = await this.adminSettingRepository.find({
      where: { status: AdminSettingStatus.ACTIVE },
    });
    this.cachedMap = new Map(rows.map((r) => [r.setting_name, r]));
    this.cachedAt = now;
    return this.cachedMap;
  }

  private async getSettingRaw(name: string): Promise<string | null> {
    const map = await this.getMap();
    const row = map.get(name);
    return validString(row?.setting_value ?? null);
  }

  private async getSettingNumber(name: string): Promise<number | null> {
    const raw = await this.getSettingRaw(name);
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  private toLockHoursMap(raw: string | null): Record<string, number> {
    if (!raw) return { ...this.DEFAULT_LOCK_HOURS_BY_LEVEL };
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ...this.DEFAULT_LOCK_HOURS_BY_LEVEL };
      }

      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const key = String(k).toLowerCase().trim();
        if (!/^lv\d+$/.test(key)) continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) continue;
        next[key] = Math.floor(n);
      }

      if (Object.keys(next).length === 0) {
        return { ...this.DEFAULT_LOCK_HOURS_BY_LEVEL };
      }

      return {
        ...this.DEFAULT_LOCK_HOURS_BY_LEVEL,
        ...next,
      };
    } catch {
      return { ...this.DEFAULT_LOCK_HOURS_BY_LEVEL };
    }
  }

  /** Zerion API key: config.zerion_key hoặc ZERION_API_KEY. */
  async getEffectiveZerionKey(): Promise<string | null> {
    const fromDb = await this.getSettingRaw('config.zerion_key');
    if (fromDb != null) return fromDb;
    return (
      validString(this.configService.get<string>('ZERION_API_KEY')) ?? null
    );
  }

  /** RPC SOL: config.rpc.sol hoặc SOLANA_RPC_URL. */
  async getEffectiveRpcSol(): Promise<string | null> {
    const fromDb = await this.getSettingRaw('config.rpc.sol');
    if (fromDb != null) return fromDb;
    return (
      validString(this.configService.get<string>('SOLANA_RPC_URL')) ?? null
    );
  }

  /** RPC ETH: config.rpc.eth hoặc RPC_ETH. */
  async getEffectiveRpcEth(): Promise<string | null> {
    const fromDb = await this.getSettingRaw('config.rpc.eth');
    if (fromDb != null) return fromDb;
    return validString(this.configService.get<string>('RPC_ETH')) ?? null;
  }

  /** RPC BSC (Binance Smart Chain): config.rpc.bsc hoặc RPC_BNB. */
  async getEffectiveRpcBsc(): Promise<string | null> {
    const fromDb = await this.getSettingRaw('config.rpc.bsc');
    if (fromDb != null) return fromDb;
    return validString(this.configService.get<string>('RPC_BNB')) ?? null;
  }

  /** RPC theo network symbol (SOL, ETH, BSC). */
  async getEffectiveRpcByNetwork(netSymbol: string): Promise<string | null> {
    const upper = netSymbol.toUpperCase();
    if (upper === 'SOL') return this.getEffectiveRpcSol();
    if (upper === 'ETH') return this.getEffectiveRpcEth();
    if (upper === 'BSC') return this.getEffectiveRpcBsc();
    return (
      validString(this.configService.get<string>(`RPC_${netSymbol}`)) ?? null
    );
  }

  /**
   * Danh sách RPC URL cần thử (DB trước, rồi env nếu khác – bỏ qua nếu trùng sau khi chuẩn hóa trailing slash).
   * Khi RPC từ DB lỗi hoặc rate limit, caller có thể thử URL tiếp theo (env).
   */
  async getRpcSolUrlsToTry(): Promise<string[]> {
    const fromDb = await this.getSettingRaw('config.rpc.sol');
    const fromEnv = validString(
      this.configService.get<string>('SOLANA_RPC_URL') ?? null,
    );
    if (!fromDb && !fromEnv) return [];
    if (!fromDb) return [fromEnv!];
    if (!fromEnv) return [fromDb];
    if (normalizeRpcUrl(fromDb) === normalizeRpcUrl(fromEnv)) return [fromDb];
    return [fromDb, fromEnv];
  }

  async getRpcEthUrlsToTry(): Promise<string[]> {
    const fromDb = await this.getSettingRaw('config.rpc.eth');
    const fromEnv = validString(
      this.configService.get<string>('RPC_ETH') ?? null,
    );
    if (!fromDb && !fromEnv) return [];
    if (!fromDb) return [fromEnv!];
    if (!fromEnv) return [fromDb];
    if (normalizeRpcUrl(fromDb) === normalizeRpcUrl(fromEnv)) return [fromDb];
    return [fromDb, fromEnv];
  }

  async getRpcBscUrlsToTry(): Promise<string[]> {
    const fromDb = await this.getSettingRaw('config.rpc.bsc');
    const fromEnv = validString(
      this.configService.get<string>('RPC_BNB') ?? null,
    );
    if (!fromDb && !fromEnv) return [];
    if (!fromDb) return [fromEnv!];
    if (!fromEnv) return [fromDb];
    if (normalizeRpcUrl(fromDb) === normalizeRpcUrl(fromEnv)) return [fromDb];
    return [fromDb, fromEnv];
  }

  /** Danh sách RPC URL cần thử theo network (DB rồi env nếu khác). */
  async getRpcUrlsToTryByNetwork(netSymbol: string): Promise<string[]> {
    const upper = netSymbol.toUpperCase();
    if (upper === 'SOL') return this.getRpcSolUrlsToTry();
    if (upper === 'ETH') return this.getRpcEthUrlsToTry();
    if (upper === 'BSC') return this.getRpcBscUrlsToTry();
    const env = validString(this.configService.get<string>(`RPC_${netSymbol}`));
    return env ? [env] : [];
  }

  /**
   * Số lần gọi RPC tối đa mỗi giây: config.rpc.rate_limit (DB) hoặc RPC_RATE_LIMIT_PER_SECOND (.env).
   * Nếu DB null/không hợp lệ thì dùng env; nếu env không hợp lệ thì 50.
   */
  async getEffectiveRpcRateLimit(): Promise<number> {
    const fromDb = await this.getSettingNumber('config.rpc.rate_limit');
    if (fromDb != null && Number.isInteger(fromDb) && fromDb > 0) {
      return fromDb;
    }
    const fromEnv = this.configService.get<string>('RPC_RATE_LIMIT_PER_SECOND');
    const n = fromEnv != null ? parseInt(String(fromEnv).trim(), 10) : NaN;
    return Number.isInteger(n) && n > 0 ? n : 50;
  }

  async getEffectiveTurnWithdrawFree(): Promise<number> {
    const fromDb = await this.getSettingNumber('withdraw.turn_free');
    if (fromDb != null && Number.isInteger(fromDb) && fromDb > 0) {
      return fromDb;
    }
    return 0;
  }

  async getFundSettings(): Promise<{
    fundType: FundType | null;
    fundAmount: number;
  }> {
    const rawType = await this.getSettingRaw('withdraw.fund_type');
    const fundType =
      rawType === FundType.GAIN_LOSS || rawType === FundType.ALWAYS_PROFITABLE
        ? rawType
        : null;
    const fundAmount =
      (await this.getSettingNumber('withdraw.fund_amount')) ?? 0;
    return { fundType, fundAmount };
  }

  /**
   * Phí giao dịch P2P (orderbook), đơn vị %: `transaction.fee` (ví dụ 2 = 2%).
   * Không cấu hình hoặc không hợp lệ → 2.
   */
  async getEffectiveTransactionFeePercent(): Promise<number> {
    const fromDb = await this.getSettingNumber('transaction.fee');
    if (fromDb == null || !Number.isFinite(fromDb) || fromDb <= 0) {
      return 2;
    }
    return Math.min(fromDb, 100);
  }

  /** Lock giờ theo level cho P2P: `transaction.lock_hours_by_level`. */
  async getP2pLockHoursByLevel(): Promise<Record<string, number>> {
    const raw = await this.getSettingRaw('transaction.lock_hours_by_level');
    return this.toLockHoursMap(raw);
  }
}
