/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { ActiveWalletTracker } from './entities/active-wallet-tracker.entity';
import {
  WalletHistory,
  WalletHistoryOption,
  WalletHistoryStatus,
} from './entities/wallet-history.entity';
import {
  WalletTransfer,
  WalletTransferFrom,
  WalletTransferStatus,
} from './entities/wallet-transfer.entity';
import { WalletDepositTracker } from './entities/wallet-deposit-tracker.entity';
import { UserWallet } from './entities/user-wallet.entity';
import { UserWalletNetwork } from './entities/user-wallet-network.entity';
import { Network } from '../settings/entities/network.entity';
import { Coin, CoinStatus } from '../settings/entities/coin.entity';
import {
  CoinNetwork,
  CoinNetworkStatus,
  CoinType,
} from '../settings/entities/coin-network.entity';
import { CacheService } from '../systems/cache.service';
import { WalletsFileStorageService } from './wallets-file-storage.service';
import { User } from '../users/entities/user.entity';
import { EmailService } from '../systems/email.service';
import type { ChainDepositAssetContext } from './chain-sync/chain-deposit-asset.context';
import type { OnchainTransaction } from './chain-sync/onchain-transaction.types';
import { ChainSyncRouterService } from './chain-sync/chain-sync-router.service';

@Injectable()
export class WalletsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(WalletsSchedulerService.name);

  constructor(
    @InjectRepository(ActiveWalletTracker)
    private activeWalletTrackerRepository: Repository<ActiveWalletTracker>,
    @InjectRepository(WalletHistory)
    private walletHistoryRepository: Repository<WalletHistory>,
    @InjectRepository(WalletDepositTracker)
    private walletDepositTrackerRepository: Repository<WalletDepositTracker>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserWallet)
    private userWalletRepository: Repository<UserWallet>,
    @InjectRepository(Network)
    private networkRepository: Repository<Network>,
    @InjectRepository(Coin)
    private coinRepository: Repository<Coin>,
    @InjectRepository(CoinNetwork)
    private coinNetworkRepository: Repository<CoinNetwork>,
    @InjectRepository(WalletTransfer)
    private walletTransferRepository: Repository<WalletTransfer>,
    @InjectRepository(UserWalletNetwork)
    private useWalletNetworkRepository: Repository<UserWalletNetwork>,
    private cacheService: CacheService,
    private fileStorageService: WalletsFileStorageService,
    private emailService: EmailService,
    private chainSyncRouter: ChainSyncRouterService,
  ) {}

  /** Log địa chỉ dài gọn cho debug (không che toàn bộ — đủ để đối chiếu explorer). */
  private debugShortAddr(addr: string, head = 8, tail = 6): string {
    const s = (addr || '').trim();
    if (!s) return '(empty)';
    if (s.length <= head + tail + 3) return s;
    return `${s.slice(0, head)}...${s.slice(-tail)}`;
  }

  /**
   * Chạy ngay khi module khởi động để lắng nghe nạp tiền ngay lập tức
   * Chạy trong background để không ảnh hưởng đến thời gian start server
   */
  async onModuleInit() {
    this.logger.log(
      'WalletsSchedulerService initialized, starting initial deposit listener in background...',
    );
    // Chạy trong background (không await) để không block server startup
    this.handleDepositListener().catch((error) => {
      this.logger.error(
        `Error in initial deposit listener: ${error.message}`,
        error.stack,
      );
    });
  }

  /**
   * Cron job chạy mỗi 2 phút để lắng nghe lệnh nạp tiền onchain
   */
  @Cron('*/2 * * * *') // Chạy mỗi 2 phút
  async handleDepositListener() {
    this.logger.log('Starting deposit listener cron job...');

    try {
      // 1. Lấy danh sách các ví tracker còn thời hạn (UTC+0)
      const nowUTC = new Date(new Date().toISOString());
      const activeTrackers = await this.activeWalletTrackerRepository
        .createQueryBuilder('awt')
        .where('awt.awt_expires_at > :now', { now: nowUTC.toISOString() })
        .getMany();

      this.logger.log(`Found ${activeTrackers.length} active wallet trackers`);

      if (activeTrackers.length === 0) {
        this.logger.log(
          'Deposit listener: không có bản ghi active_wallet_tracker nào thỏa awt_expires_at > now (UTC). ' +
            'Scheduler sẽ không gọi RPC / không in [deposit-sync], [balance-check], [tx-cache] — ' +
            'các log đó chỉ xuất hiện khi có ít nhất 1 tracker (tạo khi user mở flow nạp ví trong WalletsService). ' +
            'Để xem chi tiết khi đã có tracker: LOG_LEVEL=debug.',
        );
        this.logger.log('Deposit listener cron job completed');
        return;
      }

      // 2. Nhóm theo network và deduplicate theo address để tránh xử lý trùng lặp
      const trackersByNetwork = new Map<number, ActiveWalletTracker[]>();
      const seenAddresses = new Map<string, ActiveWalletTracker>(); // Track addresses đã xử lý

      for (const tracker of activeTrackers) {
        const networkId = tracker.awt_network_id;
        const addressKey = `${networkId}_${tracker.awt_address}`;

        // Nếu đã có tracker cho address này trong network này, giữ tracker có expires_at mới nhất
        if (seenAddresses.has(addressKey)) {
          const existingTracker = seenAddresses.get(addressKey)!;
          if (tracker.awt_expires_at > existingTracker.awt_expires_at) {
            seenAddresses.set(addressKey, tracker);
          }
          continue; // Bỏ qua duplicate
        }

        seenAddresses.set(addressKey, tracker);

        if (!trackersByNetwork.has(networkId)) {
          trackersByNetwork.set(networkId, []);
        }
        trackersByNetwork.get(networkId)!.push(tracker);
      }

      // 3. Xử lý từng network — gom (userId, coinId) cần refresh uw_balance sau cùng
      const userCoinsToRefresh = new Map<number, Set<number>>();
      const markUserCoin = (userId: number, coinId: number) => {
        if (!userCoinsToRefresh.has(userId)) {
          userCoinsToRefresh.set(userId, new Set());
        }
        userCoinsToRefresh.get(userId)!.add(coinId);
      };

      for (const [networkId, trackers] of trackersByNetwork.entries()) {
        const network = await this.networkRepository.findOne({
          where: { net_id: networkId },
        });

        if (!network) {
          this.logger.warn(`Network ${networkId} not found`);
          continue;
        }

        this.logger.log(
          `Processing ${trackers.length} trackers for network ${network.net_symbol}`,
        );

        // Xử lý song song nhưng giới hạn số lượng để tránh quá tải
        // Với SOL và TRON/TRX, xử lý tuần tự để tránh rate limit RPC/TronGrid
        const sym = network.net_symbol.trim().toUpperCase();
        const sequentialChain =
          sym === 'SOL' || sym === 'TRON' || sym === 'TRX';
        const batchSize = sequentialChain ? 1 : 10;
        for (let i = 0; i < trackers.length; i += batchSize) {
          const batch = trackers.slice(i, i + batchSize);

          if (sequentialChain) {
            // Tuần tự + delay cho SOL / TRON (TronGrid)
            for (const tracker of batch) {
              await this.processWalletTracker(tracker, network, markUserCoin);

              if (i + batch.length < trackers.length) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }
            }
          } else {
            // Xử lý song song cho ETH/BNB/EVM khác
            await Promise.all(
              batch.map((tracker) =>
                this.processWalletTracker(tracker, network, markUserCoin),
              ),
            );
          }
        }
      }

      // 4. Cập nhật uw_balance cho từng cặp (user, coin) đã chạy deposit-sync
      let uwBalanceRowsUpdated = 0;
      let uwBalanceUnchanged = 0;
      let pairCount = 0;
      for (const [userId, coinSet] of userCoinsToRefresh.entries()) {
        for (const coinId of coinSet) {
          pairCount++;
          try {
            const changed = await this.updateUserBalance(userId, coinId);
            if (changed) uwBalanceRowsUpdated++;
            else uwBalanceUnchanged++;
          } catch (error: any) {
            this.logger.error(
              `Error updating balance user=${userId} coin=${coinId}: ${error.message}`,
            );
          }
        }
      }
      this.logger.log(
        `uw_balance pass: ${pairCount} user/coin pair(s), ${userCoinsToRefresh.size} user(s) — ` +
          `DB updated=${uwBalanceRowsUpdated}, skipped=${uwBalanceUnchanged}. ` +
          `Chi tiết: LOG_LEVEL=debug, prefix [uw-balance].`,
      );

      this.logger.log('Deposit listener cron job completed');
    } catch (error) {
      this.logger.error(
        `Error in deposit listener: ${error.message}`,
        error.stack,
      );
    }
  }

  private isNativeCoinNetwork(cn: CoinNetwork): boolean {
    return (
      cn.cn_coin_type === CoinType.NATIVE ||
      (cn.cn_coin_type == null && !cn.cn_coin_mint)
    );
  }

  private buildDepositAssetContext(
    cn: CoinNetwork,
    network: Network,
  ): ChainDepositAssetContext | null {
    const networkSymbol = network.net_symbol;
    if (this.isNativeCoinNetwork(cn)) {
      return { mode: 'native', networkSymbol };
    }
    if (cn.cn_coin_mint) {
      return {
        mode: 'fungible',
        mintOrContract: cn.cn_coin_mint,
        networkSymbol,
      };
    }
    return null;
  }

  private preserveCacheIfFetchEmpty(
    fetched: OnchainTransaction[],
    cached: OnchainTransaction[],
  ): OnchainTransaction[] {
    if (fetched.length === 0 && cached.length > 0) {
      this.logger.warn(
        `Full onchain fetch returned 0 txs but cache has ${cached.length}; keeping cache to avoid wipe`,
      );
      return cached;
    }
    return fetched;
  }

  /**
   * Mỗi tracker: với network đó, xử lý tất cả coin_network ACTIVE (coin ACTIVE) — native hoặc token (mint/contract).
   */
  private async processWalletTracker(
    tracker: ActiveWalletTracker,
    network: Network,
    onUserCoinProcessed?: (userId: number, coinId: number) => void,
  ): Promise<void> {
    try {
      if (!this.chainSyncRouter.resolve(network.net_symbol)) {
        this.logger.debug(
          `[deposit-sync] No chain handler for ${network.net_symbol}, skip awt_id=${tracker.awt_id}`,
        );
        return;
      }

      const rows = await this.coinNetworkRepository.find({
        where: {
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
        relations: ['coin'],
      });

      for (const cn of rows) {
        const coin = cn.coin;
        if (!coin || coin.coin_status !== CoinStatus.ACTIVE) {
          continue;
        }
        const ctx = this.buildDepositAssetContext(cn, network);
        if (!ctx) {
          this.logger.warn(
            `coin_network cn_id=${cn.cn_id} coin_id=${cn.cn_coin_id} on ${network.net_symbol}: missing mint for non-native, skip`,
          );
          continue;
        }
        await this.processWalletTrackerForCoin(
          tracker,
          network,
          coin,
          coin.coin_id,
          ctx,
          'cron',
          onUserCoinProcessed,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Error processing tracker ${tracker.awt_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  private async processWalletTrackerForCoin(
    tracker: ActiveWalletTracker,
    network: Network,
    coin: Coin,
    coinId: number,
    ctx: ChainDepositAssetContext,
    mode: 'cron' | 'manual',
    onUserCoinProcessed?: (userId: number, coinId: number) => void,
  ): Promise<void> {
    try {
      const assetLabel =
        ctx.mode === 'native'
          ? 'native'
          : this.debugShortAddr(ctx.mintOrContract, 6, 6);
      this.logger.debug(
        `[deposit-sync] start awt_id=${tracker.awt_id} user_id=${tracker.awt_user_id} ` +
          `network=${network.net_symbol} addr=${this.debugShortAddr(tracker.awt_address)} ` +
          `coin=${coin.coin_symbol} coin_id=${coinId} asset=${assetLabel} mode=${mode}`,
      );

      const cachedTransactions = await this.getCachedTransactions(
        tracker.awt_address,
        network,
        coinId,
      );

      const conflictCheck = await this.checkCacheConflict(
        tracker,
        cachedTransactions,
        coinId,
        network,
      );

      this.logger.debug(
        `[deposit-sync] conflictCheck awt_id=${tracker.awt_id} coin=${coin.coin_symbol} ` +
          `hasConflict=${conflictCheck.hasConflict} missingInCache=${conflictCheck.missingInCache.length} ` +
          `cachedTxCount=${cachedTransactions.length}`,
      );

      let finalTransactions: OnchainTransaction[];
      let balanceMatchForLog = false;

      if (mode === 'manual') {
        if (conflictCheck.hasConflict) {
          this.logger.warn(
            `Conflict for ${tracker.awt_address} (${coin.coin_symbol}), fetching full onchain history`,
          );
          finalTransactions = await this.getAllOnchainDeposits(
            tracker.awt_address,
            network,
            ctx,
          );
          finalTransactions = this.preserveCacheIfFetchEmpty(
            finalTransactions,
            cachedTransactions,
          );
        } else {
          const newTransactions = await this.getRecentOnchainDeposits(
            tracker.awt_address,
            network,
            100,
            ctx,
          );
          const existingHashes = new Set(
            cachedTransactions.map((tx) => tx.hash),
          );
          const uniqueNew = newTransactions.filter(
            (tx) => !existingHashes.has(tx.hash),
          );
          finalTransactions = [...cachedTransactions, ...uniqueNew];
        }
      } else {
        const balanceCheck = await this.checkWalletBalance(
          tracker,
          network,
          coinId,
          ctx,
        );
        balanceMatchForLog = balanceCheck.balanceMatch;

        if (balanceCheck.balanceMatch) {
          this.logger.log(
            `Balance match for ${tracker.awt_address} on ${network.net_symbol} (${coin.coin_symbol}): ` +
              `onchain=${balanceCheck.onchainBalance}, db=${balanceCheck.dbBalance}. Skipping onchain fetch.`,
          );
          finalTransactions = cachedTransactions;
        } else {
          const diff = balanceCheck.onchainBalance - balanceCheck.dbBalance;
          this.logger.warn(
            `[balance-mismatch] awt_id=${tracker.awt_id} user=${tracker.awt_user_id} ` +
              `network=${network.net_symbol} coin=${coin.coin_symbol} ` +
              `onchain=${balanceCheck.onchainBalance} db=${balanceCheck.dbBalance} diff=${diff}`,
          );

          if (conflictCheck.hasConflict) {
            this.logger.warn(
              `Conflict for ${tracker.awt_address} (${coin.coin_symbol}), fetching full history`,
            );
            finalTransactions = await this.getAllOnchainDeposits(
              tracker.awt_address,
              network,
              ctx,
            );
            finalTransactions = this.preserveCacheIfFetchEmpty(
              finalTransactions,
              cachedTransactions,
            );
          } else {
            const newTransactions = await this.getRecentOnchainDeposits(
              tracker.awt_address,
              network,
              100,
              ctx,
            );
            const existingHashes = new Set(
              cachedTransactions.map((tx) => tx.hash),
            );
            const uniqueNew = newTransactions.filter(
              (tx) => !existingHashes.has(tx.hash),
            );
            finalTransactions = [...cachedTransactions, ...uniqueNew];
          }
        }
      }

      this.logger.debug(
        `[deposit-sync] pre-save awt_id=${tracker.awt_id} coin=${coin.coin_symbol} ` +
          `finalTxCount=${finalTransactions.length} cronBalanceSkippedFetch=${mode === 'cron' && balanceMatchForLog}`,
      );

      await this.saveTransactionsToCacheAndFile(
        tracker.awt_address,
        network,
        coinId,
        finalTransactions,
      );

      await this.syncTransactions(tracker, finalTransactions, network, coinId);

      onUserCoinProcessed?.(tracker.awt_user_id, coinId);
    } catch (error: any) {
      this.logger.error(
        `Error processing tracker ${tracker.awt_id} coin ${coin.coin_symbol}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Cache/file theo (network, coin_id, address) để mỗi asset không ghi đè nhau.
   */
  private async getCachedTransactions(
    address: string,
    network: Network,
    coinId: number,
  ): Promise<OnchainTransaction[]> {
    const cacheKey = `onchain_tx_${network.net_symbol}_${coinId}_${address}`;
    const cacheDuration = 30 * 24 * 60 * 60;

    const cachedData = await this.cacheService.get(cacheKey);
    if (cachedData) {
      const transactions = JSON.parse(cachedData).map((tx: any) => ({
        ...tx,
        timestamp: new Date(tx.timestamp),
      }));
      this.logger.debug(
        `[tx-cache] HIT redis key=${cacheKey} count=${transactions.length} ` +
          `addr=${this.debugShortAddr(address)}`,
      );
      return transactions;
    }

    const fileTransactions = await this.fileStorageService.loadTransactions(
      address,
      network.net_symbol,
      coinId,
    );

    if (fileTransactions && fileTransactions.length > 0) {
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(fileTransactions),
        cacheDuration,
      );
      this.logger.debug(
        `[tx-cache] MISS redis, HIT file net=${network.net_symbol} coinId=${coinId} ` +
          `count=${fileTransactions.length} addr=${this.debugShortAddr(address)}`,
      );
      return fileTransactions;
    }

    this.logger.debug(
      `[tx-cache] EMPTY redis+file key=${cacheKey} addr=${this.debugShortAddr(address)}`,
    );
    return [];
  }

  /**
   * Kiểm tra xung đột giữa cache và wallet_histories
   * Xung đột xảy ra khi:
   * - Cache thiếu transaction_hash có trong wallet_histories (chấp nhận được)
   * - Cache có transaction_hash không có trong wallet_histories nhưng amount/timestamp khác (xung đột)
   * - Cache có transaction_hash không có trong wallet_histories (chấp nhận được, sẽ sync)
   *
   * Tối ưu: Chỉ kiểm tra transactions của network cụ thể (theo wh_node) để tránh lấy quá nhiều dữ liệu
   */
  private async checkCacheConflict(
    tracker: ActiveWalletTracker,
    cachedTransactions: OnchainTransaction[],
    coinId: number,
    network: Network,
  ): Promise<{ hasConflict: boolean; missingInCache: string[] }> {
    // Lấy danh sách transaction từ database - CHỈ của network cụ thể này
    const dbTransactions = await this.walletHistoryRepository.find({
      where: {
        wh_user: tracker.awt_user_id,
        wh_coins: coinId,
        wh_option: WalletHistoryOption.DEPOSIT,
        wh_status: In([
          WalletHistoryStatus.SUCCESS,
          WalletHistoryStatus.PENDING,
          WalletHistoryStatus.CHECKED,
        ]),
        wh_node: network.net_symbol, // Tối ưu: chỉ lấy transactions của network này
      },
    });

    const cachedHashes = new Set(cachedTransactions.map((tx) => tx.hash));
    const dbHashes = new Set(
      dbTransactions
        .map((tx) => tx.wh_hash)
        .filter((h) => h !== null) as string[],
    );

    // Tìm transaction có trong database nhưng không có trong cache
    const missingInCache = Array.from(dbHashes).filter(
      (hash) => !cachedHashes.has(hash),
    );

    // Kiểm tra xung đột: transaction có trong cả cache và database nhưng amount/timestamp khác
    let hasConflict = false;
    for (const cachedTx of cachedTransactions) {
      const dbTx = dbTransactions.find((tx) => tx.wh_hash === cachedTx.hash);
      if (dbTx) {
        const cachedAmount = parseFloat(cachedTx.amount.toString());
        const dbAmount = parseFloat(dbTx.wh_amount.toString());
        const cachedTimestamp = cachedTx.timestamp.getTime();
        const dbTimestamp = dbTx.created_at.getTime();

        // Chỉ kiểm tra conflict về amount, không kiểm tra timestamp
        // Vì timestamp từ cache (block time) có thể khác với created_at trong database
        // (block time = thời gian giao dịch xảy ra, created_at = thời gian record được tạo)
        const amountDiff = Math.abs(cachedAmount - dbAmount);
        const timestampDiff = Math.abs(cachedTimestamp - dbTimestamp);

        // Chỉ coi là conflict nếu amount khác nhau
        if (amountDiff > 0.00000001) {
          hasConflict = true;
          this.logger.warn(
            `Conflict detected: Transaction ${cachedTx.hash} has different amount. ` +
              `Amount: cache=${cachedAmount}, db=${dbAmount}, diff=${amountDiff.toFixed(8)}. ` +
              `Timestamp: cache=${new Date(cachedTimestamp).toISOString()}, db=${new Date(dbTimestamp).toISOString()}, diff=${timestampDiff}ms (ignored)`,
          );
          break;
        }

        // Log thông tin timestamp nếu khác nhau (nhưng không coi là conflict)
        if (timestampDiff > 1000) {
          this.logger.debug(
            `Transaction ${cachedTx.hash} has different timestamp (not a conflict): ` +
              `cache=${new Date(cachedTimestamp).toISOString()}, db=${new Date(dbTimestamp).toISOString()}, diff=${timestampDiff}ms`,
          );
        }
      }
    }

    return {
      hasConflict,
      missingInCache,
    };
  }

  /**
   * Lưu transaction vào cache (30 ngày) và file (vĩnh viễn)
   */
  private async saveTransactionsToCacheAndFile(
    address: string,
    network: Network,
    coinId: number,
    transactions: OnchainTransaction[],
  ): Promise<void> {
    const cacheKey = `onchain_tx_${network.net_symbol}_${coinId}_${address}`;
    const cacheDuration = 30 * 24 * 60 * 60;

    await this.cacheService.set(
      cacheKey,
      JSON.stringify(transactions),
      cacheDuration,
    );

    await this.fileStorageService.saveTransactions(
      address,
      network.net_symbol,
      transactions,
      coinId,
    );
  }

  private async getAllOnchainDeposits(
    address: string,
    network: Network,
    ctx: ChainDepositAssetContext,
  ): Promise<OnchainTransaction[]> {
    try {
      const handler = this.chainSyncRouter.resolve(network.net_symbol);
      if (!handler) {
        this.logger.debug(
          `No chain sync handler for network ${network.net_symbol}`,
        );
        return [];
      }
      return await handler.fetchAllDeposits(address, ctx);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error fetching all onchain deposits: ${msg}`);
      return [];
    }
  }

  private async getRecentOnchainDeposits(
    address: string,
    network: Network,
    blockCount: number,
    ctx: ChainDepositAssetContext,
  ): Promise<OnchainTransaction[]> {
    try {
      const handler = this.chainSyncRouter.resolve(network.net_symbol);
      if (!handler) {
        this.logger.debug(
          `No chain sync handler for network ${network.net_symbol}`,
        );
        return [];
      }
      return await handler.fetchRecentDeposits(address, ctx, blockCount);
    } catch (error: any) {
      this.logger.error(
        `Error fetching recent onchain deposits for ${address} on ${network.net_symbol}: ${error.message}`,
        error.stack,
      );
      return [];
    }
  }

  private async syncTransactions(
    tracker: ActiveWalletTracker,
    onchainTransactions: OnchainTransaction[],
    network: Network,
    coinId: number,
  ): Promise<void> {
    // Lấy danh sách transaction đã có trong database - CHỈ của network cụ thể này
    const existingTransactions = await this.walletHistoryRepository.find({
      where: {
        wh_user: tracker.awt_user_id,
        wh_coins: coinId,
        wh_option: WalletHistoryOption.DEPOSIT,
        wh_status: In([
          WalletHistoryStatus.SUCCESS,
          WalletHistoryStatus.PENDING,
          WalletHistoryStatus.CHECKED,
        ]),
        wh_node: network.net_symbol, // Tối ưu: chỉ lấy transactions của network này
      },
    });

    const existingHashes = new Set(
      existingTransactions.map((tx) => tx.wh_hash).filter((h) => h !== null),
    );

    // Tìm transaction còn thiếu
    let missingTransactions = onchainTransactions.filter(
      (tx) => !existingHashes.has(tx.hash),
    );

    // Cập nhật các record có wh_node = null nhưng hash trùng với transaction mới
    const newTransactionHashes = new Set(
      missingTransactions.map((tx) => tx.hash),
    );
    if (newTransactionHashes.size > 0) {
      const recordsWithNullNode = await this.walletHistoryRepository.find({
        where: {
          wh_user: tracker.awt_user_id,
          wh_coins: coinId,
          wh_option: WalletHistoryOption.DEPOSIT,
          wh_status: In([
            WalletHistoryStatus.SUCCESS,
            WalletHistoryStatus.PENDING,
            WalletHistoryStatus.CHECKED,
          ]),
          wh_node: IsNull(),
          wh_hash: In(Array.from(newTransactionHashes)),
        },
      });

      if (recordsWithNullNode.length > 0) {
        const userWalletNetwork = await this.useWalletNetworkRepository.findOne(
          {
            where: {
              uwn_user_id: tracker.awt_user_id,
              uwn_network_id: network.net_id,
            },
          },
        );

        if (userWalletNetwork) {
          await this.walletHistoryRepository.update(
            {
              wh_id: In(recordsWithNullNode.map((tx) => tx.wh_id)),
            },
            {
              wh_wallet_netword_id: userWalletNetwork.uwn_id,
              wh_node: network.net_symbol,
            },
          );
          this.logger.log(
            `Updated wh_wallet_netword_id and wh_node for ${recordsWithNullNode.length} records with null wh_node (${network.net_symbol}) for user ${tracker.awt_user_id}`,
          );
          // Loại bỏ các hash đã được cập nhật khỏi missingTransactions
          const updatedHashes = new Set(
            recordsWithNullNode
              .map((tx) => tx.wh_hash)
              .filter((h) => h !== null),
          );
          missingTransactions = missingTransactions.filter(
            (tx) => !updatedHashes.has(tx.hash),
          );
        }
      }
    }

    // Cập nhật wh_wallet_netword_id cho các record đã tồn tại nhưng đang null
    const recordsToUpdate = existingTransactions.filter(
      (tx) => tx.wh_wallet_netword_id === null,
    );

    if (recordsToUpdate.length > 0) {
      // Lấy wallet network của user cho network này
      const userWalletNetwork = await this.useWalletNetworkRepository.findOne({
        where: {
          uwn_user_id: tracker.awt_user_id,
          uwn_network_id: network.net_id,
        },
      });

      if (userWalletNetwork) {
        // Cập nhật tất cả records có wh_wallet_netword_id = null (và wh_node nếu null)
        await this.walletHistoryRepository.update(
          {
            wh_id: In(recordsToUpdate.map((tx) => tx.wh_id)),
          },
          {
            wh_wallet_netword_id: userWalletNetwork.uwn_id,
            wh_node: network.net_symbol, // Đảm bảo wh_node cũng được cập nhật
          },
        );
        this.logger.log(
          `Updated wh_wallet_netword_id and wh_node for ${recordsToUpdate.length} existing deposit records (${network.net_symbol}) for user ${tracker.awt_user_id}`,
        );
      }
    }

    // Bổ sung transaction còn thiếu
    for (const tx of missingTransactions) {
      try {
        const walletHistory = this.walletHistoryRepository.create({
          wh_wallet_netword_id: tracker.uwn_id,
          wh_type: 'crypto' as any,
          wh_option: WalletHistoryOption.DEPOSIT,
          wh_coins: coinId,
          wh_amount: tx.amount,
          wh_hash: tx.hash,
          wh_status: WalletHistoryStatus.SUCCESS,
          wh_node: network.net_symbol, // Lưu network symbol (SOL, ETH, BNB)
          wh_user: tracker.awt_user_id,
        });

        await this.walletHistoryRepository.save(walletHistory);

        // Sau khi tạo lịch sử nạp, tạo (hoặc bỏ qua nếu đã tồn tại) bản ghi trong wallet_deposit_tracker
        // Tracker các ví on-chain của user đã từng nạp tiền vào hệ thống (địa chỉ ví của user trong hệ thống)
        const depositAddress = tracker.awt_address?.trim();
        if (depositAddress) {
          const existingDepositTracker =
            await this.walletDepositTrackerRepository.findOne({
              where: {
                wdt_user_id: tracker.awt_user_id,
                wdt_network_id: network.net_id,
                wdt_address: depositAddress,
              },
            });

          if (!existingDepositTracker) {
            const depositTracker = this.walletDepositTrackerRepository.create({
              wdt_user_id: tracker.awt_user_id,
              wdt_network_id: network.net_id,
              wdt_address: depositAddress,
              wdt_withdraw: false,
            });

            await this.walletDepositTrackerRepository.save(depositTracker);
            this.logger.log(
              `Created wallet_deposit_tracker for user ${tracker.awt_user_id}, network ${network.net_symbol}, address ${depositAddress}`,
            );
          } else if (existingDepositTracker.wdt_withdraw === true) {
            existingDepositTracker.wdt_withdraw = false;
            await this.walletDepositTrackerRepository.save(
              existingDepositTracker,
            );
            this.logger.log(
              `Reset wallet_deposit_tracker wdt_withdraw=false for user ${tracker.awt_user_id}, network ${network.net_symbol}, address ${depositAddress} (new deposit detected)`,
            );
          }
        }

        // Gửi email thông báo nạp USDT thành công cho user
        try {
          const user = await this.userRepository.findOne({
            where: { uid: tracker.awt_user_id },
          });

          if (user && user.uemail) {
            await this.emailService.sendDepositNotification(
              user.uemail,
              tx.amount,
            );
          }
        } catch (emailError: any) {
          this.logger.error(
            `Error sending deposit notification email for user ${tracker.awt_user_id}: ${emailError.message}`,
          );
        }

        this.logger.log(
          `Added missing transaction ${tx.hash} (${network.net_symbol}) for user ${tracker.awt_user_id}`,
        );
      } catch (error) {
        this.logger.error(
          `Error adding transaction ${tx.hash}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Public method để sync balance từ onchain (được gọi từ WalletsService)
   */
  async syncWalletBalance(
    tracker: ActiveWalletTracker,
    network: Network,
    coinId: number,
  ): Promise<void> {
    try {
      const coin = await this.coinRepository.findOne({
        where: { coin_id: coinId },
      });
      if (!coin) {
        this.logger.warn(`syncWalletBalance: coin ${coinId} not found`);
        return;
      }

      const cn = await this.coinNetworkRepository.findOne({
        where: {
          cn_coin_id: coinId,
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
      });
      if (!cn) {
        this.logger.warn(
          `syncWalletBalance: no active coin_network for ${coin.coin_symbol} on ${network.net_symbol}`,
        );
        return;
      }

      const ctx = this.buildDepositAssetContext(cn, network);
      if (!ctx) {
        this.logger.warn(
          `syncWalletBalance: invalid coin_network for ${coin.coin_symbol} / ${network.net_symbol}`,
        );
        return;
      }

      if (!this.chainSyncRouter.resolve(network.net_symbol)) {
        this.logger.debug(
          `[syncWalletBalance] no chain handler for ${network.net_symbol}; skip`,
        );
        return;
      }

      await this.processWalletTrackerForCoin(
        tracker,
        network,
        coin,
        coinId,
        ctx,
        'manual',
      );
      await this.updateUserBalance(tracker.awt_user_id, coinId);
    } catch (error: any) {
      this.logger.error(
        `Error syncing wallet balance: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Hàm chung để cập nhật balance của user với logic tối ưu
   * Balance mới = totalDeposit + totalReward - totalStaking - totalWithdraw
   * Chỉ cập nhật database nếu balance mới khác với balance cũ theo điều kiện:
   * - Nếu totalStaking <= (totalDeposit + totalReward - totalWithdraw): chỉ update nếu balance mới != balance cũ
   * - Nếu totalStaking > (totalDeposit + totalReward - totalWithdraw): chỉ update nếu balance mới + 10 >= balance cũ
   * @param userId - ID của user
   * @param coinId - ID của coin
   * @param totalDeposit - Tổng số tiền nạp thành công (optional, sẽ tính nếu không truyền)
   * @param totalReward - Tổng số tiền reward/gift chuyển vào main (optional, sẽ tính nếu không truyền)
   * @param totalStaking - Tổng số tiền staking đang running/pending-claim (optional, sẽ tính nếu không truyền)
   * @param totalWithdraw - Tổng số tiền đã rút (optional, sẽ tính nếu không truyền)
   * @returns true nếu đã cập nhật, false nếu không cần cập nhật
   */
  async updateUserBalanceIfChanged(
    userId: number,
    coinId: number,
    totalDeposit?: number,
    totalReward?: number,
    totalStaking?: number,
    totalWithdraw?: number,
  ): Promise<boolean> {
    try {
      // Tính toán các giá trị nếu chưa được truyền vào
      if (totalDeposit === undefined) {
        const totalDepositResult = await this.walletHistoryRepository
          .createQueryBuilder('wh')
          .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
          .where('wh.wh_user = :userId', { userId })
          .andWhere('wh.wh_coins = :coinId', { coinId })
          .andWhere('wh.wh_option = :option', {
            option: WalletHistoryOption.DEPOSIT,
          })
          .andWhere('wh.wh_status = :status', {
            status: WalletHistoryStatus.SUCCESS,
          })
          .getRawOne();
        totalDeposit = parseFloat(totalDepositResult?.total || '0');
      }

      if (totalReward === undefined) {
        const totalRewardResult = await this.walletTransferRepository
          .createQueryBuilder('wt')
          .select('COALESCE(SUM(wt.wt_amount), 0)', 'total')
          .where('wt.wt_user_id = :userId', { userId })
          .andWhere('wt.wt_from IN (:...fromTypes)', {
            fromTypes: [WalletTransferFrom.REWARD, WalletTransferFrom.GIFT],
          })
          .andWhere('wt.wt_to = :toType', {
            toType: 'main',
          })
          .andWhere('wt.wt_status = :status', {
            status: WalletTransferStatus.SUCCESS,
          })
          .getRawOne();
        totalReward = parseFloat(totalRewardResult?.total || '0');
      }

      if (totalStaking === undefined) {
        totalStaking = 0;
      }

      if (totalWithdraw === undefined) {
        const totalWithdrawResult = await this.walletHistoryRepository
          .createQueryBuilder('wh')
          .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
          .where('wh.wh_user = :userId', { userId })
          .andWhere('wh.wh_coins = :coinId', { coinId })
          .andWhere('wh.wh_option = :option', {
            option: WalletHistoryOption.WITHDRAW,
          })
          .andWhere('wh.wh_status IN (:...statuses)', {
            statuses: [
              WalletHistoryStatus.PENDING,
              WalletHistoryStatus.SUCCESS,
              WalletHistoryStatus.CHECKED,
            ],
          })
          .getRawOne();
        totalWithdraw = parseFloat(totalWithdrawResult?.total || '0');
      }

      // Tính balance mới
      let newBalance =
        totalDeposit + totalReward - totalStaking - totalWithdraw;

      // Đảm bảo balance không âm: nếu <= 0 thì set = 0
      if (newBalance <= 0) {
        newBalance = 0;
      }

      // Lấy balance hiện tại từ database
      const userWallet = await this.userWalletRepository.findOne({
        where: {
          uw_user_id: userId,
          uw_wallet_coins: coinId,
        },
      });

      if (!userWallet) {
        // Tạo mới nếu chưa có
        const newUserWallet = this.userWalletRepository.create({
          uw_user_id: userId,
          uw_wallet_type: 'crypto' as any,
          uw_wallet_coins: coinId,
          uw_balance: newBalance,
          uw_balance_gift: 0,
          uw_balance_reward: 0,
        });
        await this.userWalletRepository.save(newUserWallet);
        this.logger.log(
          `Created new wallet for user ${userId} with balance ${newBalance}`,
        );
        return true;
      }

      // Balance cũ chỉ là uw_balance (không cộng staking)
      const oldBalance = parseFloat(userWallet.uw_balance.toString());

      // Kiểm tra điều kiện để quyết định có cần update hay không
      const availableAmount = totalDeposit + totalReward - totalWithdraw; // Số tiền có sẵn (chưa trừ staking)
      let shouldUpdate = true;

      // Trường hợp không có staking (totalStaking = 0) hoặc staking <= availableAmount
      // Logic: Nếu balance mới = balance cũ thì không cần update
      if (totalStaking <= availableAmount) {
        // Bao gồm cả trường hợp totalStaking = 0 (không có staking nào)
        const tolerance = 0.00000001; // Sai số cho phép
        if (Math.abs(newBalance - oldBalance) <= tolerance) {
          shouldUpdate = false;
        }
      } else {
        // Trường hợp tổng staking > (totalDeposit - totalWithdraw) - có thể do lỗi dữ liệu hoặc edge case
        // Nếu balance mới + 10 < balance cũ thì không cần update (cho phép chênh lệch tối đa 10)
        if (newBalance + 10 < oldBalance) {
          shouldUpdate = false;
        }
      }

      // Chỉ cập nhật nếu cần thiết
      if (shouldUpdate) {
        userWallet.uw_balance = newBalance as any;
        await this.userWalletRepository.save(userWallet);
        this.logger.log(
          `Updated balance for user ${userId}: ${newBalance} (deposit: ${totalDeposit}, reward: ${totalReward}, staking: ${totalStaking}, withdraw: ${totalWithdraw})`,
        );
        return true;
      }

      this.logger.debug(
        `[uw-balance] skip DB write userId=${userId} coinId=${coinId} ` +
          `uw_balance(stored)=${oldBalance} computedNew=${newBalance} ` +
          `deposit(SUCCESS)=${totalDeposit} reward=${totalReward} staking=${totalStaking} withdraw(pending+success+checked)=${totalWithdraw} ` +
          `shouldUpdate=false (thường là |computedNew-stored|<=tolerance; hoặc nhánh staking edge). ` +
          `Lưu ý: API số dư dùng toàn coin (mọi network), không chỉ SOL.`,
      );
      return false;
    } catch (error) {
      this.logger.error(
        `Error updating balance for user ${userId}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Cập nhật balance của user
   * uw_balance = tổng nạp thành công - tổng staking (running/pending-claim) - tổng rút (pending/success/checked)
   * Chỉ cập nhật database nếu balance mới khác với balance cũ (uw_balance + staking)
   */
  /** @returns true nếu đã ghi `user_wallets.uw_balance`, false nếu bỏ qua (đã khớp hoặc shouldUpdate=false). */
  async updateUserBalance(userId: number, coinId: number): Promise<boolean> {
    return this.updateUserBalanceIfChanged(userId, coinId);
  }

  /**
   * So sánh số dư on-chain (native hoặc token) với tổng deposit (trừ admin) trên network trong DB.
   */
  private async checkWalletBalance(
    tracker: ActiveWalletTracker,
    network: Network,
    coinId: number,
    ctx: ChainDepositAssetContext,
  ): Promise<{
    balanceMatch: boolean;
    onchainBalance: number;
    dbBalance: number;
  }> {
    try {
      const onchainBalance = await this.getOnchainDepositBalance(
        tracker.awt_address,
        network,
        ctx,
      );

      const dbBalance = await this.calculateDepositBalance(
        tracker.awt_user_id,
        coinId,
        network,
      );

      const tolerance = 0.00000001;
      const diff = onchainBalance - dbBalance;
      const balanceMatch = Math.abs(diff) <= tolerance;

      const assetRef =
        ctx.mode === 'native'
          ? 'native'
          : this.debugShortAddr(ctx.mintOrContract, 6, 6);
      this.logger.debug(
        `[balance-check] user_id=${tracker.awt_user_id} network=${network.net_symbol} ` +
          `addr=${tracker.awt_address} asset=${assetRef} ` +
          `onchain=${onchainBalance} dbDepositNet=${dbBalance} diff=${diff} match=${balanceMatch}`,
      );

      return {
        balanceMatch,
        onchainBalance,
        dbBalance,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error checking wallet balance for ${tracker.awt_address} on ${network.net_symbol}: ${errMsg}`,
      );
      this.logger.debug(
        `[balance-check] exception user_id=${tracker.awt_user_id} addr=${tracker.awt_address}: ${errStack || errMsg}`,
      );
      return {
        balanceMatch: false,
        onchainBalance: 0,
        dbBalance: 0,
      };
    }
  }

  private async getOnchainDepositBalance(
    address: string,
    network: Network,
    ctx: ChainDepositAssetContext,
  ): Promise<number> {
    const handler = this.chainSyncRouter.resolve(network.net_symbol);
    if (!handler) {
      throw new Error(`Unsupported network: ${network.net_symbol}`);
    }
    return handler.getDepositBalanceOnChain(address, ctx);
  }

  /**
   * Tính tổng deposit - admin-deposit từ wallet_histories
   */
  private async calculateDepositBalance(
    userId: number,
    coinId: number,
    network: Network,
  ): Promise<number> {
    try {
      // Lấy tổng deposit (không bao gồm admin-deposit)
      const depositResult = await this.walletHistoryRepository
        .createQueryBuilder('wh')
        .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
        .where('wh.wh_user = :userId', { userId })
        .andWhere('wh.wh_coins = :coinId', { coinId })
        .andWhere('wh.wh_option = :option', {
          option: WalletHistoryOption.DEPOSIT,
        })
        .andWhere('wh.wh_status = :status', {
          status: WalletHistoryStatus.SUCCESS,
        })
        .andWhere('wh.wh_node = :node', { node: network.net_symbol })
        .getRawOne();

      const totalDeposit = parseFloat(depositResult?.total || '0');

      // Lấy tổng admin-deposit
      const adminDepositResult = await this.walletHistoryRepository
        .createQueryBuilder('wh')
        .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
        .where('wh.wh_user = :userId', { userId })
        .andWhere('wh.wh_coins = :coinId', { coinId })
        .andWhere('wh.wh_option = :option', {
          option: WalletHistoryOption.ADMIN_DEPOSIT,
        })
        .andWhere('wh.wh_status = :status', {
          status: WalletHistoryStatus.SUCCESS,
        })
        .andWhere('wh.wh_node = :node', { node: network.net_symbol })
        .getRawOne();

      const totalAdminDeposit = parseFloat(adminDepositResult?.total || '0');

      const net = totalDeposit - totalAdminDeposit;
      this.logger.debug(
        `[deposit-balance-db] userId=${userId} coinId=${coinId} wh_node=${network.net_symbol} ` +
          `SUM(DEPOSIT,SUCCESS)=${totalDeposit} SUM(ADMIN_DEPOSIT,SUCCESS)=${totalAdminDeposit} netDb=${net} ` +
          `(đối chiếu số dư on-chain theo network)`,
      );

      // Trả về deposit - admin-deposit
      return net;
    } catch (error) {
      this.logger.error(
        `Error calculating deposit balance for user ${userId} on ${network.net_symbol}: ${error.message}`,
      );
      return 0;
    }
  }
}
