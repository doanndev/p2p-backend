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
        throw new BadRequestException('You cannot trade with your own order book');
      }

      const remaining = this.toNumber(orderBook.ob_amount_remaining);
      if (dto.amount <= 0 || dto.amount > remaining) {
        throw new BadRequestException('Invalid transaction amount');
      }

      const buyerId =
        orderBook.ob_option === OrderBookOption.SELL ? userId : orderBook.ob_user_id;
      const sellerId =
        orderBook.ob_option === OrderBookOption.SELL ? orderBook.ob_user_id : userId;

      if (orderBook.ob_option === OrderBookOption.BUY) {
        const sellerWallet = await manager.findOne(UserWallet, {
          where: { uw_user_id: sellerId, uw_wallet_coins: orderBook.ob_coin },
          lock: { mode: 'pessimistic_write' },
        });
        if (!sellerWallet) throw new NotFoundException('Seller wallet not found');

        const sellerAvailableBalance = this.toNumber(sellerWallet.uw_balance);
        if (sellerAvailableBalance < dto.amount) {
          throw new BadRequestException('Seller does not have enough available balance');
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

      return manager.save(Transaction, transaction);
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
    return this.transactionRepository.find({ where, order: { trans_id: 'DESC' } });
  }

  async getTransactionDetail(userId: number, id: number) {
    const transaction = await this.transactionRepository.findOne({ where: { trans_id: id } });
    if (!transaction) throw new NotFoundException('Transaction not found');
    if (transaction.trans_user_buy !== userId && transaction.trans_user_sell !== userId) {
      throw new ForbiddenException('You do not have permission to view this transaction');
    }
    return transaction;
  }

  async confirmPayment(userId: number, id: number) {
    const transaction = await this.transactionRepository.findOne({ where: { trans_id: id } });
    if (!transaction) throw new NotFoundException('Transaction not found');
    if (transaction.trans_user_buy !== userId && transaction.trans_user_sell !== userId) {
      throw new ForbiddenException('You are not a participant in this transaction');
    }
    if (transaction.trans_status !== TransactionStatus.PENDDING) {
      throw new BadRequestException('Only pending transaction can be confirmed');
    }
    transaction.trans_status = TransactionStatus.PAYMENT_CONFIRMED;
    transaction.trans_time_bank = new Date();
    return this.transactionRepository.save(transaction);
  }

  async confirmReceived(userId: number, id: number) {
    return this.dataSource.transaction(async (manager) => {
      const transaction = await manager.findOne(Transaction, {
        where: { trans_id: id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transaction) throw new NotFoundException('Transaction not found');
      if (transaction.trans_user_buy !== userId && transaction.trans_user_sell !== userId) {
        throw new ForbiddenException('You are not a participant in this transaction');
      }
      if (transaction.trans_status !== TransactionStatus.PAYMENT_CONFIRMED) {
        throw new BadRequestException('Only payment_confirmed transaction can be executed');
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
      buyerWallet.uw_lock_balance = this.toNumber(buyerWallet.uw_lock_balance) + amount;

      await manager.save(UserWallet, sellerWallet);
      await manager.save(UserWallet, buyerWallet);

      transaction.trans_status = TransactionStatus.EXECUTED;
      await manager.save(Transaction, transaction);
      return transaction;
    });
  }

  async cancelTransaction(userId: number, id: number) {
    return this.dataSource.transaction(async (manager) => {
      const transaction = await manager.findOne(Transaction, {
        where: { trans_id: id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transaction) throw new NotFoundException('Transaction not found');
      if (transaction.trans_user_buy !== userId && transaction.trans_user_sell !== userId) {
        throw new ForbiddenException('You are not a participant in this transaction');
      }
      if (transaction.trans_status !== TransactionStatus.PENDDING) {
        throw new BadRequestException('Only pending transaction can be cancelled');
      }

      const orderBook = await manager.findOne(OrderBook, {
        where: { ob_id: transaction.trans_order_book ?? 0 },
        lock: { mode: 'pessimistic_write' },
      });
      if (!orderBook) {
        throw new NotFoundException('Order book not found for this transaction');
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
        if (!sellerWallet) throw new NotFoundException('Seller wallet not found');

        const lockBalance = this.toNumber(sellerWallet.uw_lock_balance);
        if (lockBalance < amount) {
          throw new BadRequestException('Seller lock balance is not enough to unlock');
        }

        sellerWallet.uw_lock_balance = lockBalance - amount;
        sellerWallet.uw_balance = this.toNumber(sellerWallet.uw_balance) + amount;
        await manager.save(UserWallet, sellerWallet);
      }

      transaction.trans_status = TransactionStatus.CANCELLED;
      await manager.save(Transaction, transaction);
      return transaction;
    });
  }
}
