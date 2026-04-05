import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import axios from 'axios';
import { AdminSettingsConfigService } from '../../settings/admin-settings-config.service';
import type { ChainDepositAssetContext } from './chain-deposit-asset.context';
import type { ChainDepositSyncPort } from './chain-deposit-sync.port';
import type { OnchainTransaction } from './onchain-transaction.types';

@Injectable()
export class SolChainSyncService implements ChainDepositSyncPort {
  private readonly logger = new Logger(SolChainSyncService.name);

  static normalizeRpcUrl(url: string): string {
    return url.replace(/\/+$/, '').trim();
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly adminSettingsConfigService: AdminSettingsConfigService,
  ) {}

  private debugShortAddr(addr: string, head = 8, tail = 6): string {
    const s = (addr || '').trim();
    if (!s) return '(empty)';
    if (s.length <= head + tail + 3) return s;
    return `${s.slice(0, head)}...${s.slice(-tail)}`;
  }

  private debugRpcHost(rpcUrl: string): string {
    try {
      return new URL(rpcUrl).hostname;
    } catch {
      return '(bad-url)';
    }
  }

  supports(netSymbol: string): boolean {
    return netSymbol.trim().toUpperCase() === 'SOL';
  }

  async isSolanaConfiguredClusterNonMainnet(): Promise<boolean> {
    const urls = await this.adminSettingsConfigService.getRpcSolUrlsToTry();
    if (!urls.length) return false;
    const u = urls[0].toLowerCase();
    return (
      u.includes('devnet') ||
      u.includes('testnet') ||
      u.includes('localhost') ||
      u.includes('127.0.0.1')
    );
  }

  private async retrySolanaRpcCall<T>(
    fn: () => Promise<T>,
    operation: string,
    maxRetries: number = 5,
    baseDelay: number = 3000,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const isNetworkError =
          error?.message?.includes('fetch failed') ||
          error?.message?.includes('ECONNREFUSED') ||
          error?.message?.includes('ETIMEDOUT') ||
          error?.message?.includes('ENOTFOUND') ||
          error?.code === 'ECONNREFUSED' ||
          error?.code === 'ETIMEDOUT';

        if (isNetworkError && attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (attempt === maxRetries - 1 || !isNetworkError) {
          throw error;
        }
      }
    }

    throw lastError || new Error(`Unknown error in retry for ${operation}`);
  }

  private async getSolanaTransactions(
    address: string,
    limit: number = 100,
    usdtMintAddress?: string,
  ): Promise<OnchainTransaction[]> {
    const primaryUrls =
      await this.adminSettingsConfigService.getRpcSolUrlsToTry();
    if (!primaryUrls.length) {
      throw new Error('SOLANA_RPC_URL not configured (admin_settings or .env)');
    }

    if (!usdtMintAddress) {
      this.logger.warn(
        'USDT mint address not provided, skipping Solana transactions',
      );
      return [];
    }

    const fallbackRpcUrls = [
      'https://api.mainnet-beta.solana.com',
      'https://solana-api.projectserum.com',
    ];
    const primarySet = new Set(
      primaryUrls.map(SolChainSyncService.normalizeRpcUrl),
    );
    const extraFallbacks = fallbackRpcUrls.filter(
      (f) => !primarySet.has(SolChainSyncService.normalizeRpcUrl(f)),
    );
    const rpcUrls = [...primaryUrls, ...extraFallbacks];

    for (let rpcIndex = 0; rpcIndex < rpcUrls.length; rpcIndex++) {
      const rpcUrl = rpcUrls[rpcIndex];
      const isPrimary = rpcIndex === 0;

      try {
        // Tạo Connection với timeout configuration
        const connection = new Connection(rpcUrl, {
          commitment: 'confirmed',
          httpHeaders: {
            'Content-Type': 'application/json',
          },
          fetch: async (url, options) => {
            // Thêm timeout cho fetch requests
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

            try {
              const response = await fetch(url, {
                ...options,
                signal: controller.signal,
              });
              clearTimeout(timeoutId);
              return response;
            } catch (error: any) {
              clearTimeout(timeoutId);
              if (error.name === 'AbortError') {
                throw new Error('Request timeout after 30s');
              }
              throw error;
            }
          },
        });
        const publicKey = new PublicKey(address);
        const usdtMint = new PublicKey(usdtMintAddress);

        // Lấy associated token address của USDT cho address này
        const tokenAccountAddress = await getAssociatedTokenAddress(
          usdtMint,
          publicKey,
        );

        // Lấy signature history của token account (chỉ USDT transfers) với retry
        let signatures: any[] = [];
        try {
          signatures = await this.retrySolanaRpcCall(
            () =>
              connection.getSignaturesForAddress(tokenAccountAddress, {
                limit: limit,
              }),
            `getSignaturesForAddress(tokenAccount: ${tokenAccountAddress.toBase58()}) [${isPrimary ? 'primary' : 'fallback'} RPC]`,
            3, // Giảm retry cho mỗi RPC endpoint (sẽ thử nhiều endpoints)
            2000, // Base delay
          );
        } catch {
          // Fallback: Thử lấy từ wallet address
          try {
            signatures = await this.retrySolanaRpcCall(
              () =>
                connection.getSignaturesForAddress(publicKey, {
                  limit: limit * 2,
                }),
              `getSignaturesForAddress(wallet: ${address}) [${isPrimary ? 'primary' : 'fallback'} RPC]`,
              3,
              2000,
            );
          } catch (fallbackError: any) {
            // Nếu đây là primary RPC và còn fallback RPCs, thử tiếp
            if (isPrimary && rpcIndex < rpcUrls.length - 1) {
              continue; // Thử RPC endpoint tiếp theo
            }
            // Nếu đã thử hết tất cả RPCs, throw error
            this.logger.error(
              `Error getting signatures from wallet address ${address} after trying all RPC endpoints: ${fallbackError.message}`,
            );
            throw fallbackError;
          }
        }

        // Nếu đã lấy được signatures, xử lý transactions
        const transactions: OnchainTransaction[] = [];

        // Process signatures với delay để tránh rate limit
        for (let i = 0; i < signatures.length; i++) {
          const signatureInfo = signatures[i];

          // Thêm delay giữa các requests (trừ request đầu tiên)
          if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 500)); // Tăng delay lên 500ms
          }

          try {
            const tx = await this.retrySolanaRpcCall(
              () =>
                connection.getTransaction(signatureInfo.signature, {
                  commitment: 'confirmed',
                  maxSupportedTransactionVersion: 0,
                }),
              `getTransaction(${signatureInfo.signature})`,
              3, // Tăng số lần retry
              2000, // Tăng base delay
            );

            if (!tx || !tx.meta) continue;

            // Kiểm tra preTokenBalances và postTokenBalances để tìm USDT transfers
            const preTokenBalances = tx.meta.preTokenBalances || [];
            const postTokenBalances = tx.meta.postTokenBalances || [];

            // Tìm balance của USDT mint (có thể có nhiều token accounts trong transaction)
            const accountKeys = tx.transaction.message.getAccountKeys
              ? tx.transaction.message.getAccountKeys().staticAccountKeys
              : (tx.transaction.message as any).accountKeys || [];
            const tokenAccountIndex = accountKeys.findIndex(
              (key) => key.toBase58() === tokenAccountAddress.toBase58(),
            );

            // Tìm preBalance và postBalance của USDT mint
            let preBalance =
              tokenAccountIndex >= 0
                ? preTokenBalances.find(
                    (b) =>
                      b.accountIndex === tokenAccountIndex &&
                      b.mint === usdtMintAddress,
                  )
                : null;

            let postBalance =
              tokenAccountIndex >= 0
                ? postTokenBalances.find(
                    (b) =>
                      b.accountIndex === tokenAccountIndex &&
                      b.mint === usdtMintAddress,
                  )
                : null;

            // Nếu không tìm thấy theo accountIndex, thử tìm theo mint address
            // (có thể token account mới được tạo hoặc không có trong accountKeys)
            if (!preBalance && !postBalance) {
              // Tìm tất cả balances có mint = USDT mint
              const usdtPreBalances = preTokenBalances.filter(
                (b) => b.mint === usdtMintAddress,
              );
              const usdtPostBalances = postTokenBalances.filter(
                (b) => b.mint === usdtMintAddress,
              );

              // Verify rằng đây là token account của wallet này
              for (const postBal of usdtPostBalances) {
                if (
                  postBal.accountIndex >= 0 &&
                  postBal.accountIndex < accountKeys.length
                ) {
                  const accountAtIndex = accountKeys[postBal.accountIndex];

                  // Verify: account tại index này phải là token account của wallet này
                  if (
                    accountAtIndex.toBase58() ===
                      tokenAccountAddress.toBase58() ||
                    accountAtIndex.toBase58() === address
                  ) {
                    // Tìm preBalance tương ứng
                    const matchingPreBalance = usdtPreBalances.find(
                      (b) => b.accountIndex === postBal.accountIndex,
                    );

                    if (!matchingPreBalance) {
                      // Chỉ có postBalance (token account mới được tạo)
                      postBalance = postBal;
                      break;
                    } else {
                      // Có cả pre và post
                      preBalance = matchingPreBalance;
                      postBalance = postBal;
                      break;
                    }
                  }
                }
              }
            }

            // Xử lý deposit transaction
            if (postBalance) {
              const postAmount = parseFloat(
                postBalance.uiTokenAmount.uiAmountString || '0',
              );
              const preAmount = preBalance
                ? parseFloat(preBalance.uiTokenAmount.uiAmountString || '0')
                : 0;
              const amountChange = postAmount - preAmount;

              if (amountChange > 0) {
                // Chỉ lấy transaction nạp tiền (balance tăng)
                const blockTime = signatureInfo.blockTime
                  ? new Date(signatureInfo.blockTime * 1000)
                  : tx.blockTime
                    ? new Date(tx.blockTime * 1000)
                    : new Date();

                transactions.push({
                  hash: signatureInfo.signature,
                  amount: amountChange,
                  timestamp: blockTime,
                  to: address,
                });
              }
            }
          } catch {
            // Skip transaction on error
          }
        }

        // Nếu thành công, return transactions
        return transactions;
      } catch (rpcError: any) {
        // Nếu đây không phải RPC cuối cùng, thử tiếp
        if (rpcIndex < rpcUrls.length - 1) {
          continue; // Thử RPC endpoint tiếp theo
        }
        // Nếu đã thử hết tất cả RPCs
        this.logger.error(
          `All RPC endpoints failed for wallet ${address}. Last error: ${rpcError.message}`,
        );
        return []; // Trả về empty array
      }
    }

    // Nếu đến đây, tất cả RPCs đều fail
    this.logger.error(`All RPC endpoints exhausted for wallet ${address}`);
    return [];
  }

  async getSolanaNativeDepositTransactions(
    address: string,
    limit: number = 100,
  ): Promise<OnchainTransaction[]> {
    const primaryUrls =
      await this.adminSettingsConfigService.getRpcSolUrlsToTry();
    if (!primaryUrls.length) {
      throw new Error('SOLANA_RPC_URL not configured (admin_settings or .env)');
    }

    const fallbackRpcUrls = [
      'https://api.mainnet-beta.solana.com',
      'https://solana-api.projectserum.com',
    ];
    const primarySet = new Set(
      primaryUrls.map(SolChainSyncService.normalizeRpcUrl),
    );
    const extraFallbacks = fallbackRpcUrls.filter(
      (f) => !primarySet.has(SolChainSyncService.normalizeRpcUrl(f)),
    );
    const rpcUrls = [...primaryUrls, ...extraFallbacks];

    const walletPk = new PublicKey(address);

    for (let rpcIndex = 0; rpcIndex < rpcUrls.length; rpcIndex++) {
      const rpcUrl = rpcUrls[rpcIndex];
      const isPrimary = rpcIndex === 0;

      try {
        const connection = new Connection(rpcUrl, {
          commitment: 'confirmed',
          httpHeaders: { 'Content-Type': 'application/json' },
          fetch: async (url, options) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            try {
              const response = await fetch(url, {
                ...options,
                signal: controller.signal,
              });
              clearTimeout(timeoutId);
              return response;
            } catch (error: any) {
              clearTimeout(timeoutId);
              if (error.name === 'AbortError') {
                throw new Error('Request timeout after 30s');
              }
              throw error;
            }
          },
        });

        let signatures: { signature: string; blockTime?: number | null }[] = [];
        try {
          signatures = await this.retrySolanaRpcCall(
            () =>
              connection.getSignaturesForAddress(walletPk, {
                limit,
              }),
            `getSignaturesForAddress(native SOL wallet: ${address}) [${isPrimary ? 'primary' : 'fallback'} RPC]`,
            3,
            2000,
          );
        } catch (e: any) {
          if (isPrimary && rpcIndex < rpcUrls.length - 1) continue;
          throw e;
        }

        const out: OnchainTransaction[] = [];

        for (let i = 0; i < signatures.length; i++) {
          const sigInfo = signatures[i];
          if (i > 0) {
            await new Promise((r) => setTimeout(r, 500));
          }

          try {
            const tx = await this.retrySolanaRpcCall(
              () =>
                connection.getTransaction(sigInfo.signature, {
                  commitment: 'confirmed',
                  maxSupportedTransactionVersion: 0,
                }),
              `getTransaction(native ${sigInfo.signature})`,
              3,
              2000,
            );

            if (
              !tx?.meta?.preBalances?.length ||
              !tx.meta.postBalances?.length
            ) {
              continue;
            }

            const keys = tx.transaction.message.getAccountKeys({
              accountKeysFromLookups: tx.meta.loadedAddresses,
            });

            const n = Math.min(
              tx.meta.preBalances.length,
              tx.meta.postBalances.length,
            );

            for (let ai = 0; ai < n; ai++) {
              const key = keys.get(ai);
              if (!key || key.toBase58() !== address) continue;

              const preLamports = tx.meta.preBalances[ai];
              const postLamports = tx.meta.postBalances[ai];
              const delta = postLamports - preLamports;
              if (delta <= 0) continue;

              const amountSol = delta / LAMPORTS_PER_SOL;
              const blockTime = sigInfo.blockTime
                ? new Date(sigInfo.blockTime * 1000)
                : tx.blockTime
                  ? new Date(tx.blockTime * 1000)
                  : new Date();

              out.push({
                hash: sigInfo.signature,
                amount: amountSol,
                timestamp: blockTime,
                to: address,
              });
              break;
            }
          } catch {
            // bỏ qua từng signature lỗi
          }
        }

        return out;
      } catch (rpcError: any) {
        if (rpcIndex < rpcUrls.length - 1) continue;
        this.logger.error(
          `Native SOL: all RPC failed for ${address}: ${rpcError.message}`,
        );
        return [];
      }
    }

    return [];
  }

  async getNativeSolBalanceFromRpc(address: string): Promise<number> {
    const primaryUrls =
      await this.adminSettingsConfigService.getRpcSolUrlsToTry();
    if (!primaryUrls.length) {
      throw new Error('SOLANA_RPC_URL not configured');
    }
    const fallbackRpcUrls = [
      'https://api.mainnet-beta.solana.com',
      'https://solana-api.projectserum.com',
    ];
    const primarySet = new Set(
      primaryUrls.map(SolChainSyncService.normalizeRpcUrl),
    );
    const extraFallbacks = fallbackRpcUrls.filter(
      (f) => !primarySet.has(SolChainSyncService.normalizeRpcUrl(f)),
    );
    const rpcUrls = [...primaryUrls, ...extraFallbacks];
    const pk = new PublicKey(address);

    for (const rpcUrl of rpcUrls) {
      try {
        const connection = new Connection(rpcUrl, {
          commitment: 'confirmed',
          httpHeaders: { 'Content-Type': 'application/json' },
          fetch: async (url, options) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            try {
              const response = await fetch(url, {
                ...options,
                signal: controller.signal,
              });
              clearTimeout(timeoutId);
              return response;
            } catch (error: any) {
              clearTimeout(timeoutId);
              if (error.name === 'AbortError') {
                throw new Error('Request timeout after 30s');
              }
              throw error;
            }
          },
        });
        const lamports = await this.retrySolanaRpcCall(
          () => connection.getBalance(pk),
          `getBalance(native SOL ${address})`,
          3,
          2000,
        );
        return lamports / LAMPORTS_PER_SOL;
      } catch {
        continue;
      }
    }
    throw new Error('All RPC endpoints failed for native SOL balance');
  }

  private async getSolanaTransactionsFromExplorer(
    address: string,
    usdtMintAddress: string,
    limit: number = 100,
  ): Promise<OnchainTransaction[]> {
    try {
      if (!usdtMintAddress) {
        this.logger.warn(
          'USDT mint address not provided, skipping Solana Block Explorer API',
        );
        return [];
      }

      // Sử dụng Solscan API (Pro API nếu có key, public API nếu không)
      const apiKey = this.configService.get<string>('SOLSCAN_API_KEY');
      const apiUrl = apiKey
        ? 'https://pro-api.solscan.io/account/splTransfers'
        : 'https://public-api.solscan.io/account/splTransfers';

      const params = {
        account: address,
        limit: limit,
        offset: 0,
      };

      const headers: any = {
        Accept: 'application/json',
      };

      // Thêm API key vào header nếu có
      if (apiKey) {
        headers['token'] = apiKey;
      }

      const response = await axios.get(apiUrl, {
        params,
        timeout: 30000,
        headers,
      });

      if (!response.data || !Array.isArray(response.data)) {
        this.logger.warn('Invalid response from Solscan API');
        return [];
      }

      const transactions: OnchainTransaction[] = [];

      // Filter chỉ lấy USDT transfers (mint = usdtMintAddress) và là deposits (to = address)
      for (const tx of response.data) {
        // Kiểm tra mint address
        if (
          tx.mint &&
          tx.mint.toLowerCase() === usdtMintAddress.toLowerCase() &&
          tx.dst &&
          tx.dst.toLowerCase() === address.toLowerCase() &&
          tx.amount &&
          parseFloat(tx.amount) > 0
        ) {
          // Solana SPL tokens thường có 6 decimals cho USDT
          const decimals = tx.decimals || 6;
          const amount = parseFloat(tx.amount) / Math.pow(10, decimals);

          if (amount > 0) {
            transactions.push({
              hash: tx.txHash || tx.signature,
              amount: amount,
              timestamp: tx.blockTime
                ? new Date(tx.blockTime * 1000)
                : new Date(),
              from: tx.src,
              to: tx.dst,
            });
          }
        }
      }

      return transactions;
    } catch (error: any) {
      // Xử lý các lỗi từ API
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // API trả về error response
          const status = error.response.status;
          const data = error.response.data;

          if (status === 429) {
            throw new Error('Solscan API rate limit exceeded');
          }

          if (status === 404) {
            // Không tìm thấy transactions là trường hợp bình thường
            return [];
          }

          throw new Error(
            `Solscan API error (${status}): ${JSON.stringify(data)}`,
          );
        } else if (error.request) {
          // Request được gửi nhưng không có response
          throw new Error('Solscan API request timeout or network error');
        }
      }

      // Các lỗi khác
      throw error;
    }
  }

  async fetchAllDeposits(
    address: string,
    ctx: ChainDepositAssetContext,
  ): Promise<OnchainTransaction[]> {
    if (ctx.mode === 'native') {
      try {
        return await this.getSolanaNativeDepositTransactions(address, 500);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`Error fetching native SOL deposits: ${err.message}`);
        return [];
      }
    }
    return this.fetchAllSplTokenDeposits(address, ctx.mintOrContract);
  }

  private async fetchAllSplTokenDeposits(
    address: string,
    usdtMintOrContract: string,
  ): Promise<OnchainTransaction[]> {
    try {
      const nonMainnetCluster =
        await this.isSolanaConfiguredClusterNonMainnet();
      if (nonMainnetCluster) {
        this.logger.debug(
          `[sol-tx-fetch] Skip Solscan — RPC Solana đang trỏ devnet/testnet/local; ` +
            `Solscan không có dữ liệu cluster này, dùng RPC.`,
        );
      }

      const apiKey = this.configService.get<string>('SOLSCAN_API_KEY');
      if (!nonMainnetCluster && apiKey && apiKey.trim().length > 0) {
        try {
          const apiTransactions = await this.getSolanaTransactionsFromExplorer(
            address,
            usdtMintOrContract,
            500,
          );

          if (apiTransactions && apiTransactions.length > 0) {
            this.logger.log(
              `Fetched ${apiTransactions.length} transactions from Solana Block Explorer API for ${address}`,
            );
            return apiTransactions;
          }

          this.logger.warn(
            `Solscan returned 0 USDT SPL transfers for ${address}; falling back to RPC ` +
              `(trước đây code return [] sớm vì length>=0 — gây lệch khi ví trên devnet hoặc Solscan chưa index).`,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Solana Block Explorer API failed for ${address}, falling back to RPC scan. Error: ${errorMessage}`,
          );
        }
      }

      return await this.getSolanaTransactions(address, 500, usdtMintOrContract);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Error fetching all Solana transactions: ${err.message}`,
      );
      return [];
    }
  }

  async fetchRecentDeposits(
    address: string,
    ctx: ChainDepositAssetContext,
    recentBlockOrSlotCount: number,
  ): Promise<OnchainTransaction[]> {
    if (ctx.mode === 'native') {
      const limit = Math.max(1, Math.min(recentBlockOrSlotCount || 100, 500));
      try {
        return await this.getSolanaNativeDepositTransactions(address, limit);
      } catch (error: any) {
        this.logger.error(
          `Error fetching recent native SOL deposits for ${address}: ${error.message}`,
          error.stack,
        );
        return [];
      }
    }
    return this.fetchRecentSplTokenDeposits(
      address,
      ctx.mintOrContract,
      recentBlockOrSlotCount,
    );
  }

  private async fetchRecentSplTokenDeposits(
    address: string,
    usdtMintOrContract: string,
    recentBlockOrSlotCount: number,
  ): Promise<OnchainTransaction[]> {
    const limit = Math.max(1, Math.min(recentBlockOrSlotCount || 100, 500));
    try {
      const nonMainnetCluster =
        await this.isSolanaConfiguredClusterNonMainnet();
      if (nonMainnetCluster) {
        this.logger.debug(
          `[sol-tx-fetch] Skip Solscan (recent) — non-mainnet RPC; dùng RPC.`,
        );
      }

      const apiKey = this.configService.get<string>('SOLSCAN_API_KEY');
      if (!nonMainnetCluster && apiKey && apiKey.trim().length > 0) {
        try {
          const apiTransactions = await this.getSolanaTransactionsFromExplorer(
            address,
            usdtMintOrContract,
            limit,
          );

          if (apiTransactions && apiTransactions.length > 0) {
            this.logger.log(
              `Fetched ${apiTransactions.length} recent transactions from Solana Block Explorer API for ${address}`,
            );
            return apiTransactions;
          }

          this.logger.warn(
            `Solscan returned 0 recent USDT SPL transfers for ${address}; falling back to RPC.`,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Solana Block Explorer API failed for recent transactions of ${address}, falling back to RPC. Error: ${errorMessage}`,
          );
        }
      }

      try {
        return await this.getSolanaTransactions(
          address,
          limit,
          usdtMintOrContract,
        );
      } catch (solError: any) {
        this.logger.error(
          `Error fetching Solana transactions via RPC for ${address}: ${solError.message}`,
          solError.stack,
        );
        return [];
      }
    } catch (error: any) {
      this.logger.error(
        `Error fetching recent Solana transactions for ${address}: ${error.message}`,
        error.stack,
      );
      return [];
    }
  }

  async getDepositBalanceOnChain(
    address: string,
    ctx: ChainDepositAssetContext,
  ): Promise<number> {
    if (ctx.mode === 'native') {
      return this.getNativeSolBalanceFromRpc(address);
    }
    return this.getSplTokenBalanceOnChain(address, ctx.mintOrContract);
  }

  private async getSplTokenBalanceOnChain(
    address: string,
    usdtMintOrContract: string,
  ): Promise<number> {
    try {
      const primaryUrls =
        await this.adminSettingsConfigService.getRpcSolUrlsToTry();
      if (!primaryUrls.length) {
        throw new Error('SOLANA_RPC_URL is not configured');
      }
      const fallbackRpcUrls = [
        'https://api.mainnet-beta.solana.com',
        'https://solana-api.projectserum.com',
      ];
      const primarySet = new Set(
        primaryUrls.map(SolChainSyncService.normalizeRpcUrl),
      );
      const extraFallbacks = fallbackRpcUrls.filter(
        (f) => !primarySet.has(SolChainSyncService.normalizeRpcUrl(f)),
      );
      const rpcUrls = [...primaryUrls, ...extraFallbacks];

      for (let rpcIndex = 0; rpcIndex < rpcUrls.length; rpcIndex++) {
        const rpcUrl = rpcUrls[rpcIndex];
        const isPrimary = rpcIndex === 0;

        try {
          // Tạo Connection với timeout configuration
          const connection = new Connection(rpcUrl, {
            commitment: 'confirmed',
            httpHeaders: {
              'Content-Type': 'application/json',
            },
            fetch: async (url, options) => {
              // Thêm timeout cho fetch requests
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

              try {
                const response = await fetch(url, {
                  ...options,
                  signal: controller.signal,
                });
                clearTimeout(timeoutId);
                return response;
              } catch (error: any) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                  throw new Error('Request timeout after 30s');
                }
                throw error;
              }
            },
          });

          const walletPublicKey = new PublicKey(address);
          const mintPublicKey = new PublicKey(usdtMintOrContract);

          // Lấy associated token address
          const tokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            walletPublicKey,
          );

          try {
            const tokenAccountInfo =
              await connection.getTokenAccountBalance(tokenAccount);
            // USDT trên Solana có 6 decimals
            const balance = parseFloat(
              tokenAccountInfo.value.uiAmountString || '0',
            );

            this.logger.debug(
              `[rpc-usdt-balance] SOL rpcHost=${this.debugRpcHost(rpcUrl)} primary=${isPrimary} ` +
                `wallet=${this.debugShortAddr(address)} ATA=${tokenAccount.toBase58()} ` +
                `uiAmountString=${tokenAccountInfo.value.uiAmountString ?? 'n/a'} parsed=${balance}`,
            );

            if (!isPrimary) {
              this.logger.log(
                `Successfully got USDT balance using fallback RPC for ${address} on SOL`,
              );
            }

            return balance;
          } catch (error: any) {
            // Token account không tồn tại = balance = 0
            if (
              error?.message?.includes('InvalidAccountData') ||
              error?.message?.includes('could not find account') ||
              error?.message?.includes('Invalid public key')
            ) {
              this.logger.debug(
                `[rpc-usdt-balance] SOL: không đọc được ATA USDT (coi balance=0). ` +
                  `rpcHost=${this.debugRpcHost(rpcUrl)} wallet=${address} ATA=${tokenAccount.toBase58()} ` +
                  `mint=${usdtMintOrContract} err=${error?.message}. ` +
                  `Gợi ý: chỉ gửi native SOL thì số dư USDT SPL on-chain vẫn 0; cần gửi USDT SPL vào ví này.`,
              );
              return 0;
            }

            // Nếu không phải lỗi "account not found", throw để thử RPC tiếp theo
            if (isPrimary) {
              this.logger.warn(
                `Primary RPC failed for USDT balance check on SOL: ${error.message}. Trying fallback...`,
              );
            }
            throw error;
          }
        } catch (error: any) {
          // Nếu đây là RPC cuối cùng, throw error
          if (rpcIndex === rpcUrls.length - 1) {
            throw new Error(
              `All RPC endpoints failed. Last error: ${error.message}`,
            );
          }
          // Nếu không phải RPC cuối, tiếp tục thử RPC tiếp theo
          continue;
        }
      }

      // Không bao giờ đến đây, nhưng TypeScript cần return
      throw new Error('Failed to get USDT balance from all RPC endpoints');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error getting USDT balance from RPC for ${address} on SOL: ${msg}`,
      );
      throw error;
    }
  }
}
