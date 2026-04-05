import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  Contract,
  formatEther,
  getAddress,
  Interface,
  Log,
  zeroPadValue,
} from 'ethers';
import { AdminSettingsConfigService } from '../../settings/admin-settings-config.service';
import { RpcRateLimitService } from '../../common/rpc-rate-limit.service';
import { createEvmJsonRpcProvider } from '../../common/evm-json-rpc-provider.factory';
import type { ChainDepositAssetContext } from './chain-deposit-asset.context';
import type { ChainDepositSyncPort } from './chain-deposit-sync.port';
import type { OnchainTransaction } from './onchain-transaction.types';

const EVM_SYMBOLS = new Set(['ETH', 'BNB', 'BSC', 'ARB']);

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const TRANSFER_IFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const TRANSFER_TOPIC = TRANSFER_IFACE.getEvent('Transfer')!.topicHash;

const MAX_EXPLORER_TXS = 500;
const MAX_LOG_CHUNK_BLOCKS = 2000;
const EXPLORER_TIMEOUT_MS = 25_000;
const MAX_BLOCKS_NATIVE_SCAN_FALLBACK = 4000;

/** Etherscan API V2 — ETH / BNB / ARB: cùng base URL + apikey, khác chainid. */
type ExplorerConfig = {
  baseUrl: string;
  apiKey: string;
  chainId: number;
};

@Injectable()
export class EvmChainSyncService implements ChainDepositSyncPort {
  private readonly logger = new Logger(EvmChainSyncService.name);

  constructor(
    private readonly adminSettingsConfigService: AdminSettingsConfigService,
    private readonly rpcRateLimitService: RpcRateLimitService,
    private readonly configService: ConfigService,
  ) {}

  supports(netSymbol: string): boolean {
    return EVM_SYMBOLS.has(netSymbol.trim().toUpperCase());
  }

  private netUpper(ctx: ChainDepositAssetContext): string {
    return ctx.networkSymbol.trim().toUpperCase();
  }

  private parsePositiveChainEnv(envKey: string, defaultValue: number): number {
    const raw = this.configService.get<string>(envKey);
    const parsed = raw != null ? parseInt(String(raw).trim(), 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }

  /** Một API key Etherscan V2 cho mọi chain được hỗ trợ. */
  private getEtherscanV2Config(chainId: number): ExplorerConfig | null {
    const baseUrl =
      this.configService.get<string>('ETHERSCAN_API_URL')?.trim() ||
      'https://api.etherscan.io/v2/api';
    const apiKey =
      this.configService.get<string>('ETHERSCAN_API_KEY')?.trim() || '';
    return apiKey ? { baseUrl, apiKey, chainId } : null;
  }

  private getExplorerConfig(netSymbol: string): ExplorerConfig | null {
    const u = netSymbol.trim().toUpperCase();
    if (u === 'ETH') {
      const chainId = this.parsePositiveChainEnv('ETHERSCAN_CHAIN_ID', 1);
      return this.getEtherscanV2Config(chainId);
    }
    if (u === 'BNB' || u === 'BSC') {
      const chainId = this.parsePositiveChainEnv('BNB_CHAIN_ID', 56);
      return this.getEtherscanV2Config(chainId);
    }
    if (u === 'ARB') {
      const chainId = this.parsePositiveChainEnv('ARB_CHAIN_ID', 42161);
      return this.getEtherscanV2Config(chainId);
    }
    return null;
  }

  private async explorerGet(
    cfg: ExplorerConfig,
    params: Record<string, string>,
  ): Promise<unknown> {
    const url = cfg.baseUrl.replace(/\/+$/, '');
    const merged: Record<string, string> = {
      ...params,
      apikey: cfg.apiKey,
      chainid: String(cfg.chainId),
    };
    const search = new URLSearchParams(merged);
    const full = `${url}?${search.toString()}`;
    const res = await axios.get(full, { timeout: EXPLORER_TIMEOUT_MS });
    return res.data;
  }

  private normalizeAddr(a: string): string {
    try {
      return getAddress(a.trim()).toLowerCase();
    } catch {
      return a.trim().toLowerCase();
    }
  }

  private topicAddress(addr: string): string {
    return zeroPadValue(getAddress(addr.trim()), 32);
  }

  async getDepositBalanceOnChain(
    address: string,
    ctx: ChainDepositAssetContext,
  ): Promise<number> {
    const net = this.netUpper(ctx);
    const urls =
      await this.adminSettingsConfigService.getRpcUrlsToTryByNetwork(net);
    if (!urls.length) {
      this.logger.warn(`[evm-balance] No RPC configured for ${net}`);
      return 0;
    }

    const addr = address.trim();
    for (const rpcUrl of urls) {
      try {
        const provider = createEvmJsonRpcProvider(rpcUrl);
        if (ctx.mode === 'native') {
          const wei = await this.rpcRateLimitService.withRpcLimit(() =>
            provider.getBalance(addr),
          );
          const s = typeof wei === 'bigint' ? wei.toString() : String(wei);
          return parseFloat(formatEther(s));
        }
        const contractAddr = getAddress(ctx.mintOrContract.trim());
        const token = new Contract(contractAddr, ERC20_ABI, provider);
        const decimalsRaw = await this.rpcRateLimitService.withRpcLimit(() =>
          token.decimals(),
        );
        const decimals =
          typeof decimalsRaw === 'bigint'
            ? Number(decimalsRaw)
            : Number(decimalsRaw);
        const bal = await this.rpcRateLimitService.withRpcLimit(() =>
          token.balanceOf(addr),
        );
        const balNum =
          typeof bal === 'bigint' ? Number(bal) : parseFloat(String(bal));
        return balNum / 10 ** decimals;
      } catch (e: any) {
        this.logger.debug(
          `[evm-balance] RPC fail net=${net} url=${rpcUrl}: ${e?.message || e}`,
        );
      }
    }
    return 0;
  }

  async fetchAllDeposits(
    address: string,
    ctx: ChainDepositAssetContext,
  ): Promise<OnchainTransaction[]> {
    const net = this.netUpper(ctx);
    if (ctx.mode === 'native') {
      const explorer = this.getExplorerConfig(net);
      if (explorer) {
        const list = await this.fetchNativeTxsFromExplorer(
          explorer,
          address,
          MAX_EXPLORER_TXS,
        );
        if (list.length > 0) return list;
      }
      return this.scanNativeBlocks(
        address,
        ctx,
        MAX_BLOCKS_NATIVE_SCAN_FALLBACK,
      );
    }
    const explorer = this.getExplorerConfig(net);
    if (explorer) {
      const list = await this.fetchTokenTxsFromExplorer(
        explorer,
        address,
        ctx.mintOrContract,
        MAX_EXPLORER_TXS,
      );
      if (list.length > 0) return list;
    }
    return this.fetchTokenDepositsViaLogs(address, ctx, null, MAX_EXPLORER_TXS);
  }

  async fetchRecentDeposits(
    address: string,
    ctx: ChainDepositAssetContext,
    recentBlockOrSlotCount: number,
  ): Promise<OnchainTransaction[]> {
    const net = this.netUpper(ctx);
    const blockWindow = Math.min(
      2000,
      Math.max(1, recentBlockOrSlotCount || 100),
    );

    if (ctx.mode === 'native') {
      const explorer = this.getExplorerConfig(net);
      if (explorer) {
        const list = await this.fetchNativeTxsFromExplorer(
          explorer,
          address,
          Math.min(100, blockWindow),
        );
        if (list.length > 0) return list;
      }
      return this.scanNativeBlocks(address, ctx, blockWindow);
    }

    const logsFirst = await this.fetchTokenDepositsViaLogs(
      address,
      ctx,
      blockWindow,
      200,
    );
    if (logsFirst.length > 0) return logsFirst;

    const explorer = this.getExplorerConfig(net);
    if (explorer) {
      return this.fetchTokenTxsFromExplorer(
        explorer,
        address,
        ctx.mintOrContract,
        Math.min(100, blockWindow),
      );
    }
    return [];
  }

  private async fetchNativeTxsFromExplorer(
    cfg: ExplorerConfig,
    address: string,
    maxTxs: number,
  ): Promise<OnchainTransaction[]> {
    const want = this.normalizeAddr(address);
    const out: OnchainTransaction[] = [];
    const pageSize = 100;
    try {
      for (let page = 1; out.length < maxTxs; page++) {
        const data = (await this.explorerGet(cfg, {
          module: 'account',
          action: 'txlist',
          address: getAddress(address.trim()),
          startblock: '0',
          endblock: '99999999',
          page: String(page),
          offset: String(Math.min(pageSize, maxTxs - out.length)),
          sort: 'desc',
        })) as { status?: string; message?: string; result?: unknown };

        if (data.status !== '1' || !Array.isArray(data.result)) {
          if (
            page === 1 &&
            data.message &&
            data.message !== 'No transactions found'
          ) {
            const hint =
              typeof data.result === 'string' ? data.result : data.message;
            this.logger.warn(`[evm-explorer] txlist ${cfg.baseUrl}: ${hint}`);
          }
          break;
        }
        const rows = data.result as Array<{
          hash?: string;
          from?: string;
          to?: string;
          value?: string;
          timeStamp?: string;
        }>;
        if (rows.length === 0) break;

        for (const row of rows) {
          if (out.length >= maxTxs) break;
          const to = row.to ? this.normalizeAddr(row.to) : '';
          const val = BigInt(row.value || '0');
          if (to !== want || val <= 0n || !row.hash) continue;
          out.push({
            hash: row.hash,
            amount: parseFloat(formatEther(row.value || '0')),
            timestamp: new Date(parseInt(row.timeStamp || '0', 10) * 1000),
            from: row.from,
            to: getAddress(address.trim()),
          });
        }
        if (rows.length < pageSize) break;
      }
    } catch (e: any) {
      this.logger.warn(
        `[evm-explorer] native txlist error: ${e?.message || e}`,
      );
    }
    return out;
  }

  private async fetchTokenTxsFromExplorer(
    cfg: ExplorerConfig,
    address: string,
    contract: string,
    maxTxs: number,
  ): Promise<OnchainTransaction[]> {
    const want = this.normalizeAddr(address);
    const out: OnchainTransaction[] = [];
    const pageSize = 100;
    const contractNorm = getAddress(contract.trim());
    try {
      for (let page = 1; out.length < maxTxs; page++) {
        const data = (await this.explorerGet(cfg, {
          module: 'account',
          action: 'tokentx',
          contractaddress: contractNorm,
          address: getAddress(address.trim()),
          page: String(page),
          offset: String(Math.min(pageSize, maxTxs - out.length)),
          sort: 'desc',
        })) as { status?: string; message?: string; result?: unknown };

        if (data.status !== '1' || !Array.isArray(data.result)) {
          if (
            page === 1 &&
            data.message &&
            data.message !== 'No transactions found'
          ) {
            const hint =
              typeof data.result === 'string' ? data.result : data.message;
            this.logger.warn(`[evm-explorer] tokentx ${cfg.baseUrl}: ${hint}`);
          }
          break;
        }
        const rows = data.result as Array<{
          hash?: string;
          from?: string;
          to?: string;
          value?: string;
          tokenDecimal?: string;
          timeStamp?: string;
        }>;
        if (rows.length === 0) break;

        for (const row of rows) {
          if (out.length >= maxTxs) break;
          const to = row.to ? this.normalizeAddr(row.to) : '';
          if (to !== want || !row.hash) continue;
          const dec = parseInt(row.tokenDecimal || '18', 10) || 18;
          const raw = BigInt(row.value || '0');
          if (raw <= 0n) continue;
          const amount = Number(raw) / 10 ** dec;
          out.push({
            hash: row.hash,
            amount,
            timestamp: new Date(parseInt(row.timeStamp || '0', 10) * 1000),
            from: row.from,
            to: getAddress(address.trim()),
          });
        }
        if (rows.length < pageSize) break;
      }
    } catch (e: any) {
      this.logger.warn(`[evm-explorer] tokentx error: ${e?.message || e}`);
    }
    return out;
  }

  private async scanNativeBlocks(
    address: string,
    ctx: ChainDepositAssetContext,
    maxBlocks: number,
  ): Promise<OnchainTransaction[]> {
    const net = this.netUpper(ctx);
    const urls =
      await this.adminSettingsConfigService.getRpcUrlsToTryByNetwork(net);
    if (!urls.length) return [];

    const want = this.normalizeAddr(address);
    const out: OnchainTransaction[] = [];

    for (const rpcUrl of urls) {
      try {
        const provider = createEvmJsonRpcProvider(rpcUrl);
        const head = await this.rpcRateLimitService.withRpcLimit(() =>
          provider.getBlockNumber(),
        );
        const fromB = Math.max(0, head - maxBlocks + 1);
        for (let b = head; b >= fromB && out.length < MAX_EXPLORER_TXS; b--) {
          const block = await this.rpcRateLimitService.withRpcLimit(() =>
            provider.getBlock(b, true),
          );
          if (!block || !block.prefetchedTransactions) continue;
          for (const tx of block.prefetchedTransactions) {
            if (!tx.to) continue;
            if (this.normalizeAddr(tx.to) !== want) continue;
            const v = tx.value ?? 0n;
            if (v <= 0n) continue;
            out.push({
              hash: tx.hash,
              amount: parseFloat(formatEther(v)),
              timestamp: new Date(Number(block.timestamp) * 1000),
              from: tx.from || undefined,
              to: getAddress(address.trim()),
            });
          }
        }
        return out;
      } catch (e: any) {
        this.logger.debug(
          `[evm-native-scan] fail net=${net}: ${e?.message || e}`,
        );
      }
    }
    return [];
  }

  private async fetchTokenDepositsViaLogs(
    address: string,
    ctx: ChainDepositAssetContext,
    blockWindow: number | null,
    maxTxs: number,
  ): Promise<OnchainTransaction[]> {
    if (ctx.mode !== 'fungible') {
      return [];
    }
    const net = this.netUpper(ctx);
    const urls =
      await this.adminSettingsConfigService.getRpcUrlsToTryByNetwork(net);
    if (!urls.length) return [];

    const contract = getAddress(ctx.mintOrContract.trim());
    const recipientTopic = this.topicAddress(address);
    const out: OnchainTransaction[] = [];

    for (const rpcUrl of urls) {
      try {
        const provider = createEvmJsonRpcProvider(rpcUrl);
        const head = await this.rpcRateLimitService.withRpcLimit(() =>
          provider.getBlockNumber(),
        );
        const token = new Contract(contract, ERC20_ABI, provider);
        const decimalsRaw = await this.rpcRateLimitService.withRpcLimit(() =>
          token.decimals(),
        );
        const decimals =
          typeof decimalsRaw === 'bigint'
            ? Number(decimalsRaw)
            : Number(decimalsRaw);

        let fromBlock: number;
        const toBlock = head;
        if (blockWindow != null) {
          fromBlock = Math.max(0, head - blockWindow + 1);
        } else {
          fromBlock = Math.max(0, head - 500_000);
        }

        const blockTsCache = new Map<number, Date>();

        for (
          let start = fromBlock;
          start <= toBlock && out.length < maxTxs;
          start += MAX_LOG_CHUNK_BLOCKS
        ) {
          const end = Math.min(start + MAX_LOG_CHUNK_BLOCKS - 1, toBlock);
          const filter = {
            address: contract,
            topics: [TRANSFER_TOPIC, null, recipientTopic] as (string | null)[],
            fromBlock: start,
            toBlock: end,
          };

          let logs: Log[];
          try {
            logs = await this.rpcRateLimitService.withRpcLimit(() =>
              provider.getLogs(filter),
            );
          } catch (e: any) {
            this.logger.debug(
              `[evm-logs] getLogs ${start}-${end}: ${e?.message || e}`,
            );
            continue;
          }

          for (const log of logs) {
            if (out.length >= maxTxs) break;
            try {
              const parsed = TRANSFER_IFACE.parseLog({
                topics: log.topics as string[],
                data: log.data,
              });
              if (!parsed) continue;
              const value = parsed.args.value as bigint;
              if (value <= 0n) continue;
              const bn = Number(log.blockNumber);
              let ts: Date;
              if (blockTsCache.has(bn)) {
                ts = blockTsCache.get(bn)!;
              } else {
                const block = await this.rpcRateLimitService.withRpcLimit(() =>
                  provider.getBlock(bn),
                );
                ts = new Date(Number(block!.timestamp) * 1000);
                blockTsCache.set(bn, ts);
              }
              out.push({
                hash: log.transactionHash,
                amount: Number(value) / 10 ** decimals,
                timestamp: ts,
                from: String(parsed.args.from),
                to: getAddress(address.trim()),
              });
            } catch {
              /* skip malformed log */
            }
          }
        }
        return out;
      } catch (e: any) {
        this.logger.debug(`[evm-logs] RPC fail net=${net}: ${e?.message || e}`);
      }
    }
    return out;
  }
}
