import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminSetting } from './entities/admin-setting.entity';

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
 * Cấu hình RPC / Zerion: ưu tiên từ admin_settings (as_config_*), không có hoặc không hợp lệ thì fallback sang biến môi trường .env.
 */
@Injectable()
export class AdminSettingsConfigService {
  private cachedRow: AdminSetting | null = null;
  private cachedAt = 0;
  private readonly CACHE_MS = 60_000; // 60s

  constructor(
    @InjectRepository(AdminSetting)
    private adminSettingRepository: Repository<AdminSetting>,
    private configService: ConfigService,
  ) {}

  private async getRow(): Promise<AdminSetting | null> {
    const now = Date.now();
    if (this.cachedRow != null && now - this.cachedAt < this.CACHE_MS) {
      return this.cachedRow;
    }
    // TypeORM 0.3+: findOne(options) phải có điều kiện where, nên dùng find + take(1)
    const rows = await this.adminSettingRepository.find({
      order: { as_id: 'ASC' },
      take: 1,
    });
    this.cachedRow = rows[0] ?? null;
    this.cachedAt = now;
    return this.cachedRow;
  }

  /** Zerion API key: as_config_zerion_key hoặc ZERION_API_KEY. */
  async getEffectiveZerionKey(): Promise<string | null> {
    const row = await this.getRow();
    const fromDb = validString(row?.as_config_zerion_key ?? null);
    if (fromDb != null) return fromDb;
    return validString(this.configService.get<string>('ZERION_API_KEY')) ?? null;
  }

  /** RPC SOL: as_config_rps_sol hoặc SOLANA_RPC_URL. */
  async getEffectiveRpcSol(): Promise<string | null> {
    const row = await this.getRow();
    const fromDb = validString(row?.as_config_rps_sol ?? null);
    if (fromDb != null) return fromDb;
    return validString(this.configService.get<string>('SOLANA_RPC_URL')) ?? null;
  }

  /** RPC ETH: as_config_rps_eth hoặc RPC_ETH. */
  async getEffectiveRpcEth(): Promise<string | null> {
    const row = await this.getRow();
    const fromDb = validString(row?.as_config_rps_eth ?? null);
    if (fromDb != null) return fromDb;
    return validString(this.configService.get<string>('RPC_ETH')) ?? null;
  }

  /** RPC BNB: as_config_rps_bnb hoặc RPC_BNB. */
  async getEffectiveRpcBnb(): Promise<string | null> {
    const row = await this.getRow();
    const fromDb = validString(row?.as_config_rps_bnb ?? null);
    if (fromDb != null) return fromDb;
    return validString(this.configService.get<string>('RPC_BNB')) ?? null;
  }

  /** RPC theo network symbol (SOL, ETH, BNB/BSC). */
  async getEffectiveRpcByNetwork(netSymbol: string): Promise<string | null> {
    const upper = netSymbol.toUpperCase();
    if (upper === 'SOL') return this.getEffectiveRpcSol();
    if (upper === 'ETH') return this.getEffectiveRpcEth();
    if (upper === 'BNB' || upper === 'BSC') return this.getEffectiveRpcBnb();
    return validString(this.configService.get<string>(`RPC_${netSymbol}`)) ?? null;
  }

  /**
   * Danh sách RPC URL cần thử (DB trước, rồi env nếu khác – bỏ qua nếu trùng sau khi chuẩn hóa trailing slash).
   * Khi RPC từ DB lỗi hoặc rate limit, caller có thể thử URL tiếp theo (env).
   */
  async getRpcSolUrlsToTry(): Promise<string[]> {
    const row = await this.getRow();
    const fromDb = validString(row?.as_config_rps_sol ?? null);
    const fromEnv = validString(this.configService.get<string>('SOLANA_RPC_URL') ?? null);
    if (!fromDb && !fromEnv) return [];
    if (!fromDb) return [fromEnv!];
    if (!fromEnv) return [fromDb];
    if (normalizeRpcUrl(fromDb) === normalizeRpcUrl(fromEnv)) return [fromDb];
    return [fromDb, fromEnv];
  }

  async getRpcEthUrlsToTry(): Promise<string[]> {
    const row = await this.getRow();
    const fromDb = validString(row?.as_config_rps_eth ?? null);
    const fromEnv = validString(this.configService.get<string>('RPC_ETH') ?? null);
    if (!fromDb && !fromEnv) return [];
    if (!fromDb) return [fromEnv!];
    if (!fromEnv) return [fromDb];
    if (normalizeRpcUrl(fromDb) === normalizeRpcUrl(fromEnv)) return [fromDb];
    return [fromDb, fromEnv];
  }

  async getRpcBnbUrlsToTry(): Promise<string[]> {
    const row = await this.getRow();
    const fromDb = validString(row?.as_config_rps_bnb ?? null);
    const fromEnv = validString(this.configService.get<string>('RPC_BNB') ?? null);
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
    if (upper === 'BNB' || upper === 'BSC') return this.getRpcBnbUrlsToTry();
    const env = validString(this.configService.get<string>(`RPC_${netSymbol}`));
    return env ? [env] : [];
  }

  /**
   * Số lần gọi RPC tối đa mỗi giây: as_config_rps_rate_limit (DB) hoặc RPC_RATE_LIMIT_PER_SECOND (.env).
   * Nếu DB null/không hợp lệ thì dùng env; nếu env không hợp lệ thì 50.
   */
  async getEffectiveRpcRateLimit(): Promise<number> {
    const row = await this.getRow();
    const fromDb = row?.as_config_rps_rate_limit;
    if (fromDb != null && Number.isInteger(fromDb) && fromDb > 0) {
      return fromDb;
    }
    const fromEnv = this.configService.get<string>('RPC_RATE_LIMIT_PER_SECOND');
    const n = fromEnv != null ? parseInt(String(fromEnv).trim(), 10) : NaN;
    return Number.isInteger(n) && n > 0 ? n : 50;
  }
}
