import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
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
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';
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

      return {
        id: saved.trans_id,
        reference_code: saved.transs_reference_code,
        user_buy: saved.trans_user_buy,
        user_sell: saved.trans_user_sell,
        coin: saved.trans_coin,
        national: saved.trans_national,
        order_book: saved.trans_order_book,
        option: saved.trans_option,
        type: saved.trans_type,
        coin_symbol: saved.trans_coin_symbol,
        national_symbol: saved.trans_national_symbol,
        amount: saved.trans_amount,
        price: saved.trans_price,
        price_usd: saved.trans_price_usd,
        total_price: saved.trans_total_price,
        total_usd: saved.trans_total_usd,
        dispute_status: saved.trans_dispute_status,
        time_bank: saved.trans_time_bank,
        status: saved.trans_status,
        message: saved.trans_message,
      };
    });
  }

  async getTransactions(userId: number, status?: TransactionStatus) {
    const where: FindOptionsWhere<Transaction>[] = [
      { trans_user_buy: userId },
      { trans_user_sell: userId },
    ];
    if (status) {
      where[0].trans_status = status;
      where[1].trans_status = status;
    }
    const rows = await this.transactionRepository.find({
      where,
      order: { trans_id: 'DESC' },
    });
    return rows.map((t) => ({
      id: t.trans_id,
      reference_code: t.transs_reference_code,
      user_buy: t.trans_user_buy,
      user_sell: t.trans_user_sell,
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
    }));
  }

  async getTransactionDetail(userId: number, id: number) {
    const transaction = await this.transactionRepository.findOne({
      where: { trans_id: id },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    if (
      transaction.trans_user_buy !== userId &&
      transaction.trans_user_sell !== userId
    ) {
      throw new ForbiddenException(
        'You do not have permission to view this transaction',
      );
    }
    return {
      id: transaction.trans_id,
      reference_code: transaction.transs_reference_code,
      user_buy: transaction.trans_user_buy,
      user_sell: transaction.trans_user_sell,
      coin: transaction.trans_coin,
      national: transaction.trans_national,
      order_book: transaction.trans_order_book,
      option: transaction.trans_option,
      type: transaction.trans_type,
      coin_symbol: transaction.trans_coin_symbol,
      national_symbol: transaction.trans_national_symbol,
      amount: transaction.trans_amount,
      price: transaction.trans_price,
      price_usd: transaction.trans_price_usd,
      total_price: transaction.trans_total_price,
      total_usd: transaction.trans_total_usd,
      dispute_status: transaction.trans_dispute_status,
      time_bank: transaction.trans_time_bank,
      status: transaction.trans_status,
      message: transaction.trans_message,
    };
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
    return {
      id: saved.trans_id,
      reference_code: saved.transs_reference_code,
      user_buy: saved.trans_user_buy,
      user_sell: saved.trans_user_sell,
      coin: saved.trans_coin,
      national: saved.trans_national,
      order_book: saved.trans_order_book,
      option: saved.trans_option,
      type: saved.trans_type,
      coin_symbol: saved.trans_coin_symbol,
      national_symbol: saved.trans_national_symbol,
      amount: saved.trans_amount,
      price: saved.trans_price,
      price_usd: saved.trans_price_usd,
      total_price: saved.trans_total_price,
      total_usd: saved.trans_total_usd,
      dispute_status: saved.trans_dispute_status,
      time_bank: saved.trans_time_bank,
      status: saved.trans_status,
      message: saved.trans_message,
    };
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

      return {
        id: saved.trans_id,
        reference_code: saved.transs_reference_code,
        user_buy: saved.trans_user_buy,
        user_sell: saved.trans_user_sell,
        coin: saved.trans_coin,
        national: saved.trans_national,
        order_book: saved.trans_order_book,
        option: saved.trans_option,
        type: saved.trans_type,
        coin_symbol: saved.trans_coin_symbol,
        national_symbol: saved.trans_national_symbol,
        amount: saved.trans_amount,
        price: saved.trans_price,
        price_usd: saved.trans_price_usd,
        total_price: saved.trans_total_price,
        total_usd: saved.trans_total_usd,
        dispute_status: saved.trans_dispute_status,
        time_bank: saved.trans_time_bank,
        status: saved.trans_status,
        message: saved.trans_message,
      };
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

      return {
        id: saved.trans_id,
        reference_code: saved.transs_reference_code,
        user_buy: saved.trans_user_buy,
        user_sell: saved.trans_user_sell,
        coin: saved.trans_coin,
        national: saved.trans_national,
        order_book: saved.trans_order_book,
        option: saved.trans_option,
        type: saved.trans_type,
        coin_symbol: saved.trans_coin_symbol,
        national_symbol: saved.trans_national_symbol,
        amount: saved.trans_amount,
        price: saved.trans_price,
        price_usd: saved.trans_price_usd,
        total_price: saved.trans_total_price,
        total_usd: saved.trans_total_usd,
        dispute_status: saved.trans_dispute_status,
        time_bank: saved.trans_time_bank,
        status: saved.trans_status,
        message: saved.trans_message,
      };
    });
  }
}
