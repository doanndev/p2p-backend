import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
import { User } from '../users/entities/user.entity';
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query.dto';
import { ChatRoom, ChatRoomStatus } from '../chat/entities/chat-room.entity';

@Injectable()
export class TransactionService {
  constructor(
    @InjectRepository(OrderBook)
    private readonly orderBookRepository: Repository<OrderBook>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(UserWallet)
    private readonly userWalletRepository: Repository<UserWallet>,
    private readonly dataSource: DataSource,
  ) {}

  private toNumber(value: string | number): number {
    return typeof value === 'number' ? value : Number(value);
  }

  private formatAmount(value: number): string {
    return value.toFixed(8);
  }

  private generateReferenceCode(): string {
    return `TX-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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

  private toTransactionResponse(t: Transaction) {
    return {
      id: t.trans_id,
      reference_code: t.transs_reference_code,
      user_buy: this.toPublicUser((t as any).user_buy),
      user_sell: this.toPublicUser((t as any).user_sell),
      coin: t.trans_coin,
      national: t.trans_national,
      order_book: t.trans_order_book,
      option: t.trans_option,
      type: t.trans_type,
      coin_symbol: t.trans_coin_symbol,
      national_symbol: t.trans_national_symbol,
      amount: t.trans_amount,
      price: t.trans_price,
      price_usd: t.trans_price_usd,
      total_price: t.trans_total_price,
      total_usd: t.trans_total_usd,
      dispute_status: t.trans_dispute_status,
      time_bank: t.trans_time_bank,
      status: t.trans_status,
      message: t.trans_message,
      created_at: t.trans_created_at,
    };
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
      .where('t.trans_id = :id', { id })
      .getOne();
  }

  async createTransaction(userId: number, dto: CreateTransactionDto) {
    return this.dataSource.transaction(async (manager) => {
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

      if (orderBook.ob_option === OrderBookOption.BUY) {
        const sellerWallet = await manager.findOne(UserWallet, {
          where: { uw_user_id: sellerId, uw_wallet_coins: orderBook.ob_coin },
          lock: { mode: 'pessimistic_write' },
        });
        if (!sellerWallet)
          throw new NotFoundException('Seller wallet not found');

        const sellerAvailableBalance = this.toNumber(sellerWallet.uw_balance);
        if (sellerAvailableBalance < dto.amount) {
          throw new BadRequestException(
            'Seller does not have enough available balance',
          );
        }

        sellerWallet.uw_balance = sellerAvailableBalance - dto.amount;
        sellerWallet.uw_lock_balance =
          this.toNumber(sellerWallet.uw_lock_balance) + dto.amount;
        await manager.save(UserWallet, sellerWallet);
      }

      orderBook.ob_amount_remaining = this.formatAmount(remaining - dto.amount);
      if (this.toNumber(orderBook.ob_amount_remaining) <= 0) {
        orderBook.ob_status = OrderBookStatus.EXECUTED;
      }
      await manager.save(OrderBook, orderBook);

      const amount = dto.amount;
      const price = this.toNumber(orderBook.ob_price);
      const total = amount * price;

      const transaction = manager.create(Transaction, {
        transs_reference_code: this.generateReferenceCode(),
        trans_user_buy: buyerId,
        trans_user_sell: sellerId,
        trans_coin: orderBook.ob_coin,
        trans_national: orderBook.ob_national,
        trans_order_book: orderBook.ob_id,
        trans_option:
          orderBook.ob_option === OrderBookOption.SELL
            ? TransactionOption.BUY
            : TransactionOption.SELL,
        trans_type: dto.type ?? TransactionType.BANKING,
        trans_coin_symbol: orderBook.ob_coin_symbol,
        trans_national_symbol: orderBook.ob_national_symbol,
        trans_amount: this.formatAmount(amount),
        trans_price: this.formatAmount(price),
        trans_price_usd: this.formatAmount(price),
        trans_total_price: this.formatAmount(total),
        trans_total_usd: this.formatAmount(total),
        trans_dispute_status: false,
        trans_time_bank: null,
        trans_status: TransactionStatus.PENDDING,
        trans_message: null,
      });

      const saved = await manager.save(Transaction, transaction);

      // Create chat room for this transaction (pending 30 minutes window).
      const existingRoom = await manager.findOne(ChatRoom, {
        where: { room_transaction_id: saved.trans_id },
      });
      if (!existingRoom) {
        const room = manager.create(ChatRoom, {
          room_transaction_id: saved.trans_id,
          room_buyer_id: saved.trans_user_buy,
          room_seller_id: saved.trans_user_sell,
          room_status: ChatRoomStatus.ACTIVE,
          room_created_at: new Date(),
          room_closed_at: null,
        });
        await manager.save(ChatRoom, room);
      }

      const hydrated = await this.loadTransactionWithUsers(
        (manager as any).getRepository(Transaction),
        saved.trans_id,
      );
      return this.toTransactionResponse(hydrated ?? saved);
    });
  }

  async getTransactions(userId: number, query: QueryTransactionsDto) {
    const qb = this.transactionRepository
      .createQueryBuilder('t')
      .where(
        '(t.trans_user_buy = :uid OR t.trans_user_sell = :uid)',
        { uid: userId },
      );

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

    const rows = await qb.getMany();
    return rows.map((t) => this.toTransactionResponse(t));
  }

  async getTransactionDetail(userId: number, id: number) {
    const transaction = await this.transactionRepository
      .createQueryBuilder('t')
      .leftJoin('t.user_buy', 'ub')
      .addSelect(['ub.uid', 'ub.uname', 'ub.ufulllname', 'ub.uavatar'])
      .leftJoin('t.user_sell', 'us')
      .addSelect(['us.uid', 'us.uname', 'us.ufulllname', 'us.uavatar'])
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

  async confirmPayment(userId: number, id: number) {
    const transaction = await this.transactionRepository.findOne({
      where: { trans_id: id },
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
    if (transaction.trans_status !== TransactionStatus.PENDDING) {
      throw new BadRequestException(
        'Only pending transaction can be confirmed',
      );
    }
    transaction.trans_status = TransactionStatus.PAYMENT_CONFIRMED;
    transaction.trans_time_bank = new Date();
    const saved = await this.transactionRepository.save(transaction);
    const hydrated = await this.loadTransactionWithUsers(
      this.transactionRepository,
      saved.trans_id,
    );
    return this.toTransactionResponse(hydrated ?? saved);
  }

  async confirmReceived(userId: number, id: number) {
    return this.dataSource.transaction(async (manager) => {
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
      if (transaction.trans_status !== TransactionStatus.PAYMENT_CONFIRMED) {
        throw new BadRequestException(
          'Only payment_confirmed transaction can be executed',
        );
      }

      const amount = this.toNumber(transaction.trans_amount);
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
      if (sellerLock < amount) {
        throw new BadRequestException('Seller lock balance is not enough');
      }

      sellerWallet.uw_lock_balance = sellerLock - amount;
      buyerWallet.uw_lock_balance =
        this.toNumber(buyerWallet.uw_lock_balance) + amount;

      await manager.save(UserWallet, sellerWallet);
      await manager.save(UserWallet, buyerWallet);

      transaction.trans_status = TransactionStatus.EXECUTED;
      const saved = await manager.save(Transaction, transaction);

      // Close chat room when completed
      await manager
        .createQueryBuilder()
        .update(ChatRoom)
        .set({ room_status: ChatRoomStatus.CLOSED, room_closed_at: new Date() })
        .where('room_transaction_id = :txId', { txId: saved.trans_id })
        .andWhere('room_status = :status', { status: ChatRoomStatus.ACTIVE })
        .execute();

      const hydrated = await this.loadTransactionWithUsers(
        (manager as any).getRepository(Transaction),
        saved.trans_id,
      );
      return this.toTransactionResponse(hydrated ?? saved);
    });
  }

  async cancelTransaction(userId: number, id: number) {
    return this.dataSource.transaction(async (manager) => {
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
      if (transaction.trans_status !== TransactionStatus.PENDDING) {
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
        if (lockBalance < amount) {
          throw new BadRequestException(
            'Seller lock balance is not enough to unlock',
          );
        }

        sellerWallet.uw_lock_balance = lockBalance - amount;
        sellerWallet.uw_balance =
          this.toNumber(sellerWallet.uw_balance) + amount;
        await manager.save(UserWallet, sellerWallet);
      }

      transaction.trans_status = TransactionStatus.CANCELLED;
      const saved = await manager.save(Transaction, transaction);

      // Close chat room when cancelled
      await manager
        .createQueryBuilder()
        .update(ChatRoom)
        .set({ room_status: ChatRoomStatus.CLOSED, room_closed_at: new Date() })
        .where('room_transaction_id = :txId', { txId: saved.trans_id })
        .andWhere('room_status = :status', { status: ChatRoomStatus.ACTIVE })
        .execute();

      const hydrated = await this.loadTransactionWithUsers(
        (manager as any).getRepository(Transaction),
        saved.trans_id,
      );
      return this.toTransactionResponse(hydrated ?? saved);
    });
  }
}
