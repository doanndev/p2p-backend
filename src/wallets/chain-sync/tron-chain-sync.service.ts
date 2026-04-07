import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TronWeb } from 'tronweb';
import { AdminSettingsConfigService } from '../../settings/admin-settings-config.service';
import type { ChainDepositAssetContext } from './chain-deposit-asset.context';
import type { ChainDepositSyncPort } from './chain-deposit-sync.port';
import type { OnchainTransaction } from './onchain-transaction.types';

const TRON_SYMBOLS = new Set(['TRON', 'TRX']);

const MAX_DEPOSITS_ALL = 500;
const TRONGRID_TIMEOUT_MS = 25_000;
const PAGE_LIMIT = 200;

type TronGridMeta = { fingerprint?: string; at?: boolean };

type TronGridNativeItem = {
  txID?: string;
  raw_data?: {
    timestamp?: number;
    contract?: Array<{
      type?: string;
      parameter?: {
        value?: {
          amount?: number;
          owner_address?: string;
          to_address?: string;
        };
      };
    }>;
  };
};

type TronGridNativeResponse = {
  data?: TronGridNativeItem[];
  meta?: TronGridMeta;
};

type TronGridTrc20Item = {
  transaction_id?: string;
  block_timestamp?: number;
  from?: string;
  to?: string;
  value?: string;
  token_info?: { decimals?: number; address?: string };
};

type TronGridTrc20Response = {
  data?: TronGridTrc20Item[];
  meta?: TronGridMeta;
};

@Injectable()
export class TronChainSyncService implements ChainDepositSyncPort {
  private readonly logger = new Logger(TronChainSyncService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly adminSettingsConfigService: AdminSettingsConfigService,
  ) {}

  supports(netSymbol: string): boolean {
    return TRON_SYMBOLS.has(netSymbol.trim().toUpperCase());
  }

  private tronApiHeaders(): Record<string, string> | undefined {
    const key =
      this.configService.get<string>('TRONGRID_API_KEY')?.trim() ||
      this.configService.get<string>('TRON_API_KEY')?.trim();
    return key ? { 'Tron-Pro-Api-Key': key } : undefined;
  }

  private async getFullHost(ctx: ChainDepositAssetContext): Promise<string> {
    const urls = await this.adminSettingsConfigService.getRpcUrlsToTryByNetwork(
      ctx.networkSymbol,
    );
    if (!urls.length) {
      throw new Error(
        `Tron RPC not configured: set RPC_${ctx.networkSymbol.trim().toUpperCase()} in .env (must match networks.net_symbol) or admin RPC settings`,
      );
    }
    return urls[0].replace(/\/+$/, '').trim();
  }

  private createTronWeb(fullHost: string): TronWeb {
    return new TronWeb({
      fullHost,
      headers: this.tronApiHeaders(),
    });
  }

  private normalizeUserAddress(tw: TronWeb, address: string): string {
    const a = address.trim();
    if (!a) throw new Error('Empty Tron address');
    if (tw.isAddress(a)) return a;
    if (/^41[0-9a-fA-F]{40}$/.test(a)) {
      return tw.address.fromHex(a);
    }
    throw new Error(`Invalid Tron address: ${a.slice(0, 12)}…`);
  }

  private resolveContractBase58(tw: TronWeb, mintOrContract: string): string {
    const s = mintOrContract.trim();
    if (tw.isAddress(s)) return s;
    if (/^41[0-9a-fA-F]{40}$/.test(s)) {
      return tw.address.fromHex(s);
    }
    throw new Error(
      `Invalid TRC20 contract: ${s.slice(0, 16)}… (expect base58 T… or 41-hex)`,
    );
  }

  private async tronGridGet<T>(
    fullHost: string,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const base = fullHost.replace(/\/+$/, '');
    const url = `${base}${path}`;
    const { data } = await axios.get<T>(url, {
      params,
      headers: this.tronApiHeaders(),
      timeout: TRONGRID_TIMEOUT_MS,
    });
    return data;
  }

  async getDepositBalanceOnChain(
    address: string,
    ctx: ChainDepositAssetContext,
  ): Promise<number> {
    const fullHost = await this.getFullHost(ctx);
    const tw = this.createTronWeb(fullHost);
    const addr = this.normalizeUserAddress(tw, address);

    try {
      if (ctx.mode === 'native') {
        const sun = await tw.trx.getBalance(addr);
        return Number(sun) / 1_000_000;
      }

      const contractAddr = this.resolveContractBase58(tw, ctx.mintOrContract);
      const contract = await tw.contract().at(contractAddr);
      // Some TRON RPC providers require owner_address for triggerSmartContract
      // calls, even for read-only methods. Pass `from` explicitly to avoid
      // "owner_address isn't set" runtime errors.
      const callOptions = { from: addr };
      const [rawBalance, decimals] = await Promise.all([
        contract.balanceOf(addr).call(callOptions),
        contract.decimals().call(callOptions),
      ]);
      const dec =
        typeof decimals === 'object' &&
        decimals != null &&
        'toString' in decimals
          ? Number(decimals.toString())
          : Number(decimals);
      const balStr =
        typeof rawBalance === 'object' &&
        rawBalance != null &&
        'toString' in rawBalance
          ? (rawBalance as { toString(): string }).toString()
          : String(rawBalance);
      const n = Number(balStr);
      if (!Number.isFinite(n) || dec < 0 || dec > 36) {
        this.logger.warn(
          `TRC20 balance parse odd raw=${balStr} decimals=${dec} contract=${contractAddr}`,
        );
        return 0;
      }
      return n / 10 ** dec;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `getDepositBalanceOnChain failed network=${ctx.networkSymbol} addr=${addr.slice(0, 10)}…: ${msg}`,
      );
      throw e;
    }
  }

  private parseIncomingNativeDeposits(
    tw: TronWeb,
    items: TronGridNativeItem[],
    userBase58: string,
  ): OnchainTransaction[] {
    const userHex = tw.address.toHex(userBase58).toLowerCase();
    const out: OnchainTransaction[] = [];

    for (const tx of items) {
      const txId = tx.txID;
      if (!txId || !tx.raw_data?.contract?.length) continue;

      const tsMs = tx.raw_data.timestamp ?? 0;
      for (const c of tx.raw_data.contract) {
        if (c.type !== 'TransferContract') continue;
        const v = c.parameter?.value;
        if (!v?.to_address || v.amount == null) continue;
        const toHex = String(v.to_address).toLowerCase();
        if (toHex !== userHex) continue;
        const fromHex = v.owner_address
          ? String(v.owner_address).toLowerCase()
          : '';
        const from =
          fromHex && fromHex.length >= 40
            ? tw.address.fromHex(fromHex)
            : undefined;
        const amountTrx = Number(v.amount) / 1_000_000;
        if (!Number.isFinite(amountTrx) || amountTrx <= 0) continue;

        out.push({
          hash: txId,
          amount: amountTrx,
          timestamp: new Date(tsMs),
          from,
          to: userBase58,
        });
      }
    }
    return out;
  }

  private parseIncomingTrc20Deposits(
    tw: TronWeb,
    items: TronGridTrc20Item[],
    userBase58: string,
  ): OnchainTransaction[] {
    const out: OnchainTransaction[] = [];
    for (const row of items) {
      const id = row.transaction_id;
      if (!id || !row.to || !row.value) continue;
      if (row.to !== userBase58) continue;
      const dec = row.token_info?.decimals ?? 6;
      const n = Number(row.value);
      if (!Number.isFinite(n) || n <= 0) continue;
      const amount = n / 10 ** dec;
      out.push({
        hash: id,
        amount,
        timestamp: new Date(row.block_timestamp ?? 0),
        from: row.from,
        to: userBase58,
      });
    }
    return out;
  }

  private dedupeByHash(txs: OnchainTransaction[]): OnchainTransaction[] {
    const map = new Map<string, OnchainTransaction>();
    for (const t of txs) {
      if (!map.has(t.hash)) map.set(t.hash, t);
    }
    return [...map.values()].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
  }

  private async fetchNativeDepositsPages(
    fullHost: string,
    tw: TronWeb,
    userBase58: string,
    maxTotal: number,
  ): Promise<OnchainTransaction[]> {
    const collected: OnchainTransaction[] = [];
    let fingerprint: string | undefined;

    while (collected.length < maxTotal) {
      const params: Record<string, string | number | boolean | undefined> = {
        only_confirmed: true,
        limit: PAGE_LIMIT,
      };
      if (fingerprint) params.fingerprint = fingerprint;

      const json = await this.tronGridGet<TronGridNativeResponse>(
        fullHost,
        `/v1/accounts/${encodeURIComponent(userBase58)}/transactions`,
        params,
      );

      const batch = json.data ?? [];
      if (batch.length === 0) break;

      collected.push(
        ...this.parseIncomingNativeDeposits(tw, batch, userBase58),
      );
      fingerprint = json.meta?.fingerprint;
      if (!fingerprint) break;
    }

    return this.dedupeByHash(collected).slice(-maxTotal);
  }

  private async fetchTrc20DepositsPages(
    fullHost: string,
    tw: TronWeb,
    userBase58: string,
    contractBase58: string,
    maxTotal: number,
  ): Promise<OnchainTransaction[]> {
    const collected: OnchainTransaction[] = [];
    let fingerprint: string | undefined;

    while (collected.length < maxTotal) {
      const params: Record<string, string | number | boolean | undefined> = {
        only_confirmed: true,
        limit: PAGE_LIMIT,
        contract_address: contractBase58,
      };
      if (fingerprint) params.fingerprint = fingerprint;

      const json = await this.tronGridGet<TronGridTrc20Response>(
        fullHost,
        `/v1/accounts/${encodeURIComponent(userBase58)}/transactions/trc20`,
        params,
      );

      const batch = json.data ?? [];
      if (batch.length === 0) break;

      collected.push(...this.parseIncomingTrc20Deposits(tw, batch, userBase58));
      fingerprint = json.meta?.fingerprint;
      if (!fingerprint) break;
    }

    return this.dedupeByHash(collected).slice(-maxTotal);
  }

  async fetchAllDeposits(
    address: string,
    ctx: ChainDepositAssetContext,
  ): Promise<OnchainTransaction[]> {
    try {
      const fullHost = await this.getFullHost(ctx);
      const tw = this.createTronWeb(fullHost);
      const userBase58 = this.normalizeUserAddress(tw, address);

      if (ctx.mode === 'native') {
        return await this.fetchNativeDepositsPages(
          fullHost,
          tw,
          userBase58,
          MAX_DEPOSITS_ALL,
        );
      }

      const contractBase58 = this.resolveContractBase58(tw, ctx.mintOrContract);
      return await this.fetchTrc20DepositsPages(
        fullHost,
        tw,
        userBase58,
        contractBase58,
        MAX_DEPOSITS_ALL,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`fetchAllDeposits TRON: ${msg}`);
      return [];
    }
  }

  async fetchRecentDeposits(
    address: string,
    ctx: ChainDepositAssetContext,
    recentBlockOrSlotCount: number,
  ): Promise<OnchainTransaction[]> {
    try {
      const fullHost = await this.getFullHost(ctx);
      const tw = this.createTronWeb(fullHost);
      const userBase58 = this.normalizeUserAddress(tw, address);

      const limit = Math.min(
        PAGE_LIMIT,
        Math.max(20, Math.min(recentBlockOrSlotCount * 3, 200)),
      );

      if (ctx.mode === 'native') {
        const json = await this.tronGridGet<TronGridNativeResponse>(
          fullHost,
          `/v1/accounts/${encodeURIComponent(userBase58)}/transactions`,
          { only_confirmed: true, limit },
        );
        const txs = this.parseIncomingNativeDeposits(
          tw,
          json.data ?? [],
          userBase58,
        );
        return this.dedupeByHash(txs);
      }

      const contractBase58 = this.resolveContractBase58(tw, ctx.mintOrContract);
      const json = await this.tronGridGet<TronGridTrc20Response>(
        fullHost,
        `/v1/accounts/${encodeURIComponent(userBase58)}/transactions/trc20`,
        {
          only_confirmed: true,
          limit,
          contract_address: contractBase58,
        },
      );
      const txs = this.parseIncomingTrc20Deposits(
        tw,
        json.data ?? [],
        userBase58,
      );
      return this.dedupeByHash(txs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`fetchRecentDeposits TRON: ${msg}`);
      return [];
    }
  }
}
