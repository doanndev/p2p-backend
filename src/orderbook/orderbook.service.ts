import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import {
  OrderBook,
  OrderBookOption,
  OrderBookStatus,
} from './entities/order-book.entity';
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import { User } from '../users/entities/user.entity';
import { Coin } from '../settings/entities/coin.entity';
import { CreateOrderbookDto } from './dto/create-orderbook.dto';
import { UpdateOrderbookDto } from './dto/update-orderbook.dto';
import { QueryMyOrderbooksDto, QueryOrderbooksDto } from './dto/query.dto';
import { SettingBankOrder } from './entities/setting-bank-order.entity';
import { BankUser } from '../users/entities/bank-user.entity';
import { BankUserApprovalStatus } from '../users/entities/bank-user-approval-status';
import { AdminSettingsConfigService } from '../settings/admin-settings-config.service';
import { NationalCurrency } from './entities/national-currency.entity';
import {
  Transaction,
  TransactionOption,
  TransactionStatus,
} from './entities/transaction.entity';
import { SmartRefService } from '../smart-ref/smart-ref.service';
import { EmailService } from '../systems/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../users/entities/notification.entity';
import { DEFAULT_ORDERBOOK_PER_TRANSACTION_AMOUNT_MIN } from './orderbook.constants';
import {
  apiDecimal,
  apiDecimalOrNull,
} from '../common/helpers/decimal-api.util';
/** Max coin (USDT) buy exposure per user level — “Max Limit” in buy-limit formula. */
const BUYER_MAX_COIN_LIMIT_BY_LEVEL: Record<number, number> = {
  1: 1000,
  2: 5000,
  3: 10000,
  4: 30000,
};

type CreatorTransactionReputation = {
  total_transactions: number;
  successful_transactions: number;
  failed_transactions: number;
};

@Injectable()
export class OrderbookService {
  private readonly logger = new Logger(OrderbookService.name);

  constructor(
    @InjectRepository(OrderBook)
    private readonly orderBookRepository: Repository<OrderBook>,
    @InjectRepository(UserWallet)
    private readonly userWalletRepository: Repository<UserWallet>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(SettingBankOrder)
    private readonly settingBankOrderRepository: Repository<SettingBankOrder>,
    @InjectRepository(BankUser)
    private readonly bankUserRepository: Repository<BankUser>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly dataSource: DataSource,
    private readonly adminSettingsConfigService: AdminSettingsConfigService,
    private readonly smartRefService: SmartRefService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private toNumber(value: string | number): number {
    return typeof value === 'number' ? value : Number(value);
  }

  private formatAmount(value: number): string {
    return value.toFixed(8);
  }

  /** JSON API: numeric fields instead of decimal strings from PostgreSQL. */
  private apiOrderBookAmountFields(ob: OrderBook) {
    return {
      amount: apiDecimal(ob.ob_amount),
      amount_remaining: apiDecimal(ob.ob_amount_remaining),
      price: apiDecimal(ob.ob_price),
      national_min: apiDecimalOrNull(ob.ob_national_min),
      national_max: apiDecimalOrNull(ob.ob_national_max),
    };
  }

  /**
   * Per-transaction coin bounds on orderbook; both optional.
   * If both set, min must be <= max.
   */
  private assertPerTransactionAmountBounds(
    min?: number | null,
    max?: number | null,
  ): void {
    if (
      min != null &&
      max != null &&
      !Number.isNaN(min) &&
      !Number.isNaN(max) &&
      min > max
    ) {
      throw new BadRequestException(
        'nationalMin cannot be greater than nationalMax',
      );
    }
    const effectiveFloor =
      min != null && !Number.isNaN(min)
        ? min
        : DEFAULT_ORDERBOOK_PER_TRANSACTION_AMOUNT_MIN;
    if (max != null && !Number.isNaN(max) && max < effectiveFloor) {
      throw new BadRequestException(
        'nationalMax cannot be less than the minimum per-transaction amount (nationalMin, or 10 if nationalMin is unset)',
      );
    }
  }

  private getBuyerMaxCoinLimitByLevel(level: number): number {
    return (
      BUYER_MAX_COIN_LIMIT_BY_LEVEL[level] ?? BUYER_MAX_COIN_LIMIT_BY_LEVEL[1]
    );
  }

  /**
   * Available buy coin (QC) budget for creating BUY orderbooks:
   * MaxLimit − [Σ ob_amount_remaining on own BUY ads still pending
   *            + Σ trans_amount where user is buyer, matching, last 24h, excluding txs tied to own BUY OB]
   *
   * (Algebraically, Σ ob_amount − executed − failed on BUY equals Σ ob_amount for pending rows only, but that
   * uses original size; `ob_amount_remaining` matches “phần còn treo” after partial fills.)
   */
  private async computeBuyerAvailableCoinBudget(
    manager: EntityManager,
    userId: number,
    maxLimitCoin: number,
  ): Promise<{ available: number; used: number }> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const orderbookAgg = await manager
      .createQueryBuilder(OrderBook, 'ob')
      .select(
        'COALESCE(SUM(CAST(ob.ob_amount_remaining AS numeric)), 0)',
        'open_buy_ob_coin',
      )
      .where('ob.ob_user_id = :userId', { userId })
      .andWhere('ob.ob_option = :buyOpt', { buyOpt: OrderBookOption.BUY })
      .andWhere('ob.ob_status = :pending', {
        pending: OrderBookStatus.PENDING,
      })
      .getRawOne<{ open_buy_ob_coin: string | number | null }>();

    const openBuyObCoin = Number(orderbookAgg?.open_buy_ob_coin ?? 0);

    const takerBuyRaw = await manager
      .createQueryBuilder(Transaction, 't')
      .leftJoin(OrderBook, 'linkedOb', 'linkedOb.ob_id = t.trans_order_book')
      .select('COALESCE(SUM(CAST(t.trans_amount AS numeric)), 0)', 'total')
      .where('t.trans_user_buy = :userId', { userId })
      .andWhere('t.trans_created_at >= :since24h', { since24h })
      .andWhere('t.trans_status IN (:...matching)', {
        matching: [
          TransactionStatus.PENDING,
          TransactionStatus.PAYMENT_CONFIRMED,
        ],
      })
      .andWhere(
        '(linkedOb.ob_id IS NULL OR linkedOb.ob_option <> :buyOpt OR linkedOb.ob_user_id <> :userId)',
        { buyOpt: OrderBookOption.BUY, userId },
      )
      .getRawOne<{ total: string | number | null }>();

    const takerBuyMatching24h = Number(takerBuyRaw?.total ?? 0);

    const used = openBuyObCoin + takerBuyMatching24h;
    const available = Math.max(0, maxLimitCoin - used);
    return { available, used };
  }

  private generateAdvCode(): string {
    return `ADV-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  private toPublicUser(user: User | null | undefined) {
    if (!user) return null;
    return {
      id: user.uid,
      username: user.uname,
      fullName: user.ufulllname,
      avatar: user.uavatar,
    };
  }

  private toBankUserResponse(bankUser: BankUser | null | undefined) {
    if (!bankUser) return null;
    return {
      id: bankUser.bu_id,
      userId: bankUser.bu_user_id,
      bankName: bankUser.bu_bank_name,
      bankBranch: bankUser.bu_bank_branch,
      bankAccountName: bankUser.bu_bank_account_name,
      bankAccountNumber: bankUser.bu_bank_account_number,
    };
  }

  private emptyCreatorTransactionReputation(): CreatorTransactionReputation {
    return {
      total_transactions: 0,
      successful_transactions: 0,
      failed_transactions: 0,
    };
  }

  private parseReputationRow(row: {
    total_transactions: string | number | null;
    successful_transactions: string | number | null;
    failed_transactions: string | number | null;
  }): CreatorTransactionReputation {
    return {
      total_transactions: Number(row.total_transactions) || 0,
      successful_transactions: Number(row.successful_transactions) || 0,
      failed_transactions: Number(row.failed_transactions) || 0,
    };
  }

  /** Transaction reputation for the orderbook creator (all matching txs, not scoped to this ob_id). */
  private async getCreatorTransactionReputation(
    creatorUserId: number,
    orderBookOption: OrderBookOption,
  ): Promise<CreatorTransactionReputation> {
    if (orderBookOption === OrderBookOption.SELL) {
      const raw = await this.transactionRepository
        .createQueryBuilder('t')
        .select(
          `SUM(CASE WHEN t.trans_status IN (:exec, :fail) THEN 1 ELSE 0 END)`,
          'total_transactions',
        )
        .addSelect(
          `SUM(CASE WHEN t.trans_status = :exec THEN 1 ELSE 0 END)`,
          'successful_transactions',
        )
        .addSelect(
          `SUM(CASE WHEN t.trans_status = :fail THEN 1 ELSE 0 END)`,
          'failed_transactions',
        )
        .where('t.trans_option = :buyOpt', { buyOpt: TransactionOption.BUY })
        .andWhere('t.trans_user_sell = :uid', { uid: creatorUserId })
        .setParameters({
          exec: TransactionStatus.EXECUTED,
          fail: TransactionStatus.FAILED,
        })
        .getRawOne<{
          total_transactions: string | number | null;
          successful_transactions: string | number | null;
          failed_transactions: string | number | null;
        }>();
      return raw
        ? this.parseReputationRow(raw)
        : this.emptyCreatorTransactionReputation();
    }

    const raw = await this.transactionRepository
      .createQueryBuilder('t')
      .select(
        `SUM(CASE WHEN t.trans_status IN (:exec, :fail) THEN 1 ELSE 0 END)`,
        'total_transactions',
      )
      .addSelect(
        `SUM(CASE WHEN t.trans_status = :exec THEN 1 ELSE 0 END)`,
        'successful_transactions',
      )
      .addSelect(
        `SUM(CASE WHEN t.trans_status = :fail THEN 1 ELSE 0 END)`,
        'failed_transactions',
      )
      .where('t.trans_option = :sellOpt', { sellOpt: TransactionOption.SELL })
      .andWhere('t.trans_user_buy = :uid', { uid: creatorUserId })
      .setParameters({
        exec: TransactionStatus.EXECUTED,
        fail: TransactionStatus.FAILED,
      })
      .getRawOne<{
        total_transactions: string | number | null;
        successful_transactions: string | number | null;
        failed_transactions: string | number | null;
      }>();
    return raw
      ? this.parseReputationRow(raw)
      : this.emptyCreatorTransactionReputation();
  }

  private async buildCreatorTransactionReputationMaps(
    rows: OrderBook[],
  ): Promise<{
    sellCreators: Map<number, CreatorTransactionReputation>;
    buyCreators: Map<number, CreatorTransactionReputation>;
  }> {
    const sellUserIds = [
      ...new Set(
        rows
          .filter((r) => r.ob_option === OrderBookOption.SELL)
          .map((r) => r.ob_user_id),
      ),
    ];
    const buyUserIds = [
      ...new Set(
        rows
          .filter((r) => r.ob_option === OrderBookOption.BUY)
          .map((r) => r.ob_user_id),
      ),
    ];

    const [sellRaw, buyRaw] = await Promise.all([
      sellUserIds.length
        ? this.transactionRepository
            .createQueryBuilder('t')
            .select('t.trans_user_sell', 'userId')
            .addSelect(
              `SUM(CASE WHEN t.trans_status IN (:exec, :fail) THEN 1 ELSE 0 END)`,
              'total_transactions',
            )
            .addSelect(
              `SUM(CASE WHEN t.trans_status = :exec THEN 1 ELSE 0 END)`,
              'successful_transactions',
            )
            .addSelect(
              `SUM(CASE WHEN t.trans_status = :fail THEN 1 ELSE 0 END)`,
              'failed_transactions',
            )
            .where('t.trans_option = :buyOpt', {
              buyOpt: TransactionOption.BUY,
            })
            .andWhere('t.trans_user_sell IN (:...uids)', { uids: sellUserIds })
            .groupBy('t.trans_user_sell')
            .setParameters({
              exec: TransactionStatus.EXECUTED,
              fail: TransactionStatus.FAILED,
            })
            .getRawMany<{
              userId: string;
              total_transactions: string | number | null;
              successful_transactions: string | number | null;
              failed_transactions: string | number | null;
            }>()
        : [],
      buyUserIds.length
        ? this.transactionRepository
            .createQueryBuilder('t')
            .select('t.trans_user_buy', 'userId')
            .addSelect(
              `SUM(CASE WHEN t.trans_status IN (:exec, :fail) THEN 1 ELSE 0 END)`,
              'total_transactions',
            )
            .addSelect(
              `SUM(CASE WHEN t.trans_status = :exec THEN 1 ELSE 0 END)`,
              'successful_transactions',
            )
            .addSelect(
              `SUM(CASE WHEN t.trans_status = :fail THEN 1 ELSE 0 END)`,
              'failed_transactions',
            )
            .where('t.trans_option = :sellOpt', {
              sellOpt: TransactionOption.SELL,
            })
            .andWhere('t.trans_user_buy IN (:...uids)', { uids: buyUserIds })
            .groupBy('t.trans_user_buy')
            .setParameters({
              exec: TransactionStatus.EXECUTED,
              fail: TransactionStatus.FAILED,
            })
            .getRawMany<{
              userId: string;
              total_transactions: string | number | null;
              successful_transactions: string | number | null;
              failed_transactions: string | number | null;
            }>()
        : [],
    ]);

    const sellCreators = new Map<number, CreatorTransactionReputation>();
    for (const r of sellRaw) {
      sellCreators.set(Number(r.userId), this.parseReputationRow(r));
    }
    const buyCreators = new Map<number, CreatorTransactionReputation>();
    for (const r of buyRaw) {
      buyCreators.set(Number(r.userId), this.parseReputationRow(r));
    }

    return { sellCreators, buyCreators };
  }

  private async getPublicUserById(userId: number) {
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      select: ['uid', 'uname', 'ufulllname', 'uavatar'],
    });
    return this.toPublicUser(user);
  }

  async createOrderBook(userId: number, dto: CreateOrderbookDto) {
    const amount = this.toNumber(dto.amount);
    const price = this.toNumber(dto.price);
    const nationalMinCfg =
      dto.nationalMin === undefined
        ? undefined
        : this.toNumber(dto.nationalMin);
    const nationalMaxCfg =
      dto.nationalMax === undefined
        ? undefined
        : this.toNumber(dto.nationalMax);
    this.assertPerTransactionAmountBounds(nationalMinCfg, nationalMaxCfg);

    const [transactionFeePercent, smartrefFeePercent] = await Promise.all([
      this.adminSettingsConfigService.getTransactionFeePercent(),
      this.adminSettingsConfigService.getSmartrefFeePercent(),
    ]);
    const totalLockFeePercent = transactionFeePercent + smartrefFeePercent;

    const result = await this.dataSource.transaction(async (manager) => {
      if (dto.option === OrderBookOption.SELL && !dto.buId) {
        throw new BadRequestException('buId is required when option is sell');
      }
      if (dto.option === OrderBookOption.BUY && dto.buId) {
        throw new BadRequestException(
          'buId must not be provided when option is buy',
        );
      }

      const currentUser = await manager.findOne(User, {
        where: { uid: userId },
        select: ['uid', 'ulevel', 'uverify'],
      });
      if (!currentUser) {
        throw new NotFoundException('User not found');
      }
      if (currentUser.uverify !== true) {
        throw new ForbiddenException(
          'Identity not verified. Please verify your identity to continue.',
        );
      }

      const [coinExists, nationalExists] = await Promise.all([
        manager.exists(Coin, { where: { coin_id: dto.coinId } }),
        manager.exists(NationalCurrency, {
          where: { nc_id: dto.nationalCurrencyId },
        }),
      ]);

      if (!coinExists) {
        throw new BadRequestException('Invalid coinId');
      }
      if (!nationalExists) {
        throw new BadRequestException('Invalid nationalCurrencyId');
      }

      if (dto.option === OrderBookOption.BUY) {
        const maxLimitCoin = this.getBuyerMaxCoinLimitByLevel(
          currentUser.ulevel,
        );
        const { available } = await this.computeBuyerAvailableCoinBudget(
          manager,
          userId,
          maxLimitCoin,
        );

        if (amount > available) {
          throw new BadRequestException(
            `Buy limit exceeded. Level ${currentUser.ulevel} max is ${maxLimitCoin} USDT; available now is ${apiDecimal(available)} USDT (open buy ads + taker buys in progress in the last 24h).`,
          );
        }
      }

      if (dto.option === OrderBookOption.SELL) {
        const bankUser = await manager.findOne(BankUser, {
          where: {
            bu_id: dto.buId,
            bu_user_id: userId,
            bu_approval_status: BankUserApprovalStatus.ACTIVE,
          },
        });
        if (!bankUser) {
          throw new BadRequestException(
            'Invalid buId: bank user does not belong to user or is not active',
          );
        }
      }

      if (dto.option === OrderBookOption.SELL) {
        const wallet = await manager.findOne(UserWallet, {
          where: {
            uw_user_id: userId,
            uw_wallet_coins: dto.coinId,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found for selected coin');
        }

        /** Số coin lock vào ví: lệnh bán = amount + (transaction fee + smartref fee). */
        const lockTotal = this.toNumber(
          this.formatAmount(amount + (amount * totalLockFeePercent) / 100),
        );
        const amountStr = this.formatAmount(lockTotal);

        this.logger.debug(
          `[orderbook:create:sell-balance-check] ${JSON.stringify({
            userId,
            coinId: dto.coinId,
            amount,
            transactionFeePercent,
            smartrefFeePercent,
            totalLockFeePercent,
            lockTotal,
            requestedAmountForWalletDeduction: amountStr,
            walletBalance: Number(wallet.uw_balance ?? 0),
            walletLockBalance: Number(wallet.uw_lock_balance ?? 0),
          })}`,
        );

        // Một câu UPDATE nguyên tử: trừ khả dụng + cộng lock, chỉ khi đủ số dư (ACID, tránh lệch decimal khi save entity).
        const updateResult = await manager
          .createQueryBuilder()
          .update(UserWallet)
          .set({
            uw_balance: () => 'uw_balance - :amt',
            uw_lock_balance: () => 'uw_lock_balance + :amt',
          })
          .where('uw_id = :uwId')
          .andWhere('uw_user_id = :userId')
          .andWhere('uw_wallet_coins = :coinId')
          .andWhere('uw_balance >= :amt')
          .setParameters({
            amt: amountStr,
            uwId: wallet.uw_id,
            userId,
            coinId: dto.coinId,
          })
          .execute();

        if (!updateResult.affected || updateResult.affected < 1) {
          this.logger.warn(
            `[orderbook:create:sell-balance-insufficient] ${JSON.stringify({
              userId,
              coinId: dto.coinId,
              amount,
              transactionFeePercent,
              smartrefFeePercent,
              totalLockFeePercent,
              lockTotal,
              requestedAmountForWalletDeduction: amountStr,
              walletBalance: Number(wallet.uw_balance ?? 0),
              walletLockBalance: Number(wallet.uw_lock_balance ?? 0),
              updateAffected: updateResult.affected ?? 0,
            })}`,
          );
          throw new BadRequestException('Insufficient available balance');
        }
      }

      const orderBook = manager.create(OrderBook, {
        ob_user_id: userId,
        ob_coin: dto.coinId,
        ob_national: dto.nationalCurrencyId,
        ob_adv_code: this.generateAdvCode(),
        ob_option: dto.option,
        ob_coin_symbol: dto.coinSymbol,
        ob_national_symbol: dto.nationalSymbol,
        ob_amount: this.formatAmount(amount),
        ob_amount_remaining: this.formatAmount(amount),
        ob_price: this.formatAmount(price),
        ob_national_min:
          nationalMinCfg === undefined
            ? null
            : this.formatAmount(nationalMinCfg),
        ob_national_max:
          nationalMaxCfg === undefined
            ? null
            : this.formatAmount(nationalMaxCfg),
        ob_status: OrderBookStatus.PENDING,
        ob_description:
          dto.description === undefined || dto.description === null
            ? null
            : dto.description.trim() || null,
      });

      const saved = await manager.save(OrderBook, orderBook);
      if (dto.option === OrderBookOption.SELL && dto.buId) {
        const setting = manager.create(SettingBankOrder, {
          sbo_order_book: saved.ob_id,
          sbo_bank_id: dto.buId,
        });
        await manager.save(SettingBankOrder, setting);
      }

      const user = await this.getPublicUserById(saved.ob_user_id);
      return {
        id: saved.ob_id,
        user,
        coin: saved.ob_coin,
        national: saved.ob_national,
        adv_code: saved.ob_adv_code,
        option: saved.ob_option,
        coin_symbol: saved.ob_coin_symbol,
        national_symbol: saved.ob_national_symbol,
        ...this.apiOrderBookAmountFields(saved),
        status: saved.ob_status,
        description: saved.ob_description,
      };
    });

    // Chia hoa hồng smartref cho các referral của người bán (chỉ áp dụng cho SELL orders - async, không chặn response)
    if (dto.option === OrderBookOption.SELL) {
      if (smartrefFeePercent > 0) {
        const smartrefRewardAmount = this.toNumber(
          this.formatAmount((amount * smartrefFeePercent) / 100),
        );
        void this.smartRefService
          .disputeSmartref(userId, smartrefRewardAmount)
          .catch((error) => {
            console.error(
              `Failed to distribute smartref rewards for seller ${userId} on new orderbook:`,
              error,
            );
          });
      }
    }

    return result;
  }

  async getOrderBooks(query: QueryOrderbooksDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const qb = this.orderBookRepository
      .createQueryBuilder('ob')
      .where('ob.ob_status = :pending', { pending: OrderBookStatus.PENDING })
      .andWhere('CAST(ob.ob_amount_remaining AS numeric) > 0')
      .andWhere(
        'CAST(ob.ob_amount_remaining AS numeric) >= COALESCE(CAST(ob.ob_national_min AS numeric), :defaultPerTransactionMin)',
        {
          defaultPerTransactionMin:
            DEFAULT_ORDERBOOK_PER_TRANSACTION_AMOUNT_MIN,
        },
      );

    // Không join user ở đây: skip/take + join kích hoạt DISTINCT pagination của TypeORM
    // và dễ lỗi khi ORDER BY theo alias từ addSelect (mixed buy/sell sort).

    if (query.dateFrom) {
      qb.andWhere('ob.ob_created_at >= :df', { df: new Date(query.dateFrom) });
    }
    if (query.dateTo) {
      qb.andWhere('ob.ob_created_at <= :dt', { dt: new Date(query.dateTo) });
    }
    if (query.option !== undefined) {
      qb.andWhere('ob.ob_option = :opt', { opt: query.option });
    }
    if (query.coinId !== undefined) {
      qb.andWhere('ob.ob_coin = :coin', { coin: query.coinId });
    }
    if (query.nationalCurrencyId !== undefined) {
      qb.andWhere('ob.ob_national = :nat', { nat: query.nationalCurrencyId });
    }
    if (query.amountRemainingMin !== undefined) {
      qb.andWhere('ob.ob_amount_remaining >= :rmin', {
        rmin: this.formatAmount(query.amountRemainingMin),
      });
    }
    if (query.amountRemainingMax !== undefined) {
      qb.andWhere('ob.ob_amount_remaining <= :rmax', {
        rmax: this.formatAmount(query.amountRemainingMax),
      });
    }

    if (query.sortPrice || query.sortAmount) {
      if (query.sortPrice) {
        qb.orderBy('ob.ob_price', query.sortPrice === 'asc' ? 'ASC' : 'DESC');
      }

      if (query.sortAmount) {
        if (query.sortPrice) {
          qb.addOrderBy(
            'ob.ob_amount',
            query.sortAmount === 'asc' ? 'ASC' : 'DESC',
          );
        } else {
          qb.orderBy(
            'ob.ob_amount',
            query.sortAmount === 'asc' ? 'ASC' : 'DESC',
          );
        }
      }

      qb.addOrderBy('ob.ob_id', 'DESC');
    } else if (query.option === OrderBookOption.SELL) {
      qb.orderBy('ob.ob_price', 'ASC').addOrderBy('ob.ob_id', 'DESC');
    } else if (query.option === OrderBookOption.BUY) {
      qb.orderBy('ob.ob_price', 'DESC').addOrderBy('ob.ob_id', 'DESC');
    } else {
      // Mixed options: SELL by price ASC, BUY by price DESC (same SQL as before).
      // Must use SELECT aliases for sort keys: TypeORM treats the first `.` in a raw
      // orderBy string as `alias.column`, so `CASE WHEN ob.ob_option` breaks.
      qb.addSelect(
        `CASE WHEN ob.ob_option = :obSortSellOpt THEN ob.ob_price END`,
        'ob_sort_sell_price',
      )
        .addSelect(
          `CASE WHEN ob.ob_option = :obSortBuyOpt THEN ob.ob_price END`,
          'ob_sort_buy_price',
        )
        .setParameter('obSortSellOpt', OrderBookOption.SELL)
        .setParameter('obSortBuyOpt', OrderBookOption.BUY)
        .orderBy('ob_sort_sell_price', 'ASC', 'NULLS LAST')
        .addOrderBy('ob_sort_buy_price', 'DESC', 'NULLS LAST')
        .addOrderBy('ob.ob_id', 'DESC');
    }
    qb.skip((page - 1) * limit).take(limit);

    let rows: OrderBook[] = [];
    let total = 0;
    try {
      [rows, total] = await qb.getManyAndCount();
    } catch (error) {
      const [sql, params] = qb.getQueryAndParameters();
      this.logger.error(
        `getOrderBooks query failed: ${(error as Error)?.message ?? 'Unknown error'}`,
        JSON.stringify({
          query,
          sql,
          params,
        }),
      );
      throw error;
    }

    const creatorIds = [...new Set(rows.map((r) => r.ob_user_id))];
    const users =
      creatorIds.length > 0
        ? await this.userRepository.find({
            where: { uid: In(creatorIds) },
            select: ['uid', 'uname', 'ufulllname', 'uavatar'],
          })
        : [];
    const userById = new Map(users.map((u) => [u.uid, u]));

    const { sellCreators, buyCreators } =
      await this.buildCreatorTransactionReputationMaps(rows);

    return {
      statusCode: 200,
      data: rows.map((book) => {
        const reputation =
          book.ob_option === OrderBookOption.SELL
            ? (sellCreators.get(book.ob_user_id) ??
              this.emptyCreatorTransactionReputation())
            : (buyCreators.get(book.ob_user_id) ??
              this.emptyCreatorTransactionReputation());

        const u = userById.get(book.ob_user_id);
        return {
          id: book.ob_id,
          user: u
            ? {
                id: u.uid,
                username: u.uname,
                fullName: u.ufulllname,
                avatar: u.uavatar,
                ...reputation,
              }
            : null,
          coin: book.ob_coin,
          national: book.ob_national,
          adv_code: book.ob_adv_code,
          option: book.ob_option,
          coin_symbol: book.ob_coin_symbol,
          national_symbol: book.ob_national_symbol,
          ...this.apiOrderBookAmountFields(book),
          status: book.ob_status,
          description: book.ob_description,
          created_at: book.ob_created_at,
        };
      }),
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getMyOrderBooks(userId: number, query: QueryMyOrderbooksDto) {
    const qb = this.orderBookRepository
      .createQueryBuilder('ob')
      .where('ob.ob_user_id = :uid', { uid: userId });
    qb.leftJoin('ob.user', 'u').addSelect([
      'u.uid',
      'u.uname',
      'u.ufulllname',
      'u.uavatar',
    ]);
    qb.leftJoinAndSelect('ob.setting_bank_orders', 'sbo');
    qb.leftJoinAndSelect('sbo.bank_user', 'bu');

    if (query.status) {
      qb.andWhere('ob.ob_status = :st', { st: query.status });
    }
    if (query.dateFrom) {
      qb.andWhere('ob.ob_created_at >= :df', { df: new Date(query.dateFrom) });
    }
    if (query.dateTo) {
      qb.andWhere('ob.ob_created_at <= :dt', { dt: new Date(query.dateTo) });
    }
    if (query.option !== undefined) {
      qb.andWhere('ob.ob_option = :opt', { opt: query.option });
    }
    if (query.coinId !== undefined) {
      qb.andWhere('ob.ob_coin = :coin', { coin: query.coinId });
    }
    if (query.nationalCurrencyId !== undefined) {
      qb.andWhere('ob.ob_national = :nat', { nat: query.nationalCurrencyId });
    }
    if (query.amountRemainingMin !== undefined) {
      qb.andWhere('ob.ob_amount_remaining >= :rmin', {
        rmin: this.formatAmount(query.amountRemainingMin),
      });
    }
    if (query.amountRemainingMax !== undefined) {
      qb.andWhere('ob.ob_amount_remaining <= :rmax', {
        rmax: this.formatAmount(query.amountRemainingMax),
      });
    }

    if (query.sortAmount === 'asc') {
      qb.orderBy('ob.ob_amount', 'ASC').addOrderBy('ob.ob_id', 'DESC');
    } else if (query.sortAmount === 'desc') {
      qb.orderBy('ob.ob_amount', 'DESC').addOrderBy('ob.ob_id', 'DESC');
    } else {
      qb.orderBy('ob.ob_id', 'DESC');
    }

    const rows = await qb.getMany();
    return rows.map((book) => ({
      bank_infor: book.setting_bank_orders?.[0]?.bank_user
        ? {
            id: book.setting_bank_orders[0].bank_user.bu_id,
            userId: book.setting_bank_orders[0].bank_user.bu_user_id,
            bankName: book.setting_bank_orders[0].bank_user.bu_bank_name,
            bankBranch: book.setting_bank_orders[0].bank_user.bu_bank_branch,
            bankAccountName:
              book.setting_bank_orders[0].bank_user.bu_bank_account_name,
            bankAccountNumber:
              book.setting_bank_orders[0].bank_user.bu_bank_account_number,
          }
        : null,
      id: book.ob_id,
      user: this.toPublicUser(book.user),
      coin: book.ob_coin,
      national: book.ob_national,
      adv_code: book.ob_adv_code,
      option: book.ob_option,
      coin_symbol: book.ob_coin_symbol,
      national_symbol: book.ob_national_symbol,
      ...this.apiOrderBookAmountFields(book),
      status: book.ob_status,
      description: book.ob_description,
      created_at: book.ob_created_at,
    }));
  }

  async getOrderBookDetail(id: number, viewerUserId: number) {
    const orderBook = await this.orderBookRepository.findOne({
      where: { ob_id: id },
      relations: ['user'],
    });
    if (!orderBook) {
      throw new NotFoundException('Order book not found');
    }
    if (this.toNumber(orderBook.ob_amount_remaining) <= 0) {
      throw new NotFoundException('Order book not found');
    }
    // if (orderBook.ob_status !== OrderBookStatus.PENDING) {
    //   throw new NotFoundException('Order book not found');
    // }

    let bankInfor = null as ReturnType<OrderbookService['toBankUserResponse']>;
    let bankUser = null as ReturnType<OrderbookService['toBankUserResponse']>;

    const participantTx = await this.transactionRepository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.bank_user', 'bu')
      .where('t.trans_order_book = :obId', { obId: id })
      .andWhere('(t.trans_user_buy = :uid OR t.trans_user_sell = :uid)', {
        uid: viewerUserId,
      })
      .orderBy('t.trans_id', 'DESC')
      .getOne();

    if (participantTx) {
      if (orderBook.ob_option === OrderBookOption.SELL) {
        const setting = await this.settingBankOrderRepository.findOne({
          where: { sbo_order_book: id },
          relations: ['bank_user'],
        });
        bankInfor = this.toBankUserResponse(setting?.bank_user);
        bankUser = bankInfor;
      } else {
        bankInfor = this.toBankUserResponse(participantTx.bank_user);
        bankUser = bankInfor;
      }
    }

    const reputation = await this.getCreatorTransactionReputation(
      orderBook.ob_user_id,
      orderBook.ob_option,
    );
    const publicUser = this.toPublicUser(orderBook.user);

    return {
      id: orderBook.ob_id,
      user: publicUser ? { ...publicUser, ...reputation } : null,
      coin: orderBook.ob_coin,
      national: orderBook.ob_national,
      adv_code: orderBook.ob_adv_code,
      option: orderBook.ob_option,
      coin_symbol: orderBook.ob_coin_symbol,
      national_symbol: orderBook.ob_national_symbol,
      ...this.apiOrderBookAmountFields(orderBook),
      status: orderBook.ob_status,
      description: orderBook.ob_description,
      bank_infor: bankInfor,
      bank_user: bankUser,
    };
  }

  async attachBankToOrderBook(
    userId: number,
    orderBookId: number,
    bankUserId: number,
  ) {
    const [orderBook, bankUser, user, existingSetting] = await Promise.all([
      this.orderBookRepository.findOne({
        where: { ob_id: orderBookId },
      }),
      this.bankUserRepository.findOne({
        where: { bu_id: bankUserId },
      }),
      this.userRepository.findOne({
        where: { uid: userId },
        select: ['uid', 'uname', 'uemail'],
      }),
      this.settingBankOrderRepository.findOne({
        where: { sbo_order_book: orderBookId },
      }),
    ]);

    if (!orderBook) throw new NotFoundException('Order book not found');
    if (orderBook.ob_user_id !== userId) {
      throw new ForbiddenException(
        'You can only attach bank to your own order book',
      );
    }
    if (orderBook.ob_option === OrderBookOption.BUY) {
      throw new BadRequestException('Cannot attach bank to buy orderbook');
    }
    if (!bankUser) throw new NotFoundException('Bank not found');
    if (bankUser.bu_user_id !== userId) {
      throw new ForbiddenException('You can only use your own bank');
    }
    if (bankUser.bu_approval_status !== BankUserApprovalStatus.ACTIVE) {
      throw new BadRequestException(
        'Only active bank accounts can be used for an orderbook',
      );
    }

    // First-time attach: apply immediately, no approval flow.
    if (!existingSetting) {
      const created = this.settingBankOrderRepository.create({
        sbo_order_book: orderBookId,
        sbo_bank_id: bankUserId,
      });
      await this.settingBankOrderRepository.save(created);

      return {
        message: 'Bank attached to orderbook successfully',
        orderbookId: orderBookId,
        bankUser: {
          id: bankUser.bu_id,
          userId: bankUser.bu_user_id,
          bankName: bankUser.bu_bank_name,
          bankBranch: bankUser.bu_bank_branch,
          bankAccountName: bankUser.bu_bank_account_name,
          bankAccountNumber: bankUser.bu_bank_account_number,
        },
      };
    }

    const requestedAt = new Date();
    existingSetting.sbo_pending_bank_id = bankUserId;
    existingSetting.sbo_bank_change_requested_at = requestedAt;
    await this.settingBankOrderRepository.save(existingSetting);

    const adminEmail = this.configService.get<string>('ADMIN_EMAIL')?.trim();
    if (adminEmail) {
      void this.emailService
        .sendOrderbookBankChangePendingToAdmin(adminEmail, {
          orderbookId: orderBookId,
          requestedByUserId: userId,
          requestedByUsername: user?.uname || 'unknown',
          requestedByEmail: user?.uemail || 'unknown',
          targetBankUserId: bankUserId,
          requestedAt: requestedAt.toISOString(),
        })
        .catch((err) => {
          console.error(
            `Failed admin email for bank change OB ${orderBookId}:`,
            err,
          );
        });
    }

    void this.notificationsService
      .createForUser({
        userId,
        type: NotificationType.ORDERBOOK,
        title: 'Bank change request submitted',
        message:
          'Your orderbook bank change request has been submitted and is waiting for admin approval.',
        data: {
          orderbook_id: orderBookId,
          bank_user_id: bankUserId,
          requested_at: requestedAt.toISOString(),
        },
      })
      .catch((err) => {
        console.error(
          `Failed user notification bank change OB ${orderBookId}:`,
          err,
        );
      });

    return {
      message: 'Bank change request submitted and waiting for admin approval',
      orderbookId: orderBookId,
      requestedBankUserId: bankUserId,
      requestedAt: requestedAt.toISOString(),
    };
  }

  async getPendingOrderbookBankChangeRequests() {
    const settings = await this.settingBankOrderRepository.find({
      where: { sbo_pending_bank_id: Not(IsNull()) },
      relations: [
        'bank_user',
        'pending_bank_user',
        'order_book',
        'order_book.user',
      ],
    });
    if (settings.length === 0) {
      return { statusCode: 200, data: [] };
    }

    return {
      statusCode: 200,
      data: settings.map((s) => {
        const orderbook = s.order_book;
        const obUserId = orderbook?.ob_user_id ?? 0;
        const requester = orderbook?.user;
        const requestedBank = s.pending_bank_user;
        return {
          orderbookId: s.sbo_order_book,
          requestedAt: s.sbo_bank_change_requested_at?.toISOString() ?? null,
          requestedBy: requester
            ? {
                id: requester.uid,
                username: requester.uname,
                email: requester.uemail,
                fullName: requester.ufulllname,
              }
            : { id: obUserId },
          orderbook: orderbook
            ? {
                id: orderbook.ob_id,
                userId: orderbook.ob_user_id,
                advCode: orderbook.ob_adv_code,
                option: orderbook.ob_option,
                status: orderbook.ob_status,
                coinSymbol: orderbook.ob_coin_symbol,
                nationalSymbol: orderbook.ob_national_symbol,
              }
            : null,
          currentBankUser: this.toBankUserResponse(s.bank_user),
          requestedBankUser: this.toBankUserResponse(requestedBank),
        };
      }),
    };
  }

  async reviewOrderbookBankChangeRequest(
    orderbookId: number,
    approve: boolean,
  ) {
    const setting = await this.settingBankOrderRepository.findOne({
      where: { sbo_order_book: orderbookId },
      relations: ['order_book'],
    });
    if (!setting?.sbo_pending_bank_id) {
      throw new NotFoundException(
        'No pending bank change request found for this orderbook',
      );
    }
    const orderBook = setting.order_book;
    if (!orderBook) throw new NotFoundException('Order book not found');

    const pendingBankId = setting.sbo_pending_bank_id;
    const requesterUserId = orderBook.ob_user_id;

    if (approve) {
      await this.dataSource.transaction(async (manager) => {
        const [lockedBook, bankUser, lockedSetting] = await Promise.all([
          manager.findOne(OrderBook, {
            where: { ob_id: orderbookId },
            lock: { mode: 'pessimistic_write' },
          }),
          manager.findOne(BankUser, {
            where: {
              bu_id: pendingBankId,
              bu_approval_status: BankUserApprovalStatus.ACTIVE,
            },
          }),
          manager.findOne(SettingBankOrder, {
            where: { sbo_order_book: orderbookId },
            lock: { mode: 'pessimistic_write' },
          }),
        ]);

        if (!lockedBook) throw new NotFoundException('Order book not found');
        if (!bankUser) throw new NotFoundException('Bank not found');
        if (lockedBook.ob_user_id !== bankUser.bu_user_id) {
          throw new BadRequestException(
            'Requested bank does not belong to orderbook owner',
          );
        }
        if (!lockedSetting?.sbo_pending_bank_id) {
          throw new NotFoundException(
            'No pending bank change request found for this orderbook',
          );
        }

        lockedSetting.sbo_bank_id = pendingBankId;
        lockedSetting.sbo_pending_bank_id = null;
        lockedSetting.sbo_bank_change_requested_at = null;
        await manager.save(SettingBankOrder, lockedSetting);
      });
    } else {
      setting.sbo_pending_bank_id = null;
      setting.sbo_bank_change_requested_at = null;
      await this.settingBankOrderRepository.save(setting);
    }

    void this.notificationsService
      .createForUser({
        userId: requesterUserId,
        type: NotificationType.ORDERBOOK,
        title: approve
          ? 'Bank change request approved'
          : 'Bank change request rejected',
        message: approve
          ? `Your bank change request for orderbook #${orderbookId} has been approved.`
          : `Your bank change request for orderbook #${orderbookId} has been rejected.`,
        data: {
          orderbook_id: orderbookId,
          approved: approve,
        },
      })
      .catch((err) => {
        console.error(
          `Failed notify user after OB ${orderbookId} bank review:`,
          err,
        );
      });

    return {
      message: approve
        ? 'Orderbook bank change request approved'
        : 'Orderbook bank change request rejected',
      orderbookId,
      approved: approve,
    };
  }

  async updateOrderBook(userId: number, id: number, dto: UpdateOrderbookDto) {
    const orderBook = await this.orderBookRepository.findOne({
      where: { ob_id: id },
    });
    if (!orderBook) {
      throw new NotFoundException('Order book not found');
    }
    if (orderBook.ob_user_id !== userId) {
      throw new ForbiddenException('You can only update your own order book');
    }
    if (orderBook.ob_status !== OrderBookStatus.PENDING) {
      throw new BadRequestException('Only pending order book can be updated');
    }

    if (dto.price !== undefined) {
      orderBook.ob_price = this.formatAmount(dto.price);
    }
    if (dto.nationalMin !== undefined || dto.nationalMax !== undefined) {
      const nextMin =
        dto.nationalMin !== undefined
          ? dto.nationalMin === null
            ? null
            : this.toNumber(dto.nationalMin)
          : orderBook.ob_national_min != null
            ? this.toNumber(orderBook.ob_national_min)
            : null;
      const nextMax =
        dto.nationalMax !== undefined
          ? dto.nationalMax === null
            ? null
            : this.toNumber(dto.nationalMax)
          : orderBook.ob_national_max != null
            ? this.toNumber(orderBook.ob_national_max)
            : null;
      this.assertPerTransactionAmountBounds(nextMin, nextMax);
    }
    if (dto.nationalMin !== undefined) {
      orderBook.ob_national_min =
        dto.nationalMin === null ? null : this.formatAmount(dto.nationalMin);
    }
    if (dto.nationalMax !== undefined) {
      orderBook.ob_national_max =
        dto.nationalMax === null ? null : this.formatAmount(dto.nationalMax);
    }

    const saved = await this.orderBookRepository.save(orderBook);
    const user = await this.getPublicUserById(saved.ob_user_id);
    return {
      id: saved.ob_id,
      user,
      coin: saved.ob_coin,
      national: saved.ob_national,
      adv_code: saved.ob_adv_code,
      option: saved.ob_option,
      coin_symbol: saved.ob_coin_symbol,
      national_symbol: saved.ob_national_symbol,
      ...this.apiOrderBookAmountFields(saved),
      status: saved.ob_status,
      description: saved.ob_description,
    };
  }

  async deleteOrderBook(userId: number, id: number) {
    const [transactionFeePercent, smartrefFeePercent] = await Promise.all([
      this.adminSettingsConfigService.getTransactionFeePercent(),
      this.adminSettingsConfigService.getSmartrefFeePercent(),
    ]);
    const totalUnlockFeePercent = transactionFeePercent + smartrefFeePercent;

    return this.dataSource.transaction(async (manager) => {
      const orderBook = await manager.findOne(OrderBook, {
        where: { ob_id: id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!orderBook) {
        throw new NotFoundException('Order book not found');
      }
      if (orderBook.ob_user_id !== userId) {
        throw new ForbiddenException('You can only delete your own order book');
      }
      if (orderBook.ob_status !== OrderBookStatus.PENDING) {
        throw new BadRequestException('Only pending order book can be deleted');
      }

      if (orderBook.ob_option === OrderBookOption.SELL) {
        const amountRemaining = this.toNumber(orderBook.ob_amount_remaining);
        const unlockTotal =
          totalUnlockFeePercent > 0
            ? this.toNumber(
                this.formatAmount(
                  amountRemaining +
                    (amountRemaining * totalUnlockFeePercent) / 100,
                ),
              )
            : amountRemaining;
        const amountStr = this.formatAmount(unlockTotal);

        const wallet = await manager.findOne(UserWallet, {
          where: {
            uw_user_id: userId,
            uw_wallet_coins: orderBook.ob_coin,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found for this order book');
        }

        const unlockResult = await manager
          .createQueryBuilder()
          .update(UserWallet)
          .set({
            uw_lock_balance: () => 'uw_lock_balance - :amt',
            uw_balance: () => 'uw_balance + :amt',
          })
          .where('uw_id = :uwId')
          .andWhere('uw_user_id = :userId')
          .andWhere('uw_wallet_coins = :coinId')
          .andWhere('uw_lock_balance >= :amt')
          .setParameters({
            amt: amountStr,
            uwId: wallet.uw_id,
            userId,
            coinId: orderBook.ob_coin,
          })
          .execute();

        if (!unlockResult.affected || unlockResult.affected < 1) {
          throw new BadRequestException(
            'Wallet lock balance is not enough to unlock',
          );
        }
      }

      orderBook.ob_status = OrderBookStatus.FAILED;
      await manager.save(OrderBook, orderBook);

      return { message: 'Order book deleted successfully' };
    });
  }

  /**
   * Admin trade-block: mark remaining pending listings FAILED và unlock ví (giống delete).
   */
  async failPendingOrderBooksForTradeBlockedUser(
    userId: number,
  ): Promise<number> {
    const obs = await this.orderBookRepository.find({
      where: { ob_user_id: userId, ob_status: OrderBookStatus.PENDING },
      select: ['ob_id'],
    });
    for (const ob of obs) {
      await this.deleteOrderBook(userId, ob.ob_id);
    }
    return obs.length;
  }
}
