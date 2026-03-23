import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { JsonRpcProvider, formatUnits, Network as EthersNetwork } from 'ethers';
import { ActiveWalletTracker } from './entities/active-wallet-tracker.entity';
import { WalletHistory, WalletHistoryOption, WalletHistoryStatus } from './entities/wallet-history.entity';
import { WalletTransfer, WalletTransferFrom, WalletTransferStatus } from './entities/wallet-transfer.entity';
import { WalletDepositTracker } from './entities/wallet-deposit-tracker.entity';
import { UserWallet } from './entities/user-wallet.entity';
import { UserWalletNetwork } from './entities/user-wallet-network.entity';
import { Network } from '../settings/entities/network.entity';
import { Coin } from '../settings/entities/coin.entity';
import { CoinNetwork, CoinNetworkStatus } from '../settings/entities/coin-network.entity';
import { CacheService } from '../systems/cache.service';
import { WalletsFileStorageService } from './wallets-file-storage.service';
import { User } from '../users/entities/user.entity';
import { EmailService } from '../systems/email.service';
import { AdminSettingsConfigService } from '../settings/admin-settings-config.service';
import axios from 'axios';

interface OnchainTransaction {
  hash: string;
  amount: number;
  timestamp: Date;
  from?: string;
  to: string;
}

@Injectable()
export class WalletsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(WalletsSchedulerService.name);
  
  // Rate limiter cho Zerion API: tối đa 7 requests/1s
  private zerionApiQueue: Array<() => Promise<any>> = [];
  private zerionApiProcessing = false;
  private zerionApiLastRequestTime = 0;
  private readonly ZERION_API_MAX_REQUESTS_PER_SECOND = 7;
  private readonly ZERION_API_MIN_INTERVAL_MS = 1000 / 7; // ~143ms giữa mỗi request

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
    private configService: ConfigService,
    private cacheService: CacheService,
    private fileStorageService: WalletsFileStorageService,
    private emailService: EmailService,
    private adminSettingsConfigService: AdminSettingsConfigService,
  ) {}

  /**
   * Helper method để tạo JsonRpcProvider an toàn với error handling
   * Tránh lỗi "JsonRpcProvider failed to detect network" khi RPC không accessible
   */
  private async createSafeJsonRpcProvider(
    rpcUrl: string,
    networkSymbol?: string,
    timeout: number = 5000,
  ): Promise<JsonRpcProvider | null> {
    if (!rpcUrl || rpcUrl.trim().length === 0) {
      this.logger.warn('RPC URL is empty or invalid');
      return null;
    }

    // Kiểm tra placeholder URLs
    const placeholderPatterns = [
      /^your_.*_rpc_url$/i,
      /^https?:\/\/your_.*$/i,
      /^placeholder/i,
      /^example/i,
      /^http:\/\/localhost/i,
    ];

    const isPlaceholder = placeholderPatterns.some((pattern) =>
      pattern.test(rpcUrl.trim()),
    );

    if (isPlaceholder) {
      this.logger.warn(
        `RPC URL appears to be a placeholder: ${rpcUrl}. Please configure a valid RPC URL in .env`,
      );
      return null;
    }

    // Kiểm tra URL format cơ bản
    if (!rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://')) {
      this.logger.warn(`RPC URL must start with http:// or https://: ${rpcUrl}`);
      return null;
    }

    try {
      // Sử dụng static network để tránh auto-detect (nguyên nhân gây retry liên tục)
      // ethers v6: truyền network object vào constructor và sử dụng staticNetwork option
      let provider: JsonRpcProvider;
      
      if (networkSymbol === 'ETH') {
        // Ethereum Mainnet: chainId = 1
        // Sử dụng staticNetwork với Network object để tắt hoàn toàn auto-detect
        const ethNetwork = EthersNetwork.from('mainnet');
        provider = new JsonRpcProvider(rpcUrl, ethNetwork, { staticNetwork: ethNetwork });
      } else if (networkSymbol === 'BNB' || networkSymbol === 'BSC') {
        // BSC Mainnet: chainId = 56
        // Tạo custom network cho BSC
        const bscNetwork = new EthersNetwork('bsc', 56);
        provider = new JsonRpcProvider(rpcUrl, bscNetwork, { staticNetwork: bscNetwork });
      } else {
        // Không biết network, vẫn phải auto-detect (nhưng sẽ test ngay)
        provider = new JsonRpcProvider(rpcUrl);
      }

      // Test connection với timeout ngay lập tức
      // Nếu không kết nối được trong timeout, sẽ throw error và không return provider
      const connectionTest = Promise.race([
        provider.getBlockNumber().catch((err) => {
          // Nếu getBlockNumber fail, throw lại để catch bên ngoài xử lý
          throw new Error(`RPC connection failed: ${err.message}`);
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout after 5s')), timeout),
        ),
      ]);

      await connectionTest;
      
      // Nếu đến đây, connection thành công
      return provider;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Chỉ log warning, không log error để tránh spam log
      this.logger.warn(
        `Cannot connect to RPC for ${networkSymbol || 'unknown'} at ${rpcUrl}: ${errorMessage}`,
      );
      return null;
    }
  }

  /**
   * Chạy ngay khi module khởi động để lắng nghe nạp tiền ngay lập tức
   * Chạy trong background để không ảnh hưởng đến thời gian start server
   */
  async onModuleInit() {
    this.logger.log('WalletsSchedulerService initialized, starting initial deposit listener in background...');
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

      // 3. Xử lý từng network
      const processedUserIds = new Set<number>(); // Track users đã được xử lý
      for (const [networkId, trackers] of trackersByNetwork.entries()) {
        const network = await this.networkRepository.findOne({
          where: { net_id: networkId },
        });

        if (!network) {
          this.logger.warn(`Network ${networkId} not found`);
          continue;
        }

        this.logger.log(`Processing ${trackers.length} trackers for network ${network.net_symbol}`);

        // Xử lý song song nhưng giới hạn số lượng để tránh quá tải
        // Với SOL, xử lý tuần tự để tránh rate limit
        const batchSize = network.net_symbol === 'SOL' ? 1 : 10;
        for (let i = 0; i < trackers.length; i += batchSize) {
          const batch = trackers.slice(i, i + batchSize);
          
          if (network.net_symbol === 'SOL') {
            // Xử lý tuần tự cho SOL để tránh rate limit
            for (const tracker of batch) {
              await this.processWalletTracker(tracker, network);
              processedUserIds.add(tracker.awt_user_id);
              
              // Thêm delay giữa các wallets để tránh rate limit
              if (i + batch.length < trackers.length) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
              }
            }
          } else {
            // Xử lý song song cho ETH/BNB
            await Promise.all(
              batch.map((tracker) => this.processWalletTracker(tracker, network)),
            );
            
            // Track users đã được xử lý
            batch.forEach((tracker) => processedUserIds.add(tracker.awt_user_id));
          }
        }
      }

      // 4. Cập nhật balance cho tất cả users đã được xử lý (chỉ 1 lần mỗi user)
      const usdtCoin = await this.coinRepository.findOne({
        where: { coin_symbol: 'USDT' },
      });

      if (usdtCoin) {
        for (const userId of processedUserIds) {
          try {
            await this.updateUserBalance(userId, usdtCoin.coin_id);
          } catch (error) {
            this.logger.error(
              `Error updating balance for user ${userId}: ${error.message}`,
            );
          }
        }
        this.logger.log(`Updated balance for ${processedUserIds.size} users`);
      }

      this.logger.log('Deposit listener cron job completed');
    } catch (error) {
      this.logger.error(`Error in deposit listener: ${error.message}`, error.stack);
    }
  }

  /**
   * Xử lý một wallet tracker cụ thể
   */
  private async processWalletTracker(
    tracker: ActiveWalletTracker,
    network: Network,
  ): Promise<void> {
    try {
      // 1. Lấy coin USDT
      const usdtCoin = await this.coinRepository.findOne({
        where: { coin_symbol: 'USDT' },
      });

      if (!usdtCoin) {
        this.logger.warn('USDT coin not found');
        return;
      }

      // 1.5. Lấy USDT mint/contract address từ coin_networks
      const usdtCoinNetwork = await this.coinNetworkRepository.findOne({
        where: {
          cn_coin_id: usdtCoin.coin_id,
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
      });

      if (!usdtCoinNetwork || !usdtCoinNetwork.cn_coin_mint) {
        this.logger.warn(
          `USDT not configured for network ${network.net_symbol} or missing mint/contract address`,
        );
        return;
      }

      const usdtMintOrContract = usdtCoinNetwork.cn_coin_mint;

      // 2. Lấy transaction từ cache hoặc file (chỉ USDT)
      let cachedTransactions = await this.getCachedTransactions(
        tracker.awt_address,
        network,
        usdtMintOrContract,
      );

      // 3. Đối chiếu cache với wallet_histories để kiểm tra xung đột
      const conflictCheck = await this.checkCacheConflict(
        tracker,
        cachedTransactions,
        usdtCoin.coin_id,
        network,
      );

      // 3.5. Kiểm tra số dư USDT từ RPC và so sánh với wallet_histories
      const balanceCheck = await this.checkWalletBalance(
        tracker,
        network,
        usdtCoin.coin_id,
        usdtMintOrContract,
      );

      let finalTransactions: OnchainTransaction[];

      // Nếu số dư khớp, bỏ qua việc fetch onchain
      if (balanceCheck.balanceMatch) {
        this.logger.log(
          `Balance match for ${tracker.awt_address} on ${network.net_symbol}: ` +
          `onchain=${balanceCheck.onchainBalance}, db=${balanceCheck.dbBalance}. Skipping onchain fetch.`,
        );
        // Vẫn cần sync transactions từ cache để đảm bảo database đầy đủ
        finalTransactions = cachedTransactions;
      } else {
        // Số dư không khớp, tiếp tục fetch onchain
        this.logger.warn(
          `Balance mismatch for ${tracker.awt_address} on ${network.net_symbol}: ` +
          `onchain=${balanceCheck.onchainBalance}, db=${balanceCheck.dbBalance}. Fetching onchain data.`,
        );

        if (conflictCheck.hasConflict) {
          // 4a. Có xung đột: Lắng nghe lại toàn bộ lịch sử ví (chỉ USDT)
          this.logger.warn(
            `Conflict detected for ${tracker.awt_address}, fetching full USDT history`,
          );
          finalTransactions = await this.getAllOnchainTransactions(
            tracker.awt_address,
            network,
            usdtMintOrContract,
          );
        } else {
          // 4b. Không có xung đột: Lắng nghe 100 block mới nhất (chỉ USDT)
          const newTransactions = await this.getRecentOnchainTransactions(
            tracker.awt_address,
            network,
            100,
            usdtMintOrContract,
          );

          // Merge với cache (loại bỏ duplicate)
          const existingHashes = new Set(
            cachedTransactions.map((tx) => tx.hash),
          );
          const uniqueNewTransactions = newTransactions.filter(
            (tx) => !existingHashes.has(tx.hash),
          );

          finalTransactions = [...cachedTransactions, ...uniqueNewTransactions];
        }
      }

      // 5. Lưu vào cache (30 ngày) và file (vĩnh viễn)
      await this.saveTransactionsToCacheAndFile(
        tracker.awt_address,
        network,
        finalTransactions,
      );

      // 6. Đối chiếu và bổ sung transaction còn thiếu vào database
      await this.syncTransactions(
        tracker,
        finalTransactions,
        network,
        usdtCoin.coin_id,
      );

      // 7. Balance sẽ được cập nhật sau khi xử lý tất cả trackers (trong handleDepositListener)
      // Không cập nhật balance ở đây để tránh cập nhật nhiều lần cho cùng 1 user
    } catch (error) {
      this.logger.error(
        `Error processing tracker ${tracker.awt_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Lấy transaction từ cache (30 ngày) hoặc file (vĩnh viễn) - chỉ USDT
   * @param usdtMintOrContract - USDT mint address (SOL) hoặc contract address (ETH/BNB) để filter
   */
  private async getCachedTransactions(
    address: string,
    network: Network,
    usdtMintOrContract?: string,
  ): Promise<OnchainTransaction[]> {
    const cacheKey = `onchain_tx_${network.net_symbol}_${address}`;
    const cacheDuration = 30 * 24 * 60 * 60; // 30 ngày = 2,592,000 giây

    // 1. Kiểm tra cache trước
    const cachedData = await this.cacheService.get(cacheKey);
    if (cachedData) {
      let transactions = JSON.parse(cachedData).map((tx: any) => ({
        ...tx,
        timestamp: new Date(tx.timestamp),
      }));
      
      // Filter chỉ USDT nếu có usdtMintOrContract (để loại bỏ native coin từ cache cũ)
      if (usdtMintOrContract) {
        transactions = this.filterUSDTTransactions(
          transactions,
          network,
          usdtMintOrContract,
        );
      }
      
      return transactions;
    }

    // 2. Nếu không có cache, kiểm tra file
    const fileTransactions = await this.fileStorageService.loadTransactions(
      address,
      network.net_symbol,
    );

    if (fileTransactions && fileTransactions.length > 0) {
      // Filter chỉ USDT nếu có usdtMintOrContract (để loại bỏ native coin từ file cũ)
      let filteredTransactions = fileTransactions;
      if (usdtMintOrContract) {
        filteredTransactions = this.filterUSDTTransactions(
          fileTransactions,
          network,
          usdtMintOrContract,
        );
      }

      // Tạo cache 30 ngày mới từ file (chỉ USDT)
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(filteredTransactions),
        cacheDuration,
      );
      return filteredTransactions;
    }

    // 3. Nếu không có cả cache và file, trả về mảng rỗng
    return [];
  }

  /**
   * Filter transactions để chỉ lấy USDT (loại bỏ native coin)
   * Note: Vì cache/file có thể chứa dữ liệu cũ (native coin), cần filter lại
   */
  private filterUSDTTransactions(
    transactions: OnchainTransaction[],
    network: Network,
    usdtMintOrContract: string,
  ): OnchainTransaction[] {
    // Vì các transactions trong cache/file đã được lấy từ onchain với filter USDT,
    // nên thường không cần filter lại. Nhưng để đảm bảo an toàn với dữ liệu cũ,
    // chúng ta có thể kiểm tra lại nếu cần.
    
    // Hiện tại, vì tất cả transactions đã được filter USDT khi lấy từ onchain,
    // nên chỉ cần return transactions. Nhưng để đảm bảo với dữ liệu cũ, có thể thêm validation.
    
    // TODO: Nếu cần, có thể thêm validation để đảm bảo transactions đều là USDT
    // (ví dụ: check amount format, hash pattern, etc.)
    
    return transactions;
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
      dbTransactions.map((tx) => tx.wh_hash).filter((h) => h !== null) as string[],
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
    transactions: OnchainTransaction[],
  ): Promise<void> {
    const cacheKey = `onchain_tx_${network.net_symbol}_${address}`;
    const cacheDuration = 30 * 24 * 60 * 60; // 30 ngày

    // Lưu vào cache (toàn bộ transactions)
    await this.cacheService.set(
      cacheKey,
      JSON.stringify(transactions),
      cacheDuration,
    );

    // Lưu vào file (incremental - chỉ append transactions mới)
    // File storage service sẽ tự động merge với file hiện có
    await this.fileStorageService.saveTransactions(
      address,
      network.net_symbol,
      transactions,
    );
  }

  /**
   * Lấy toàn bộ transaction history từ onchain (chỉ USDT)
   * Ưu tiên Block Explorer API, fallback về RPC scan
   * @param usdtMintOrContract - USDT mint address (SOL) hoặc contract address (ETH/BNB)
   */
  private async getAllOnchainTransactions(
    address: string,
    network: Network,
    usdtMintOrContract: string,
  ): Promise<OnchainTransaction[]> {
    try {
      if (network.net_symbol === 'SOL') {
        // Chỉ thử Block Explorer API nếu có API key (không trống và không phải empty string)
        const apiKey = this.configService.get<string>('SOLSCAN_API_KEY');
        if (apiKey && apiKey.trim().length > 0) {
          try {
            const apiTransactions = await this.getSolanaTransactionsFromExplorer(
              address,
              usdtMintOrContract,
              500, // Limit 500 transactions for full history
            );
            
            if (apiTransactions && apiTransactions.length >= 0) {
              // Trả về kết quả từ API (kể cả empty array)
              this.logger.log(
                `Fetched ${apiTransactions.length} transactions from Solana Block Explorer API for ${address}`,
              );
              return apiTransactions;
            }
          } catch (error) {
            // Xử lý tất cả các lỗi từ Block Explorer API (bao gồm invalid API key)
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Solana Block Explorer API failed for ${address}, falling back to RPC scan. Error: ${errorMessage}`,
            );
            // Tiếp tục fallback về RPC scan
          }
        }

        // Sử dụng RPC (fallback hoặc primary nếu không có API key)
        return await this.getSolanaTransactions(address, 500, usdtMintOrContract);
      } else if (network.net_symbol === 'ETH' || network.net_symbol === 'BNB') {
        // Sử dụng Zerion API thay vì Block Explorer API và RPC
        try {
          const zerionTransactions = await this.getEVMTransactionsFromZerion(
            address,
            network,
            usdtMintOrContract,
          );
          if (zerionTransactions && zerionTransactions.length >= 0) {
            this.logger.log(
              `Fetched ${zerionTransactions.length} transactions from Zerion API for ${address} on ${network.net_symbol}`,
            );
            return zerionTransactions;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Zerion API failed for ${address} on ${network.net_symbol}: ${errorMessage}`,
          );
          return [];
        }
      }
      return [];
    } catch (error) {
      this.logger.error(
        `Error fetching all onchain transactions: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Lấy transaction từ 100 block mới nhất (chỉ USDT)
   * Ưu tiên Block Explorer API với filter theo block range
   * @param usdtMintOrContract - USDT mint address (SOL) hoặc contract address (ETH/BNB)
   */
  private async getRecentOnchainTransactions(
    address: string,
    network: Network,
    blockCount: number,
    usdtMintOrContract: string,
  ): Promise<OnchainTransaction[]> {
    try {
      if (network.net_symbol === 'SOL') {
        // Chỉ thử Block Explorer API nếu có API key (không trống và không phải empty string)
        const apiKey = this.configService.get<string>('SOLSCAN_API_KEY');
        if (apiKey && apiKey.trim().length > 0) {
          try {
            const apiTransactions = await this.getSolanaTransactionsFromExplorer(
              address,
              usdtMintOrContract,
              100, // Limit 100 transactions
            );
            
            if (apiTransactions && apiTransactions.length >= 0) {
              // Trả về kết quả từ API (kể cả empty array)
              this.logger.log(
                `Fetched ${apiTransactions.length} recent transactions from Solana Block Explorer API for ${address}`,
              );
              return apiTransactions;
            }
          } catch (error) {
            // Xử lý tất cả các lỗi từ Block Explorer API (bao gồm invalid API key)
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Solana Block Explorer API failed for recent transactions of ${address}, falling back to RPC. Error: ${errorMessage}`,
            );
            // Tiếp tục fallback về RPC
          }
        }

        // Sử dụng RPC (fallback hoặc primary nếu không có API key)
        try {
          return await this.getSolanaTransactions(address, 100, usdtMintOrContract);
        } catch (solError: any) {
          this.logger.error(
            `Error fetching Solana transactions via RPC for ${address} on ${network.net_symbol}: ${solError.message}`,
            solError.stack,
          );
          // Trả về empty array thay vì throw để không làm gián đoạn process
          return [];
        }
      } else if (network.net_symbol === 'ETH' || network.net_symbol === 'BNB') {
        // Sử dụng Zerion API thay vì Block Explorer API và RPC
        try {
          const zerionTransactions = await this.getEVMTransactionsFromZerion(
            address,
            network,
            usdtMintOrContract,
          );
          if (zerionTransactions && zerionTransactions.length >= 0) {
            this.logger.log(
              `Fetched ${zerionTransactions.length} recent transactions from Zerion API for ${address} on ${network.net_symbol}`,
            );
            return zerionTransactions;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Zerion API failed for ${address} on ${network.net_symbol}: ${errorMessage}`,
          );
          return [];
        }
      }
      return [];
    } catch (error: any) {
      this.logger.error(
        `Error fetching recent onchain transactions for ${address} on ${network.net_symbol}: ${error.message}`,
        error.stack,
      );
      return [];
    }
  }

  /**
   * Retry helper với exponential backoff cho Solana RPC calls
   */
  private async retrySolanaRpcCall<T>(
    fn: () => Promise<T>,
    operation: string,
    maxRetries: number = 5, // Tăng số lần retry
    baseDelay: number = 3000, // Tăng base delay
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
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Nếu không phải network error hoặc đã hết retry, throw error
        if (attempt === maxRetries - 1 || !isNetworkError) {
          throw error;
        }
      }
    }
    
    throw lastError || new Error(`Unknown error in retry for ${operation}`);
  }

  /**
   * Lấy transaction từ Solana (chỉ USDT SPL token transfers)
   * @param address - Địa chỉ ví
   * @param limit - Giới hạn số lượng signature (mặc định: 100 cho recent, 500 cho full)
   * @param usdtMintAddress - USDT mint address (chỉ lấy transfers của token này)
   */
  private static normalizeRpcUrl(url: string): string {
    return url.replace(/\/+$/, '').trim();
  }

  private async getSolanaTransactions(
    address: string,
    limit: number = 100,
    usdtMintAddress?: string,
  ): Promise<OnchainTransaction[]> {
    const primaryUrls = await this.adminSettingsConfigService.getRpcSolUrlsToTry();
    if (!primaryUrls.length) {
      throw new Error('SOLANA_RPC_URL not configured (admin_settings or .env)');
    }

    if (!usdtMintAddress) {
      this.logger.warn('USDT mint address not provided, skipping Solana transactions');
      return [];
    }

    const fallbackRpcUrls = [
      'https://api.mainnet-beta.solana.com',
      'https://solana-api.projectserum.com',
    ];
    const primarySet = new Set(primaryUrls.map(WalletsSchedulerService.normalizeRpcUrl));
    const extraFallbacks = fallbackRpcUrls.filter(
      (f) => !primarySet.has(WalletsSchedulerService.normalizeRpcUrl(f)),
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
            () => connection.getSignaturesForAddress(tokenAccountAddress, {
              limit: limit,
            }),
            `getSignaturesForAddress(tokenAccount: ${tokenAccountAddress.toBase58()}) [${isPrimary ? 'primary' : 'fallback'} RPC]`,
            3, // Giảm retry cho mỗi RPC endpoint (sẽ thử nhiều endpoints)
            2000, // Base delay
          );
        } catch (error: any) {
          // Fallback: Thử lấy từ wallet address
          try {
            signatures = await this.retrySolanaRpcCall(
              () => connection.getSignaturesForAddress(publicKey, {
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
            await new Promise(resolve => setTimeout(resolve, 500)); // Tăng delay lên 500ms
          }

          try {
            const tx = await this.retrySolanaRpcCall(
              () => connection.getTransaction(signatureInfo.signature, {
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
            const accountKeys = tx.transaction.message.getAccountKeys ? 
              tx.transaction.message.getAccountKeys().staticAccountKeys : 
              (tx.transaction.message as any).accountKeys || [];
            const tokenAccountIndex = accountKeys.findIndex(
              (key) => key.toBase58() === tokenAccountAddress.toBase58(),
            );

            // Tìm preBalance và postBalance của USDT mint
            let preBalance = tokenAccountIndex >= 0
              ? preTokenBalances.find(
                  (b) =>
                    b.accountIndex === tokenAccountIndex &&
                    b.mint === usdtMintAddress,
                )
              : null;

            let postBalance = tokenAccountIndex >= 0
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
                if (postBal.accountIndex >= 0 && postBal.accountIndex < accountKeys.length) {
                  const accountAtIndex = accountKeys[postBal.accountIndex];
                  
                  // Verify: account tại index này phải là token account của wallet này
                  if (
                    accountAtIndex.toBase58() === tokenAccountAddress.toBase58() ||
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
              const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
              const preAmount = preBalance 
                ? parseFloat(preBalance.uiTokenAmount.uiAmountString || '0')
                : 0;
              const amountChange = postAmount - preAmount;

              if (amountChange > 0) {
                // Chỉ lấy transaction nạp tiền (balance tăng)
                const blockTime = signatureInfo.blockTime 
                  ? new Date(signatureInfo.blockTime * 1000)
                  : (tx.blockTime ? new Date(tx.blockTime * 1000) : new Date());
                
                transactions.push({
                  hash: signatureInfo.signature,
                  amount: amountChange,
                  timestamp: blockTime,
                  to: address,
                });
              }
            }
          } catch (error: any) {
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
    this.logger.error(
      `All RPC endpoints exhausted for wallet ${address}`,
    );
    return [];
  }

  /**
   * Lấy transaction từ Solana Block Explorer API (Solscan) - chỉ USDT SPL token transfers
   * @param address - Địa chỉ ví
   * @param usdtMintAddress - USDT mint address
   * @param limit - Số lượng transaction tối đa (mặc định: 100)
   */
  private async getSolanaTransactionsFromExplorer(
    address: string,
    usdtMintAddress: string,
    limit: number = 100,
  ): Promise<OnchainTransaction[]> {
    try {
      if (!usdtMintAddress) {
        this.logger.warn('USDT mint address not provided, skipping Solana Block Explorer API');
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
        'Accept': 'application/json',
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

  /**
   * Lấy transaction từ EVM chains (ETH, BNB) - chỉ USDT ERC20 token transfers
   * Note: Standard JSON-RPC không hỗ trợ lấy transaction history trực tiếp
   * Trong production, nên sử dụng block explorer API (Etherscan, BscScan) hoặc indexer service
   * @param address - Địa chỉ ví
   * @param network - Network object
   * @param blockCount - Số block cần scan (mặc định: 100)
   * @param maxTransactions - Số lượng transaction tối đa cần lấy (mặc định: không giới hạn)
   * @param usdtContractAddress - USDT contract address (chỉ lấy transfers của token này)
   */
  private async getEVMTransactions(
    address: string,
    network: Network,
    blockCount: number = 100,
    maxTransactions?: number,
    usdtContractAddress?: string,
  ): Promise<OnchainTransaction[]> {
    const rpcUrls = await this.adminSettingsConfigService.getRpcUrlsToTryByNetwork(
      network.net_symbol,
    );
    if (!rpcUrls.length) {
      throw new Error(`RPC endpoint not configured for ${network.net_symbol}`);
    }

    if (!usdtContractAddress) {
      this.logger.warn('USDT contract address not provided, skipping EVM transactions');
      return [];
    }

    let provider = null;
    for (const rpcUrl of rpcUrls) {
      provider = await this.createSafeJsonRpcProvider(rpcUrl, network.net_symbol);
      if (provider) break;
    }
    if (!provider) {
      this.logger.warn(
        `Failed to create JsonRpcProvider for ${network.net_symbol} after trying all RPC URLs. Please check your RPC configuration.`,
      );
      return [];
    }

    const transactions: OnchainTransaction[] = [];

    // ERC20 Transfer event signature: Transfer(address,address,uint256)
    const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const usdtContractLower = usdtContractAddress.toLowerCase();

    try {
      const currentBlock = await provider.getBlockNumber();
      const startBlock = Math.max(0, currentBlock - blockCount);

      // Scan blocks từ mới đến cũ, dừng sớm nếu đã đủ số lượng transaction
      for (let blockNum = currentBlock; blockNum >= startBlock; blockNum--) {
        // Kiểm tra nếu đã đủ số lượng transaction cần thiết
        if (maxTransactions && transactions.length >= maxTransactions) {
          break;
        }

        try {
          const block = await provider.getBlock(blockNum, true);
          if (!block || !block.transactions) continue;

          // Xử lý song song các transaction trong block
          const txPromises = block.transactions
            .filter((txHash): txHash is string => typeof txHash === 'string')
            .slice(0, 10) // Giới hạn 10 transaction mỗi block để tránh quá tải
            .map(async (txHash): Promise<OnchainTransaction | null> => {
              // Kiểm tra lại limit trước mỗi transaction
              if (maxTransactions && transactions.length >= maxTransactions) {
                return null;
              }

              try {
                const tx = await provider.getTransaction(txHash);
                const receipt = await provider.getTransactionReceipt(txHash);
                
                // Chỉ xử lý transaction thành công và có logs (ERC20 transfers)
                if (!tx || !receipt || receipt.status !== 1 || !receipt.logs || receipt.logs.length === 0) {
                  return null;
                }

                // Kiểm tra logs để tìm USDT Transfer events
                for (const log of receipt.logs) {
                  // Kiểm tra xem log có phải từ USDT contract không
                  if (log.address.toLowerCase() !== usdtContractLower) {
                    continue;
                  }

                  // Kiểm tra xem có phải Transfer event không (topic[0] = Transfer signature)
                  if (log.topics[0] !== transferEventSignature || log.topics.length !== 3) {
                    continue;
                  }

                  // Parse Transfer event: Transfer(address from, address to, uint256 value)
                  // topic[1] = from (padded), topic[2] = to (padded), data = value
                  const toAddress = '0x' + log.topics[2].slice(-40); // Lấy 20 bytes cuối (address)
                  
                  // Kiểm tra xem có phải transfer vào address này không
                  if (toAddress.toLowerCase() !== address.toLowerCase()) {
                    continue;
                  }

                  // Parse amount từ data (uint256)
                  const amount = BigInt(log.data);
                  const amountFormatted = parseFloat(formatUnits(amount, 6)); // USDT có 6 decimals

                  if (amountFormatted > 0) {
                    return {
                      hash: txHash,
                      amount: amountFormatted,
                      timestamp: new Date((block.timestamp || 0) * 1000),
                      from: '0x' + log.topics[1].slice(-40), // from address
                      to: toAddress,
                    } as OnchainTransaction;
                  }
                }
              } catch (error) {
                // Skip transaction nếu có lỗi
                return null;
              }
              return null;
            });

          const txResults = await Promise.all(txPromises);
          const validTransactions = txResults.filter(
            (tx): tx is OnchainTransaction => tx !== null,
          );
          transactions.push(...validTransactions);

          // Kiểm tra lại sau khi push
          if (maxTransactions && transactions.length >= maxTransactions) {
            break;
          }
        } catch (error) {
          // Skip block nếu có lỗi
          continue;
        }
      }
    } catch (error) {
      this.logger.error(`Error fetching EVM transactions: ${error.message}`);
    }

    return transactions;
  }

  /**
   * Lấy transaction từ Zerion API - chỉ USDT ERC20 token transfers cho ETH và BSC
   * @param address - Địa chỉ ví
   * @param network - Network object (ETH hoặc BNB)
   * @param usdtContractAddress - USDT contract address (chỉ lấy transfers của token này)
   * @returns Danh sách transaction
   */
  private async getEVMTransactionsFromZerion(
    address: string,
    network: Network,
    usdtContractAddress?: string,
  ): Promise<OnchainTransaction[]> {
    try {
      if (network.net_symbol !== 'ETH' && network.net_symbol !== 'BNB') {
        throw new Error(`Zerion API only supports ETH and BNB networks`);
      }

      if (!usdtContractAddress) {
        this.logger.warn('USDT contract address not provided, skipping Zerion API');
        return [];
      }

      // Zerion API key: admin_settings (as_config_zerion_key) hoặc .env ZERION_API_KEY
      const apiKey = await this.adminSettingsConfigService.getEffectiveZerionKey();
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error('ZERION_API_KEY is not configured (admin_settings or .env)');
      }

      // Transform API key for Basic Auth (base64 encode)
      const apiKeyTransformed = Buffer.from(`${apiKey}:`).toString('base64');

      // Xác định chain ID cho Zerion API
      // ETH = ethereum, BSC = binance-smart-chain
      const chainId = network.net_symbol === 'ETH' ? 'ethereum' : 'binance-smart-chain';

      // Zerion API endpoint để lấy transactions (cần trailing slash)
      const apiUrl = `https://api.zerion.io/v1/wallets/${address}/transactions/`;

      this.logger.debug(
        `Fetching transactions from Zerion API for ${address} on ${network.net_symbol} (chain: ${chainId})`,
      );

      // Rate limiting: đảm bảo không vượt quá 7 requests/1s
      await this.waitForZerionApiRateLimit();

      let response;
      try {
        response = await axios.get(apiUrl, {
          headers: {
            Authorization: `Basic ${apiKeyTransformed}`, // Dùng Basic auth như curl example
            Accept: 'application/json',
          },
          timeout: 30000,
        });
        
        // Update last request time sau khi request thành công
        this.zerionApiLastRequestTime = Date.now();
      } catch (axiosError: any) {
        // Log chi tiết response error để debug
        if (axiosError.response) {
          this.logger.error(
            `Zerion API error response for ${address} on ${network.net_symbol}: Status ${axiosError.response.status}, Data: ${JSON.stringify(axiosError.response.data)}`,
          );
        }
        throw axiosError;
      }

      const transactions: OnchainTransaction[] = [];

      // Parse response từ Zerion API
      // Response structure: { data: [{ type: "transactions", attributes: {...}, relationships: { chain: {...} } }] }
      // Response là đa chuỗi, cần filter theo chain và USDT contract
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        const allTransactions = response.data.data;

        this.logger.debug(
          `Zerion API returned ${allTransactions.length} total transactions (multi-chain) for ${address}`,
        );

        // Filter transactions theo chain và USDT contract
        for (const tx of allTransactions) {
          // Kiểm tra chain từ relationships
          const txChainId = tx.relationships?.chain?.data?.id;
          if (txChainId !== chainId) {
            continue;
          }

          const attributes = tx.attributes || {};
          
          // Kiểm tra transfers trong attributes
          if (attributes.transfers && Array.isArray(attributes.transfers)) {
            for (const transfer of attributes.transfers) {
              // Chỉ lấy incoming transfers
              if (transfer.direction !== 'in') {
                continue;
              }

              // Kiểm tra recipient phải là address này
              if (
                !transfer.recipient ||
                transfer.recipient.toLowerCase() !== address.toLowerCase()
              ) {
                continue;
              }

              // Kiểm tra xem có phải USDT transfer không
              // Tìm trong fungible_info.implementations để match contract address
              const fungibleInfo = transfer.fungible_info;
              if (fungibleInfo && fungibleInfo.implementations) {
                const usdtImplementation = fungibleInfo.implementations.find(
                  (impl: any) =>
                    impl.chain_id === chainId &&
                    impl.address &&
                    impl.address.toLowerCase() === usdtContractAddress.toLowerCase(),
                );

                if (usdtImplementation && transfer.quantity && transfer.quantity.float > 0) {
                  const amount = transfer.quantity.float; // Đã được format sẵn
                  
                  transactions.push({
                    hash: attributes.hash || '',
                    amount: amount,
                    timestamp: new Date(attributes.mined_at || Date.now()),
                    from: transfer.sender || attributes.sent_from || '',
                    to: transfer.recipient || address,
                  });

                  this.logger.log(
                    `Found USDT transfer: ${amount} USDT, tx: ${attributes.hash}, from: ${transfer.sender}, to: ${transfer.recipient}`,
                  );
                }
              }
            }
          }
        }

        this.logger.debug(
          `Filtered ${transactions.length} USDT transactions for ${address} on ${network.net_symbol} from ${allTransactions.length} total transactions`,
        );
      } else {
        // Log response structure để debug nếu không đúng format
        this.logger.warn(
          `Unexpected Zerion API response structure for ${address}: ${JSON.stringify(response.data).substring(0, 500)}`,
        );
      }

      this.logger.log(
        `Zerion API returned ${transactions.length} USDT transactions for ${address} on ${network.net_symbol}`,
      );

      return transactions;
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log chi tiết hơn để debug
      if (error.response) {
        this.logger.error(
          `Zerion API failed for ${address} on ${network.net_symbol}: Status ${error.response.status}, Response: ${JSON.stringify(error.response.data)}`,
        );
      } else {
        this.logger.error(
          `Zerion API failed for ${address} on ${network.net_symbol}: ${errorMessage}`,
        );
      }
      throw error;
    }
  }

  /**
   * Lấy transaction từ Block Explorer API (Etherscan, BscScan) - chỉ USDT ERC20 token transfers
   * @deprecated Sử dụng Zerion API thay thế
   * @param address - Địa chỉ ví
   * @param network - Network object
   * @param startBlock - Block bắt đầu (optional)
   * @param endBlock - Block kết thúc (optional)
   * @param usdtContractAddress - USDT contract address (chỉ lấy transfers của token này)
   * @returns Danh sách transaction
   */
  private async getEVMTransactionsFromExplorer(
    address: string,
    network: Network,
    startBlock?: number,
    endBlock?: number,
    usdtContractAddress?: string,
  ): Promise<OnchainTransaction[]> {
    try {
      // Etherscan API V2: Unified multichain API
      // Base URL: https://api.etherscan.io/v2/api
      // Chain IDs: ETH = 1, BSC = 56
      const apiUrl = 'https://api.etherscan.io/v2/api';
      let chainId: number;
      let apiKey: string;

      if (network.net_symbol === 'ETH') {
        chainId = 1; // Ethereum Mainnet
        apiKey =
          this.configService.get<string>('ETHERSCAN_API_KEY') || 'YourApiKeyToken';
      } else if (network.net_symbol === 'BNB') {
        chainId = 56; // BSC Mainnet
        apiKey =
          this.configService.get<string>('BSCSCAN_API_KEY') || 'YourApiKeyToken';
      } else {
        throw new Error(`Block Explorer API not supported for ${network.net_symbol}`);
      }

      const transactions: OnchainTransaction[] = [];
      let page = 1;
      const pageSize = 10000; // Max transactions per page
      let hasMore = true;

      if (!usdtContractAddress) {
        this.logger.warn('USDT contract address not provided, skipping Block Explorer API');
        return [];
      }

      this.logger.debug(
        `Using Etherscan API V2 for ${network.net_symbol} (chainid=${chainId})`,
      );

      // Lấy tất cả ERC20 token transfers với pagination (chỉ USDT)
      while (hasMore) {
        const params: any = {
          chainid: chainId, // V2: Required chain ID parameter
          module: 'account',
          action: 'tokentx', // Lấy ERC20 token transfers thay vì native token transfers
          contractaddress: usdtContractAddress, // Chỉ lấy USDT transfers
          address: address,
          startblock: startBlock || 0,
          endblock: endBlock || 99999999,
          page: page,
          offset: pageSize,
          sort: 'asc', // Từ cũ đến mới
          apikey: apiKey,
        };

        const response = await axios.get(apiUrl, { params, timeout: 30000 });

        // Xử lý các trường hợp lỗi từ API
        if (response.data.status === '0') {
          const errorMessage = response.data.message || 'Unknown error';
          
          // Kiểm tra các lỗi phổ biến
          if (errorMessage.includes('Invalid API Key') || 
              errorMessage.includes('api key') ||
              errorMessage.toLowerCase().includes('invalid')) {
            throw new Error(`Invalid API Key for ${network.net_symbol}: ${errorMessage}`);
          }
          
          if (errorMessage.includes('rate limit') || 
              errorMessage.includes('Max rate limit')) {
            throw new Error(`Rate limit exceeded for ${network.net_symbol}: ${errorMessage}`);
          }
          
          if (errorMessage === 'No transactions found') {
            // Không có transaction là trường hợp bình thường, không phải lỗi
            hasMore = false;
            continue;
          }
          
          // Các lỗi khác
          throw new Error(`Block Explorer API error for ${network.net_symbol}: ${errorMessage}`);
        }

        if (response.data.status === '1' && response.data.result) {
          const txList = Array.isArray(response.data.result)
            ? response.data.result
            : [];

          // Filter chỉ lấy transaction nạp tiền USDT (to address = wallet address, value > 0)
          // tokentx API trả về field 'to' là receiver address và 'value' là token amount
          for (const tx of txList) {
            if (
              tx.to &&
              tx.to.toLowerCase() === address.toLowerCase() &&
              tx.contractAddress &&
              tx.contractAddress.toLowerCase() === usdtContractAddress.toLowerCase() &&
              parseInt(tx.value) > 0 &&
              tx.txreceipt_status === '1' // Transaction thành công
            ) {
              // USDT có 6 decimals trên hầu hết các chain
              const decimals = parseInt(tx.tokenDecimal) || 6;
              transactions.push({
                hash: tx.hash,
                amount: parseFloat(formatUnits(tx.value, decimals)),
                timestamp: new Date(parseInt(tx.timeStamp) * 1000),
                from: tx.from,
                to: tx.to,
              });
            }
          }

          // Kiểm tra xem còn transaction không
          if (txList.length < pageSize) {
            hasMore = false;
          } else {
            page++;
            // Giới hạn tối đa 10 pages để tránh quá tải (100,000 transactions)
            if (page > 10) {
              hasMore = false;
            }
          }
        } else if (response.data.status === '0') {
          // Không có transaction hoặc lỗi
          if (response.data.message === 'No transactions found') {
            hasMore = false;
          } else {
            throw new Error(
              `Block Explorer API error: ${response.data.message}`,
            );
          }
        } else {
          throw new Error(`Unexpected API response: ${JSON.stringify(response.data)}`);
        }

        // Rate limit: Đợi 200ms giữa các request để tránh vượt quá 5 calls/second
        if (hasMore) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      return transactions;
    } catch (error) {
      // Xử lý các lỗi từ axios (network errors, timeout, etc.)
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // API trả về lỗi HTTP
          throw new Error(
            `Block Explorer API HTTP error (${error.response.status}): ${error.response.statusText}`,
          );
        } else if (error.request) {
          // Không nhận được response (network error)
          throw new Error(
            `Block Explorer API network error: No response received. Please check your internet connection or API endpoint.`,
          );
        } else {
          // Lỗi khi setup request
          throw new Error(`Block Explorer API request error: ${error.message}`);
        }
      }
      
      // Re-throw các lỗi đã được xử lý ở trên
      throw error;
    }
  }

  /**
   * Đối chiếu và bổ sung transaction còn thiếu vào database
   */
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
    const newTransactionHashes = new Set(missingTransactions.map((tx) => tx.hash));
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
        const userWalletNetwork = await this.useWalletNetworkRepository.findOne({
          where: {
            uwn_user_id: tracker.awt_user_id,
            uwn_network_id: network.net_id,
          },
        });

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
          const updatedHashes = new Set(recordsWithNullNode.map((tx) => tx.wh_hash).filter((h) => h !== null));
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
            await this.walletDepositTrackerRepository.save(existingDepositTracker);
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
      // 1. Lấy coin USDT
      const usdtCoin = await this.coinRepository.findOne({
        where: { coin_id: coinId },
      });

      if (!usdtCoin) {
        this.logger.warn('USDT coin not found');
        return;
      }

      // 1.5. Lấy USDT mint/contract address từ coin_networks
      const usdtCoinNetwork = await this.coinNetworkRepository.findOne({
        where: {
          cn_coin_id: usdtCoin.coin_id,
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
      });

      if (!usdtCoinNetwork || !usdtCoinNetwork.cn_coin_mint) {
        this.logger.warn(
          `USDT not configured for network ${network.net_symbol} or missing mint/contract address`,
        );
        return;
      }

      const usdtMintOrContract = usdtCoinNetwork.cn_coin_mint;

      // 2. Lấy transaction từ cache hoặc file (chỉ USDT)
      let cachedTransactions = await this.getCachedTransactions(
        tracker.awt_address,
        network,
        usdtMintOrContract,
      );

      // 3. Đối chiếu cache với wallet_histories để kiểm tra xung đột
      const conflictCheck = await this.checkCacheConflict(
        tracker,
        cachedTransactions,
        usdtCoin.coin_id,
        network,
      );

      let finalTransactions: OnchainTransaction[];

      if (conflictCheck.hasConflict) {
        // 4a. Có xung đột: Lắng nghe lại toàn bộ lịch sử ví (chỉ USDT)
        this.logger.warn(
          `Conflict detected for ${tracker.awt_address}, fetching full USDT history`,
        );
        finalTransactions = await this.getAllOnchainTransactions(
          tracker.awt_address,
          network,
          usdtMintOrContract,
        );
      } else {
        // 4b. Không có xung đột: Lắng nghe 100 block mới nhất (chỉ USDT)
        const newTransactions = await this.getRecentOnchainTransactions(
          tracker.awt_address,
          network,
          100,
          usdtMintOrContract,
        );

        // Merge với cache (loại bỏ duplicate)
        const existingHashes = new Set(
          cachedTransactions.map((tx) => tx.hash),
        );
        const uniqueNewTransactions = newTransactions.filter(
          (tx) => !existingHashes.has(tx.hash),
        );

        finalTransactions = [...cachedTransactions, ...uniqueNewTransactions];
      }

      // 5. Lưu vào cache (30 ngày) và file (vĩnh viễn)
      await this.saveTransactionsToCacheAndFile(
        tracker.awt_address,
        network,
        finalTransactions,
      );

      // 6. Đối chiếu và bổ sung transaction còn thiếu vào database
      await this.syncTransactions(
        tracker,
        finalTransactions,
        network,
        usdtCoin.coin_id,
      );

      // 7. Cập nhật balance
      await this.updateUserBalance(tracker.awt_user_id, usdtCoin.coin_id);
    } catch (error) {
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
      let newBalance = totalDeposit + totalReward - totalStaking - totalWithdraw;
      
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
      // Nếu không cần update, bỏ qua
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
  async updateUserBalance(userId: number, coinId: number): Promise<void> {
    // Sử dụng hàm chung để cập nhật balance
    await this.updateUserBalanceIfChanged(userId, coinId);
  }

  /**
   * Kiểm tra số dư USDT từ RPC và so sánh với wallet_histories
   * @returns { balanceMatch: boolean, onchainBalance: number, dbBalance: number }
   */
  private async checkWalletBalance(
    tracker: ActiveWalletTracker,
    network: Network,
    coinId: number,
    usdtMintOrContract: string,
  ): Promise<{ balanceMatch: boolean; onchainBalance: number; dbBalance: number }> {
    try {
      // 1. Lấy số dư USDT từ RPC
      const onchainBalance = await this.getUSDTBalanceFromRPC(
        tracker.awt_address,
        network,
        usdtMintOrContract,
      );

      // 2. Tính tổng deposit - admin-deposit từ wallet_histories
      const dbBalance = await this.calculateDepositBalance(
        tracker.awt_user_id,
        coinId,
        network,
      );

      // 3. So sánh (cho phép sai số nhỏ do làm tròn)
      const tolerance = 0.00000001;
      const balanceMatch = Math.abs(onchainBalance - dbBalance) <= tolerance;

      return {
        balanceMatch,
        onchainBalance,
        dbBalance,
      };
    } catch (error) {
      // Nếu lỗi khi lấy số dư từ RPC, coi như không khớp để tiếp tục fetch onchain
      this.logger.error(
        `Error checking wallet balance for ${tracker.awt_address} on ${network.net_symbol}: ${error.message}`,
      );
      return {
        balanceMatch: false,
        onchainBalance: 0,
        dbBalance: 0,
      };
    }
  }

  /**
   * Lấy số dư USDT từ RPC cho từng mạng
   */
  private async getUSDTBalanceFromRPC(
    address: string,
    network: Network,
    usdtMintOrContract: string,
  ): Promise<number> {
    try {
      if (network.net_symbol === 'SOL') {
        const primaryUrls = await this.adminSettingsConfigService.getRpcSolUrlsToTry();
        if (!primaryUrls.length) {
          throw new Error('SOLANA_RPC_URL is not configured');
        }
        const fallbackRpcUrls = [
          'https://api.mainnet-beta.solana.com',
          'https://solana-api.projectserum.com',
        ];
        const primarySet = new Set(primaryUrls.map(WalletsSchedulerService.normalizeRpcUrl));
        const extraFallbacks = fallbackRpcUrls.filter(
          (f) => !primarySet.has(WalletsSchedulerService.normalizeRpcUrl(f)),
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
              const tokenAccountInfo = await connection.getTokenAccountBalance(
                tokenAccount,
              );
              // USDT trên Solana có 6 decimals
              const balance = parseFloat(tokenAccountInfo.value.uiAmountString || '0');
              
              if (!isPrimary) {
                this.logger.log(
                  `Successfully got USDT balance using fallback RPC for ${address} on SOL`,
                );
              }
              
              return balance;
            } catch (error: any) {
              // Token account không tồn tại = balance = 0
              if (error?.message?.includes('InvalidAccountData') || 
                  error?.message?.includes('could not find account') ||
                  error?.message?.includes('Invalid public key')) {
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
      } else if (network.net_symbol === 'ETH' || network.net_symbol === 'BNB') {
        const rpcUrls = await this.adminSettingsConfigService.getRpcUrlsToTryByNetwork(
          network.net_symbol,
        );
        if (!rpcUrls.length) {
          throw new Error(`RPC_${network.net_symbol} is not configured`);
        }

        let provider = null;
        for (const rpcUrl of rpcUrls) {
          provider = await this.createSafeJsonRpcProvider(rpcUrl, network.net_symbol);
          if (provider) break;
        }
        if (!provider) {
          throw new Error(`Failed to create RPC provider for ${network.net_symbol}`);
        }

        // ERC20 balanceOf ABI
        const erc20Abi = [
          'function balanceOf(address account) view returns (uint256)',
          'function decimals() view returns (uint8)',
        ];

        const { Contract, getAddress } = await import('ethers');
        
        // Normalize addresses để tránh lỗi checksum
        // getAddress() yêu cầu address phải có checksum đúng hoặc lowercase
        // Nếu address có checksum sai, convert về lowercase trước rồi normalize
        let normalizedContractAddress: string;
        let normalizedWalletAddress: string;
        
        try {
          // Thử normalize trực tiếp
          normalizedContractAddress = getAddress(usdtMintOrContract);
        } catch (error) {
          // Nếu fail, convert về lowercase rồi normalize
          normalizedContractAddress = getAddress(usdtMintOrContract.toLowerCase());
        }
        
        try {
          normalizedWalletAddress = getAddress(address);
        } catch (error) {
          normalizedWalletAddress = getAddress(address.toLowerCase());
        }
        
        const tokenContract = new Contract(normalizedContractAddress, erc20Abi, provider);

        // Lấy decimals
        let decimals = 18; // Default
        try {
          decimals = await tokenContract.decimals();
        } catch (error) {
          // USDT trên BSC có 18 decimals, trên ETH có 6 decimals
          decimals = network.net_symbol === 'BNB' ? 18 : 6;
        }

        // Lấy balance
        const balance = await tokenContract.balanceOf(normalizedWalletAddress);
        return parseFloat(formatUnits(balance, decimals));
      } else {
        throw new Error(`Unsupported network: ${network.net_symbol}`);
      }
    } catch (error) {
      this.logger.error(
        `Error getting USDT balance from RPC for ${address} on ${network.net_symbol}: ${error.message}`,
      );
      throw error;
    }
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

      // Trả về deposit - admin-deposit
      return totalDeposit - totalAdminDeposit;
    } catch (error) {
      this.logger.error(
        `Error calculating deposit balance for user ${userId} on ${network.net_symbol}: ${error.message}`,
      );
      return 0;
    }
  }

  /**
   * Rate limiter cho Zerion API: đảm bảo không vượt quá 7 requests/1s
   */
  private async waitForZerionApiRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.zerionApiLastRequestTime;
    
    // Nếu chưa đủ thời gian giữa các requests, đợi thêm
    if (timeSinceLastRequest < this.ZERION_API_MIN_INTERVAL_MS) {
      const waitTime = this.ZERION_API_MIN_INTERVAL_MS - timeSinceLastRequest;
      this.logger.debug(
        `Zerion API rate limit: waiting ${waitTime}ms before next request`,
      );
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Update last request time
    this.zerionApiLastRequestTime = Date.now();
  }
}

