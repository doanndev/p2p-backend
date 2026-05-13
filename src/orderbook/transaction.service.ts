import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  OrderBook,
  OrderBookOption,
  OrderBookStatus,
} from './entities/order-book.entity';
import {
  Transaction,
  TransactionOption,
  TransactionStatus,
  TransactionType,
} from './entities/transaction.entity';
import { Dispute, DisputeStatus, DisputeType } from './entities/dispute.entity';
import { User, UserStatus } from '../users/entities/user.entity';
import { BankUser } from '../users/entities/bank-user.entity';
import { BankUserApprovalStatus } from '../users/entities/bank-user-approval-status';
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { QueryTransactionsDto } from './dto/query.dto';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { QueryDisputesDto } from './dto/query-disputes.dto';
import { AdminSettingsConfigService } from '../settings/admin-settings-config.service';
import { Admin } from '../admins/entities/admin.entity';
import { EmailService } from '../systems/email.service';
import {
  TransactionExpiryQueueService,
  TRANSACTION_EXPIRY_DELAY_MS,
} from './transaction-expiry-queue.service';
import { SmartRefService } from '../smart-ref/smart-ref.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminNotificationsService } from '../notifications/admin-notifications.service';
import { NotificationType } from '../users/entities/notification.entity';
import {
  DEFAULT_ORDERBOOK_PER_TRANSACTION_AMOUNT_MIN,
  P2P_SELL_LISTING_BUYER_COIN_UNLOCK_DELAY_MS,
} from './orderbook.constants';
import {
  apiDecimal,
  apiDecimalOrNull,
} from '../common/helpers/decimal-api.util';

/** Max coin (USDT) buy exposure per user level. */
const BUYER_MAX_COIN_LIMIT_BY_LEVEL: Record<number, number> = {
  1: 1000,
  2: 5000,
  3: 10000,
  4: 30000,
};

@Injectable()
export class TransactionService {
  constructor(
    @InjectRepository(OrderBook)
    private readonly orderBookRepository: Repository<OrderBook>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    @InjectRepository(UserWallet)
    private readonly userWalletRepository: Repository<UserWallet>,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly adminSettingsConfigService: AdminSettingsConfigService,
    private readonly emailService: EmailService,
    private readonly transactionExpiryQueue: TransactionExpiryQueueService,
    private readonly smartRefService: SmartRefService,
    private readonly currenciesService: CurrenciesService,
    private readonly notificationsService: NotificationsService,
    private readonly adminNotificationsService: AdminNotificationsService,
  ) {}

  private toNumber(value: string | number): number {
    return typeof value === 'number' ? value : Number(value);
  }

  private formatAmount(value: number): string {
    return value.toFixed(8);
  }

  private assertTransactionAmountWithinOrderbookBounds(
    orderBook: OrderBook,
    amount: number,
  ): void {
    const rawMin = orderBook.ob_national_min;
    const rawMax = orderBook.ob_national_max;
    const configuredMin =
      rawMin != null && String(rawMin).trim() !== ''
        ? this.toNumber(rawMin)
        : null;
    const configuredMax =
      rawMax != null && String(rawMax).trim() !== ''
        ? this.toNumber(rawMax)
        : null;

    const effectiveMin =
      configuredMin != null
        ? configuredMin
        : DEFAULT_ORDERBOOK_PER_TRANSACTION_AMOUNT_MIN;

    if (amount < effectiveMin) {
      throw new BadRequestException(
        `Transaction amount must be at least ${apiDecimal(effectiveMin)}`,
      );
    }
    if (configuredMax != null && amount > configuredMax) {
      throw new BadRequestException(
        `Transaction amount must not exceed ${apiDecimal(configuredMax)}`,
      );
    }
  }

  /** Same as orderbook sell create: tx fee % + smartref % from admin settings. */
  private async getP2pOrderbookFeePercentTotal(): Promise<number> {
    const [transactionFeePercent, smartrefFeePercent] = await Promise.all([
      this.adminSettingsConfigService.getTransactionFeePercent(),
      this.adminSettingsConfigService.getSmartrefFeePercent(),
    ]);
    return transactionFeePercent + smartrefFeePercent;
  }

  /**
   * Locked coin for a trade amount — must match seller lock debit on execute
   * and buy-orderbook seller lock on create/cancel/expiry.
   */
  private computeSellerLockCoinAmount(
    amount: number,
    totalFeePercent: number,
  ): number {
    return this.toNumber(
      this.formatAmount(amount + (amount * totalFeePercent) / 100),
    );
  }

  private computeSellerLockDebitForExecute(
    amount: number,
    totalFeePercent: number,
    orderBook: OrderBook | null,
    transUserSell: number,
    transUserBuy: number,
  ): number {
    const posterIsSeller =
      orderBook != null &&
      orderBook.ob_option === OrderBookOption.SELL &&
      orderBook.ob_user_id === transUserSell;
    const posterIsBuyer =
      orderBook != null &&
      orderBook.ob_option === OrderBookOption.BUY &&
      orderBook.ob_user_id === transUserBuy;
    if (posterIsSeller || posterIsBuyer) {
      return this.computeSellerLockCoinAmount(amount, totalFeePercent);
    }
    return amount;
  }

  private async computeBuyOrderbookSellerLockCoinAmount(
    amount: number,
  ): Promise<number> {
    const totalFeePercent = await this.getP2pOrderbookFeePercentTotal();
    return this.computeSellerLockCoinAmount(amount, totalFeePercent);
  }

  private getBuyerMaxCoinLimitByLevel(level: number): number {
    return (
      BUYER_MAX_COIN_LIMIT_BY_LEVEL[level] ?? BUYER_MAX_COIN_LIMIT_BY_LEVEL[1]
    );
  }

  /**
   * Available buy coin budget:
   * MaxLimit − [Σ own BUY orderbooks still pending + Σ taker buys matching in last 24h]
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

  private generateReferenceCode(): string {
    return `TX-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  private async resolveUsdRateForNationalCurrency(
    nationalSymbol: string,
  ): Promise<number> {
    const normalizedNational = (nationalSymbol || '').trim().toUpperCase();
    if (!normalizedNational) {
      throw new BadRequestException('National currency symbol is required');
    }

    if (normalizedNational === 'USD' || normalizedNational === 'USDT') {
      return 1;
    }

    const rate = await this.currenciesService.getCoinCurrencyRate(
      'USDT',
      normalizedNational,
    );
    if (
      typeof rate?.rate !== 'number' ||
      Number.isNaN(rate.rate) ||
      rate.rate <= 0
    ) {
      throw new BadRequestException(
        `Unable to resolve USD rate for national currency ${normalizedNational}`,
      );
    }

    return rate.rate;
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
      passbookImageUrl: bankUser.bu_passbook_image_url,
      bankAccountName: bankUser.bu_bank_account_name,
      bankAccountNumber: bankUser.bu_bank_account_number,
    };
  }

  private toTransactionResponse(t: Transaction) {
    const orderBook = (t as any).order_book as OrderBook | null | undefined;
    const bankUser = (t as any).bank_user as BankUser | null | undefined;
    const shouldIncludeBankUser =
      orderBook?.ob_option === OrderBookOption.BUY ||
      (!orderBook && t.trans_bu_id != null);

    return {
      id: t.trans_id,
      reference_code: t.transs_reference_code,
      user_buy: this.toPublicUser((t as any).user_buy),
      user_sell: this.toPublicUser((t as any).user_sell),
      coin: t.trans_coin,
      national: t.trans_national,
      order_book: t.trans_order_book,
      bu_id: t.trans_bu_id,
      option: t.trans_option,
      type: t.trans_type,
      coin_symbol: t.trans_coin_symbol,
      national_symbol: t.trans_national_symbol,
      amount: apiDecimal(t.trans_amount),
      price: apiDecimal(t.trans_price),
      price_usd: apiDecimal(t.trans_price_usd),
      total_price: apiDecimal(t.trans_total_price),
      total_usd: apiDecimal(t.trans_total_usd),
      dispute_status: t.trans_dispute_status,
      time_bank: t.trans_time_bank,
      status: t.trans_status,
      message: t.trans_message,
      created_at: t.trans_created_at,
      expired_at: t.trans_expired_at ? t.trans_expired_at.toISOString() : null,
      bank_user: shouldIncludeBankUser
        ? this.toBankUserResponse(bankUser)
        : null,
      lock_released_at: t.trans_lock_released_at
        ? t.trans_lock_released_at.toISOString()
        : null,
      coin_unlock_at: t.trans_coin_unlock_at
        ? t.trans_coin_unlock_at.toISOString()
        : null,
      payment_proof_urls: t.trans_payment_proof_urls ?? [],
    };
  }

  private toOrderBookResponse(orderBook: OrderBook | null | undefined) {
    if (!orderBook) return null;
    return {
      id: orderBook.ob_id,
      user_id: orderBook.ob_user_id,
      coin: orderBook.ob_coin,
      national: orderBook.ob_national,
      adv_code: orderBook.ob_adv_code,
      option: orderBook.ob_option,
      coin_symbol: orderBook.ob_coin_symbol,
      national_symbol: orderBook.ob_national_symbol,
      amount: apiDecimal(orderBook.ob_amount),
      amount_remaining: apiDecimal(orderBook.ob_amount_remaining),
      price: apiDecimal(orderBook.ob_price),
      national_min: apiDecimalOrNull(orderBook.ob_national_min),
      national_max: apiDecimalOrNull(orderBook.ob_national_max),
      status: orderBook.ob_status,
      description: orderBook.ob_description,
      created_at: orderBook.ob_created_at,
    };
  }

  private disputeQueryBuilder() {
    return this.disputeRepository
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.initiator', 'initiator')
      .leftJoinAndSelect('d.responder', 'responder')
      .leftJoinAndSelect('d.transaction', 'tx')
      .leftJoinAndSelect('tx.user_buy', 'tx_user_buy')
      .leftJoinAndSelect('tx.user_sell', 'tx_user_sell')
      .leftJoinAndSelect('tx.bank_user', 'tx_bank_user')
      .leftJoinAndSelect('tx.order_book', 'tx_order_book');
  }

  private async findDisputeWithRelations(
    disputeId: number,
  ): Promise<Dispute | null> {
    return this.disputeQueryBuilder()
      .where('d.dispute_id = :disputeId', { disputeId })
      .getOne();
  }

  /**
   * Called by BullMQ worker: if status still matches `expectedStatus`, mark failed and revert order book / locks (same as cancel).
   */
  async applyExpirationJob(
    transactionId: number,
    expectedStatus: TransactionStatus,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const transaction = await manager.findOne(Transaction, {
        where: { trans_id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transaction) return;
      if (transaction.trans_status !== expectedStatus) return;

      const orderBook = await manager.findOne(OrderBook, {
        where: { ob_id: transaction.trans_order_book ?? 0 },
        lock: { mode: 'pessimistic_write' },
      });
      if (!orderBook) {
        transaction.trans_status = TransactionStatus.FAILED;
        transaction.trans_message =
          transaction.trans_message ?? 'Expired (order book missing)';
        await manager.save(Transaction, transaction);
        return;
      }

      const amount = this.toNumber(transaction.trans_amount);
      const buyLockTotal =
        orderBook.ob_option === OrderBookOption.BUY
          ? await this.computeBuyOrderbookSellerLockCoinAmount(amount)
          : amount;
      const remaining = this.toNumber(orderBook.ob_amount_remaining);
      orderBook.ob_amount_remaining = this.formatAmount(remaining + amount);
      if (orderBook.ob_status === OrderBookStatus.EXECUTED) {
        orderBook.ob_status = OrderBookStatus.PENDING;
      }
      await manager.save(OrderBook, orderBook);

      if (orderBook.ob_option === OrderBookOption.BUY) {
        const sellerWallet = await manager.findOne(UserWallet, {
          where: {
            uw_user_id: transaction.trans_user_sell,
            uw_wallet_coins: transaction.trans_coin,
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (!sellerWallet) {
          transaction.trans_status = TransactionStatus.FAILED;
          transaction.trans_message =
            transaction.trans_message ?? 'Expired (seller wallet missing)';
          await manager.save(Transaction, transaction);
          return;
        }

        const lockBalance = this.toNumber(sellerWallet.uw_lock_balance);
        if (lockBalance < buyLockTotal) {
          transaction.trans_status = TransactionStatus.FAILED;
          transaction.trans_message =
            transaction.trans_message ?? 'Expired (insufficient lock balance)';
          await manager.save(Transaction, transaction);
          return;
        }

        sellerWallet.uw_lock_balance = lockBalance - buyLockTotal;
        sellerWallet.uw_balance =
          this.toNumber(sellerWallet.uw_balance) + buyLockTotal;
        await manager.save(UserWallet, sellerWallet);
      }

      transaction.trans_status = TransactionStatus.FAILED;
      transaction.trans_message =
        transaction.trans_message ??
        'Expired: no action within the allowed time window';
      await manager.save(Transaction, transaction);
    });

    const updated = await this.transactionRepository.findOne({
      where: { trans_id: transactionId },
    });
    if (updated) {
      void this.notifyUsers(
        [updated.trans_user_buy, updated.trans_user_sell],
        'Transaction expired',
        updated.trans_message ||
          'The transaction expired before the required action was completed.',
        {
          transaction_id: updated.trans_id,
          reference_code: updated.transs_reference_code,
          status: updated.trans_status,
        },
      ).catch((err) => {
        console.error(
          `Failed notify on transaction ${updated.trans_id} expiry:`,
          err,
        );
      });
    }
  }

  private async sendPaymentConfirmedEmailToSeller(
    transaction: Transaction,
  ): Promise<void> {
    const seller = await this.userRepository.findOne({
      where: { uid: transaction.trans_user_sell },
      select: ['uid', 'uemail'],
    });

    if (!seller?.uemail) {
      return;
    }

    await this.emailService.sendTransactionPaymentConfirmedNotification(
      seller.uemail,
      {
        referenceCode: transaction.transs_reference_code,
        amount: apiDecimal(transaction.trans_amount),
        coinSymbol: transaction.trans_coin_symbol,
        totalPrice: apiDecimal(transaction.trans_total_price),
        nationalSymbol: transaction.trans_national_symbol,
      },
    );
  }

  private async sendExecutedEmailToBuyer(
    transaction: Transaction,
  ): Promise<void> {
    const buyer = await this.userRepository.findOne({
      where: { uid: transaction.trans_user_buy },
      select: ['uid', 'uemail'],
    });

    if (!buyer?.uemail) {
      return;
    }

    await this.emailService.sendTransactionExecutedNotification(buyer.uemail, {
      referenceCode: transaction.transs_reference_code,
      amount: apiDecimal(transaction.trans_amount),
      coinSymbol: transaction.trans_coin_symbol,
      totalPrice: apiDecimal(transaction.trans_total_price),
      nationalSymbol: transaction.trans_national_symbol,
    });
  }

  private async notifyUsers(
    userIds: number[],
    title: string,
    message: string,
    data: Record<string, any>,
  ) {
    await Promise.allSettled(
      [...new Set(userIds.filter(Boolean))].map((userId) =>
        this.notificationsService.createForUser({
          userId,
          type: NotificationType.TRANSACTION,
          title,
          message,
          data,
        }),
      ),
    );
  }

  private async loadTransactionWithUsers(
    manager: EntityManager | Repository<Transaction>,
    id: number,
  ) {
    const repo =
      manager instanceof Repository
        ? manager
        : (manager as any).getRepository(Transaction);
    return repo
      .createQueryBuilder('t')
      .leftJoin('t.user_buy', 'ub')
      .addSelect(['ub.uid', 'ub.uname', 'ub.ufulllname', 'ub.uavatar'])
      .leftJoin('t.user_sell', 'us')
      .addSelect(['us.uid', 'us.uname', 'us.ufulllname', 'us.uavatar'])
      .leftJoin('t.order_book', 'ob')
      .addSelect(['ob.ob_id', 'ob.ob_option'])
      .leftJoin('t.bank_user', 'bu')
      .addSelect([
        'bu.bu_id',
        'bu.bu_user_id',
        'bu.bu_bank_name',
        'bu.bu_passbook_image_url',
        'bu.bu_bank_account_name',
        'bu.bu_bank_account_number',
      ])
      .where('t.trans_id = :id', { id })
      .getOne();
  }

  async createTransaction(userId: number, dto: CreateTransactionDto) {
    const { response, transactionId } = await this.dataSource.transaction(
      async (manager) => {
        const orderBook = await manager.findOne(OrderBook, {
          where: { ob_id: dto.orderBookId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!orderBook) throw new NotFoundException('Order book not found');
        if (orderBook.ob_status !== OrderBookStatus.PENDING) {
          throw new BadRequestException('Order book is not available');
        }
        if (orderBook.ob_user_id === userId) {
          throw new BadRequestException(
            'You cannot trade with your own order book',
          );
        }

        this.assertTransactionAmountWithinOrderbookBounds(
          orderBook,
          dto.amount,
        );

        const remaining = this.toNumber(orderBook.ob_amount_remaining);
        if (dto.amount <= 0 || dto.amount > remaining) {
          throw new BadRequestException('Invalid transaction amount');
        }

        const buyerId =
          orderBook.ob_option === OrderBookOption.SELL
            ? userId
            : orderBook.ob_user_id;
        const sellerId =
          orderBook.ob_option === OrderBookOption.SELL
            ? orderBook.ob_user_id
            : userId;

        // For SELL listings, the taker is the buyer and must satisfy level-based buy limits.
        if (orderBook.ob_option === OrderBookOption.SELL) {
          const buyer = await manager.findOne(User, {
            where: { uid: buyerId },
            select: ['uid', 'ulevel'],
          });
          if (!buyer) {
            throw new NotFoundException('Buyer not found');
          }

          const maxLimitCoin = this.getBuyerMaxCoinLimitByLevel(buyer.ulevel);
          const { available } = await this.computeBuyerAvailableCoinBudget(
            manager,
            buyerId,
            maxLimitCoin,
          );

          if (dto.amount > available) {
            throw new BadRequestException(
              `Buy limit exceeded. Level ${buyer.ulevel} max is ${maxLimitCoin} USDT; available now is ${apiDecimal(available)} USDT (open buy ads + taker buys in progress in the last 24h).`,
            );
          }
        }

        let transactionBuId: number | null = null;
        if (orderBook.ob_option === OrderBookOption.BUY) {
          if (!dto.buId) {
            throw new BadRequestException(
              'buId is required when creating transaction for buy orderbook',
            );
          }
          const bankUser = await manager.findOne(BankUser, {
            where: {
              bu_id: dto.buId,
              bu_user_id: sellerId,
              bu_approval_status: BankUserApprovalStatus.ACTIVE,
            },
          });
          if (!bankUser) {
            throw new BadRequestException(
              'Invalid buId: bank user does not belong to seller or is not active',
            );
          }
          if (!bankUser.bu_passbook_image_url?.trim()) {
            throw new BadRequestException(
              'This bank account has no passbook image on file. Please update the bank with a passbook image URL before matching this buy orderbook.',
            );
          }
          transactionBuId = dto.buId;
        }

        if (orderBook.ob_option === OrderBookOption.BUY) {
          const sellerWallet = await manager.findOne(UserWallet, {
            where: { uw_user_id: sellerId, uw_wallet_coins: orderBook.ob_coin },
            lock: { mode: 'pessimistic_write' },
          });
          if (!sellerWallet)
            throw new NotFoundException('Seller wallet not found');

          const sellerLockTotal =
            await this.computeBuyOrderbookSellerLockCoinAmount(dto.amount);
          const sellerAvailableBalance = this.toNumber(sellerWallet.uw_balance);
          if (sellerAvailableBalance < sellerLockTotal) {
            throw new BadRequestException(
              'Seller does not have enough available balance',
            );
          }

          sellerWallet.uw_balance = sellerAvailableBalance - sellerLockTotal;
          sellerWallet.uw_lock_balance =
            this.toNumber(sellerWallet.uw_lock_balance) + sellerLockTotal;
          await manager.save(UserWallet, sellerWallet);
        }

        orderBook.ob_amount_remaining = this.formatAmount(
          remaining - dto.amount,
        );
        if (this.toNumber(orderBook.ob_amount_remaining) <= 0) {
          orderBook.ob_status = OrderBookStatus.EXECUTED;
        }
        await manager.save(OrderBook, orderBook);

        const amount = dto.amount;
        const price = this.toNumber(orderBook.ob_price);
        const total = amount * price;
        const nationalPerUsdRate = await this.resolveUsdRateForNationalCurrency(
          orderBook.ob_national_symbol,
        );
        const priceUsd = price / nationalPerUsdRate;
        const totalUsd = total / nationalPerUsdRate;

        const expiresAt = new Date(Date.now() + TRANSACTION_EXPIRY_DELAY_MS);
        const transaction = manager.create(Transaction, {
          transs_reference_code: this.generateReferenceCode(),
          trans_user_buy: buyerId,
          trans_user_sell: sellerId,
          trans_coin: orderBook.ob_coin,
          trans_national: orderBook.ob_national,
          trans_order_book: orderBook.ob_id,
          trans_bu_id: transactionBuId,
          trans_option:
            orderBook.ob_option === OrderBookOption.SELL
              ? TransactionOption.BUY
              : TransactionOption.SELL,
          trans_type: dto.type ?? TransactionType.BANKING,
          trans_coin_symbol: orderBook.ob_coin_symbol,
          trans_national_symbol: orderBook.ob_national_symbol,
          trans_amount: this.formatAmount(amount),
          trans_price: this.formatAmount(price),
          trans_price_usd: this.formatAmount(priceUsd),
          trans_total_price: this.formatAmount(total),
          trans_total_usd: this.formatAmount(totalUsd),
          trans_dispute_status: false,
          trans_time_bank: null,
          trans_status: TransactionStatus.PENDING,
          trans_message: null,
          trans_trade_mode: null,
          trans_coin_unlock_at: null,
          trans_lock_released_at: null,
          trans_expired_at: expiresAt,
          trans_payment_proof_urls: null,
        });

        const saved = await manager.save(Transaction, transaction);

        const hydrated = await this.loadTransactionWithUsers(
          (manager as any).getRepository(Transaction),
          saved.trans_id,
        );
        return {
          response: this.toTransactionResponse(hydrated ?? saved),
          transactionId: saved.trans_id,
        };
      },
    );

    void this.transactionExpiryQueue
      .scheduleExpiry(transactionId, TransactionStatus.PENDING)
      .catch((err) => {
        console.error(
          `Failed to schedule pending expiry job for transaction ${transactionId}:`,
          err,
        );
      });

    void this.notifyUsers(
      [response.user_buy?.id, response.user_sell?.id],
      'New transaction created',
      `A new transaction ${response.reference_code} has been created and is awaiting payment confirmation.`,
      {
        transaction_id: response.id,
        reference_code: response.reference_code,
        status: response.status,
      },
    ).catch((err) => {
      console.error(
        `Failed notify on create transaction ${response.reference_code}:`,
        err,
      );
    });

    return response;
  }

  async getTransactions(userId: number, query: QueryTransactionsDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const qb = this.transactionRepository
      .createQueryBuilder('t')
      .where('(t.trans_user_buy = :uid OR t.trans_user_sell = :uid)', {
        uid: userId,
      });

    qb.leftJoin('t.user_buy', 'ub').addSelect([
      'ub.uid',
      'ub.uname',
      'ub.ufulllname',
      'ub.uavatar',
    ]);
    qb.leftJoin('t.user_sell', 'us').addSelect([
      'us.uid',
      'us.uname',
      'us.ufulllname',
      'us.uavatar',
    ]);
    qb.leftJoin('t.order_book', 'ob').addSelect(['ob.ob_id', 'ob.ob_option']);
    qb.leftJoin('t.bank_user', 'bu').addSelect([
      'bu.bu_id',
      'bu.bu_user_id',
      'bu.bu_bank_name',
      'bu.bu_passbook_image_url',
      'bu.bu_bank_account_name',
      'bu.bu_bank_account_number',
    ]);

    if (query.status) {
      qb.andWhere('t.trans_status = :st', { st: query.status });
    }
    if (query.dateFrom) {
      qb.andWhere('t.trans_created_at >= :df', {
        df: new Date(query.dateFrom),
      });
    }
    if (query.dateTo) {
      qb.andWhere('t.trans_created_at <= :dt', {
        dt: new Date(query.dateTo),
      });
    }
    if (query.option !== undefined) {
      qb.andWhere('t.trans_option = :opt', { opt: query.option });
    }
    if (query.coinId !== undefined) {
      qb.andWhere('t.trans_coin = :coin', { coin: query.coinId });
    }
    if (query.nationalCurrencyId !== undefined) {
      qb.andWhere('t.trans_national = :nat', { nat: query.nationalCurrencyId });
    }
    if (query.amountMin !== undefined) {
      qb.andWhere('t.trans_amount >= :amin', {
        amin: this.formatAmount(query.amountMin),
      });
    }
    if (query.amountMax !== undefined) {
      qb.andWhere('t.trans_amount <= :amax', {
        amax: this.formatAmount(query.amountMax),
      });
    }

    if (query.sortAmount === 'asc') {
      qb.orderBy('t.trans_amount', 'ASC').addOrderBy('t.trans_id', 'DESC');
    } else if (query.sortAmount === 'desc') {
      qb.orderBy('t.trans_amount', 'DESC').addOrderBy('t.trans_id', 'DESC');
    } else {
      qb.orderBy('t.trans_id', 'DESC');
    }
    qb.skip((page - 1) * limit).take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      statusCode: 200,
      data: rows.map((t) => this.toTransactionResponse(t)),
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getTransactionDetail(userId: number, id: number) {
    const transaction = await this.transactionRepository
      .createQueryBuilder('t')
      .leftJoin('t.user_buy', 'ub')
      .addSelect(['ub.uid', 'ub.uname', 'ub.ufulllname', 'ub.uavatar'])
      .leftJoin('t.user_sell', 'us')
      .addSelect(['us.uid', 'us.uname', 'us.ufulllname', 'us.uavatar'])
      .leftJoin('t.order_book', 'ob')
      .addSelect(['ob.ob_id', 'ob.ob_option'])
      .leftJoin('t.bank_user', 'bu')
      .addSelect([
        'bu.bu_id',
        'bu.bu_user_id',
        'bu.bu_bank_name',
        'bu.bu_passbook_image_url',
        'bu.bu_bank_account_name',
        'bu.bu_bank_account_number',
      ])
      .where('t.trans_id = :id', { id })
      .getOne();
    if (!transaction) throw new NotFoundException('Transaction not found');
    if (
      transaction.trans_user_buy !== userId &&
      transaction.trans_user_sell !== userId
    ) {
      throw new ForbiddenException(
        'You do not have permission to view this transaction',
      );
    }
    return this.toTransactionResponse(transaction);
  }

  async confirmPayment(userId: number, id: number, dto: ConfirmPaymentDto) {
    const transaction = await this.transactionRepository.findOne({
      where: { trans_id: id },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    if (transaction.trans_user_buy !== userId) {
      throw new ForbiddenException(
        'Only the buyer can confirm payment for this transaction',
      );
    }
    if (transaction.trans_status !== TransactionStatus.PENDING) {
      throw new BadRequestException(
        'Only pending transaction can be confirmed',
      );
    }
    transaction.trans_status = TransactionStatus.PAYMENT_CONFIRMED;
    transaction.trans_time_bank = new Date();
    transaction.trans_payment_proof_urls = [...dto.proofUrls];
    transaction.trans_expired_at = new Date(
      Date.now() + TRANSACTION_EXPIRY_DELAY_MS,
    );
    const saved = await this.transactionRepository.save(transaction);
    void this.sendPaymentConfirmedEmailToSeller(saved).catch((error) => {
      console.error(
        `Failed to send payment_confirmed email for transaction ${saved.trans_id}:`,
        error,
      );
    });
    void this.transactionExpiryQueue
      .scheduleExpiry(saved.trans_id, TransactionStatus.PAYMENT_CONFIRMED)
      .catch((err) => {
        console.error(
          `Failed to schedule payment_confirmed expiry job for transaction ${saved.trans_id}:`,
          err,
        );
      });
    const hydrated = await this.loadTransactionWithUsers(
      this.transactionRepository,
      saved.trans_id,
    );
    const response = this.toTransactionResponse(hydrated ?? saved);
    void this.notificationsService
      .createForUser({
        userId: saved.trans_user_sell,
        type: NotificationType.TRANSACTION,
        title: 'Buyer confirmed payment',
        message: `Buyer has marked payment as completed for transaction ${saved.transs_reference_code}. Please verify and confirm receipt.`,
        data: {
          transaction_id: saved.trans_id,
          reference_code: saved.transs_reference_code,
          status: saved.trans_status,
        },
      })
      .catch((err) => {
        console.error(
          `Failed seller notification after payment_confirmed tx ${saved.trans_id}:`,
          err,
        );
      });
    return response;
  }

  async confirmReceived(userId: number, id: number) {
    const [totalFeePercent, smartrefFeePercent] = await Promise.all([
      this.getP2pOrderbookFeePercentTotal(),
      this.adminSettingsConfigService.getSmartrefFeePercent(),
    ]);

    const result = await this.dataSource.transaction(async (manager) => {
      const transaction = await manager.findOne(Transaction, {
        where: { trans_id: id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transaction) throw new NotFoundException('Transaction not found');
      if (
        transaction.trans_user_buy !== userId &&
        transaction.trans_user_sell !== userId
      ) {
        throw new ForbiddenException(
          'You are not a participant in this transaction',
        );
      }

      const viewerForTradeBlock = await manager.findOne(User, {
        where: { uid: userId },
        select: ['ustatus'],
      });
      if (
        viewerForTradeBlock?.ustatus === UserStatus.BLOCK_TRADE &&
        transaction.trans_status !== TransactionStatus.PAYMENT_CONFIRMED
      ) {
        throw new ForbiddenException(
          'Trading is blocked for your account. Please contact support.',
        );
      }

      if (transaction.trans_status !== TransactionStatus.PAYMENT_CONFIRMED) {
        throw new BadRequestException(
          'Only payment_confirmed transaction can be executed',
        );
      }

      const amount = this.toNumber(transaction.trans_amount);

      let orderBook: OrderBook | null = null;
      if (transaction.trans_order_book != null) {
        orderBook = await manager.findOne(OrderBook, {
          where: { ob_id: transaction.trans_order_book },
          lock: { mode: 'pessimistic_write' },
        });
      }

      const sellerLockDebit = this.computeSellerLockDebitForExecute(
        amount,
        totalFeePercent,
        orderBook,
        transaction.trans_user_sell,
        transaction.trans_user_buy,
      );

      const toBuyer = amount;

      const sellerWallet = await manager.findOne(UserWallet, {
        where: {
          uw_user_id: transaction.trans_user_sell,
          uw_wallet_coins: transaction.trans_coin,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!sellerWallet) throw new NotFoundException('Seller wallet not found');

      const buyerWallet = await manager.findOne(UserWallet, {
        where: {
          uw_user_id: transaction.trans_user_buy,
          uw_wallet_coins: transaction.trans_coin,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!buyerWallet) throw new NotFoundException('Buyer wallet not found');

      const sellerLock = this.toNumber(sellerWallet.uw_lock_balance);
      if (sellerLock < sellerLockDebit) {
        throw new BadRequestException('Seller lock balance is not enough');
      }

      sellerWallet.uw_lock_balance = sellerLock - sellerLockDebit;

      const isSellListing =
        orderBook !== null && orderBook.ob_option === OrderBookOption.SELL;

      if (isSellListing) {
        const buyerLock = this.toNumber(buyerWallet.uw_lock_balance);
        buyerWallet.uw_lock_balance = buyerLock + toBuyer;
        transaction.trans_coin_unlock_at = new Date(
          Date.now() + P2P_SELL_LISTING_BUYER_COIN_UNLOCK_DELAY_MS,
        );
        transaction.trans_lock_released_at = null;
      } else {
        buyerWallet.uw_balance =
          this.toNumber(buyerWallet.uw_balance) + toBuyer;
        transaction.trans_coin_unlock_at = null;
        transaction.trans_lock_released_at = new Date();
      }

      await manager.save(UserWallet, sellerWallet);
      await manager.save(UserWallet, buyerWallet);

      transaction.trans_status = TransactionStatus.EXECUTED;
      const saved = await manager.save(Transaction, transaction);

      const hydrated = await this.loadTransactionWithUsers(
        (manager as any).getRepository(Transaction),
        saved.trans_id,
      );
      return {
        response: this.toTransactionResponse(hydrated ?? saved),
        buyerId: transaction.trans_user_buy,
        sellerId: transaction.trans_user_sell,
        transactionId: saved.trans_id,
        amount,
        smartrefFeePercent,
      };
    });

    // Side effects after commit: không await — trả response ngay; lỗi chỉ log (nên có queue/retry ở production).
    if (result.smartrefFeePercent > 0) {
      const smartrefRewardAmount = this.toNumber(
        this.formatAmount((result.amount * result.smartrefFeePercent) / 100),
      );
      void this.smartRefService
        .disputeSmartref(result.sellerId, smartrefRewardAmount)
        .catch((error) => {
          console.error(
            `Failed to distribute smartref rewards for seller ${result.sellerId} on tx ${result.transactionId}:`,
            error,
          );
        });
    }

    void this.transactionRepository
      .findOne({ where: { trans_id: result.transactionId } })
      .then((executedTransaction) => {
        if (!executedTransaction) return;
        return this.sendExecutedEmailToBuyer(executedTransaction);
      })
      .catch((error) => {
        console.error(
          `Failed executed-email path for transaction ${result.transactionId}:`,
          error,
        );
      });

    void this.notifyUsers(
      [result.buyerId, result.sellerId],
      'Transaction completed',
      `Transaction ${result.response.reference_code} has been completed successfully.`,
      {
        transaction_id: result.response.id,
        reference_code: result.response.reference_code,
        status: result.response.status,
      },
    ).catch((error) => {
      console.error(
        `Failed notify users after tx ${result.transactionId} executed:`,
        error,
      );
    });

    return result.response;
  }

  async cancelTransaction(userId: number, id: number) {
    return this.dataSource
      .transaction(async (manager) => {
        const transaction = await manager.findOne(Transaction, {
          where: { trans_id: id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!transaction) throw new NotFoundException('Transaction not found');
        if (
          transaction.trans_user_buy !== userId &&
          transaction.trans_user_sell !== userId
        ) {
          throw new ForbiddenException(
            'You are not a participant in this transaction',
          );
        }
        if (transaction.trans_status !== TransactionStatus.PENDING) {
          throw new BadRequestException(
            'Only pending transaction can be cancelled',
          );
        }

        const orderBook = await manager.findOne(OrderBook, {
          where: { ob_id: transaction.trans_order_book ?? 0 },
          lock: { mode: 'pessimistic_write' },
        });
        if (!orderBook) {
          throw new NotFoundException(
            'Order book not found for this transaction',
          );
        }

        const amount = this.toNumber(transaction.trans_amount);
        const buyLockTotal =
          orderBook.ob_option === OrderBookOption.BUY
            ? await this.computeBuyOrderbookSellerLockCoinAmount(amount)
            : amount;
        const remaining = this.toNumber(orderBook.ob_amount_remaining);
        orderBook.ob_amount_remaining = this.formatAmount(remaining + amount);
        if (orderBook.ob_status === OrderBookStatus.EXECUTED) {
          orderBook.ob_status = OrderBookStatus.PENDING;
        }
        await manager.save(OrderBook, orderBook);

        if (orderBook.ob_option === OrderBookOption.BUY) {
          const sellerWallet = await manager.findOne(UserWallet, {
            where: {
              uw_user_id: transaction.trans_user_sell,
              uw_wallet_coins: transaction.trans_coin,
            },
            lock: { mode: 'pessimistic_write' },
          });
          if (!sellerWallet)
            throw new NotFoundException('Seller wallet not found');

          const lockBalance = this.toNumber(sellerWallet.uw_lock_balance);
          if (lockBalance < buyLockTotal) {
            throw new BadRequestException(
              'Seller lock balance is not enough to unlock',
            );
          }

          sellerWallet.uw_lock_balance = lockBalance - buyLockTotal;
          sellerWallet.uw_balance =
            this.toNumber(sellerWallet.uw_balance) + buyLockTotal;
          await manager.save(UserWallet, sellerWallet);
        }

        transaction.trans_status = TransactionStatus.CANCELLED;
        const saved = await manager.save(Transaction, transaction);

        const hydrated = await this.loadTransactionWithUsers(
          (manager as any).getRepository(Transaction),
          saved.trans_id,
        );
        return this.toTransactionResponse(hydrated ?? saved);
      })
      .then((response) => {
        void this.notifyUsers(
          [response.user_buy?.id, response.user_sell?.id],
          'Transaction cancelled',
          `Transaction ${response.reference_code} has been cancelled.`,
          {
            transaction_id: response.id,
            reference_code: response.reference_code,
            status: response.status,
          },
        ).catch((err) => {
          console.error(
            `Failed notify on cancel transaction ${response.reference_code}:`,
            err,
          );
        });
        return response;
      });
  }

  private toDisputeResponse(d: Dispute) {
    const transaction = (d as any).transaction as
      | Transaction
      | null
      | undefined;
    const orderBook = (transaction as any)?.order_book as
      | OrderBook
      | null
      | undefined;

    return {
      id: d.dispute_id,
      transaction_id: d.dispute_transaction_id,
      initiator_id: d.dispute_initiator_id,
      responder_id: d.dispute_responder_id,
      initiator: this.toPublicUser((d as any).initiator),
      responder: this.toPublicUser((d as any).responder),
      transaction: transaction ? this.toTransactionResponse(transaction) : null,
      orderbook: this.toOrderBookResponse(orderBook),
      type: d.dispute_type,
      reason: d.dispute_reason,
      evidence: d.dispute_evidence,
      status: d.dispute_status,
      admin_id: d.dispute_admin_id,
      resolution: d.dispute_resolution,
      created_at: d.dispute_created_at,
      updated_at: d.dispute_updated_at,
      resolved_at: d.dispute_resolved_at,
    };
  }

  async createDispute(
    userId: number,
    transactionId: number,
    dto: CreateDisputeDto,
  ) {
    const tx = await this.transactionRepository.findOne({
      where: { trans_id: transactionId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const isBuyer = tx.trans_user_buy === userId;
    const isSeller = tx.trans_user_sell === userId;
    if (!isBuyer && !isSeller) {
      throw new ForbiddenException(
        'You are not a participant in this transaction',
      );
    }

    const existingActive = await this.disputeRepository.findOne({
      where: {
        dispute_transaction_id: transactionId,
        dispute_status: In([DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW]),
      },
    });
    if (existingActive) {
      throw new BadRequestException(
        'An active dispute already exists for this transaction',
      );
    }

    const dispute = this.disputeRepository.create({
      dispute_transaction_id: transactionId,
      dispute_initiator_id: userId,
      dispute_responder_id: isBuyer ? tx.trans_user_sell : tx.trans_user_buy,
      dispute_type: dto.type as DisputeType,
      dispute_reason: dto.reason,
      dispute_evidence: dto.evidence ?? null,
      dispute_status: DisputeStatus.OPEN,
      dispute_admin_id: null,
      dispute_resolution: null,
      dispute_resolved_at: null,
    });

    const saved = await this.disputeRepository.save(dispute);

    if (!tx.trans_dispute_status) {
      tx.trans_dispute_status = true;
      await this.transactionRepository.save(tx);
    }

    const hydrated = await this.findDisputeWithRelations(saved.dispute_id);
    const response = this.toDisputeResponse(hydrated ?? saved);
    void this.notificationsService
      .createForUser({
        userId: dispute.dispute_responder_id,
        type: NotificationType.TRANSACTION,
        title: 'New dispute opened',
        message: `A dispute has been opened for transaction ${tx.transs_reference_code}. Please review the dispute details.`,
        data: {
          dispute_id: response.id,
          transaction_id: tx.trans_id,
          reference_code: tx.transs_reference_code,
          status: response.status,
        },
      })
      .catch((err) => {
        console.error(
          `Failed notify responder for dispute ${response.id}:`,
          err,
        );
      });

    this.adminNotificationsService.notifySuperAdmins({
      type: NotificationType.TRANSACTION,
      title: 'Dispute opened',
      message: `Dispute #${response.id} opened on transaction ${tx.transs_reference_code}.`,
      data: {
        dispute_id: response.id,
        transaction_id: tx.trans_id,
        reference_code: tx.transs_reference_code,
      },
    });

    return response;
  }

  async getMyDisputes(userId: number) {
    const rows = await this.disputeQueryBuilder()
      .where('d.dispute_initiator_id = :userId', { userId })
      .orderBy('d.dispute_created_at', 'DESC')
      .getMany();
    return rows.map((d) => this.toDisputeResponse(d));
  }

  async getMyDisputeDetail(userId: number, disputeId: number) {
    const d = await this.findDisputeWithRelations(disputeId);
    if (!d) throw new NotFoundException('Dispute not found');
    if (d.dispute_initiator_id !== userId) {
      throw new ForbiddenException(
        'You do not have permission to view this dispute',
      );
    }
    return this.toDisputeResponse(d);
  }

  async adminGetDisputes(adminId: number, query: QueryDisputesDto) {
    const admin = await this.adminRepository.findOne({
      where: { admin_id: adminId },
    });
    if (!admin) throw new ForbiddenException('Admin not found');

    const qb = this.disputeQueryBuilder().orderBy(
      'd.dispute_created_at',
      'DESC',
    );
    if (query.status) {
      qb.andWhere('d.dispute_status = :status', { status: query.status });
    }
    const rows = await qb.getMany();
    return rows.map((d) => this.toDisputeResponse(d));
  }

  async adminGetDisputeDetail(adminId: number, disputeId: number) {
    const admin = await this.adminRepository.findOne({
      where: { admin_id: adminId },
    });
    if (!admin) throw new ForbiddenException('Admin not found');

    const d = await this.findDisputeWithRelations(disputeId);
    if (!d) throw new NotFoundException('Dispute not found');
    return this.toDisputeResponse(d);
  }

  /** Admin trade-block: cancel every pending tx where user is buyer or seller. */
  async cancelAllPendingTransactionsForUser(userId: number): Promise<number> {
    const txs = await this.transactionRepository
      .createQueryBuilder('t')
      .where('t.trans_status = :st', { st: TransactionStatus.PENDING })
      .andWhere('(t.trans_user_buy = :uid OR t.trans_user_sell = :uid)', {
        uid: userId,
      })
      .getMany();
    for (const tx of txs) {
      await this.cancelTransaction(userId, tx.trans_id);
    }
    return txs.length;
  }
}
