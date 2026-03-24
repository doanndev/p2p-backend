import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OrderBook, OrderBookStatus } from './entities/order-book.entity';
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import { CreateOrderbookDto } from './dto/create-orderbook.dto';
import { UpdateOrderbookDto } from './dto/update-orderbook.dto';

@Injectable()
export class OrderbookService {
  constructor(
    @InjectRepository(OrderBook)
    private readonly orderBookRepository: Repository<OrderBook>,
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

  private generateAdvCode(): string {
    return `ADV-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  async createOrderBook(userId: number, dto: CreateOrderbookDto) {
    return this.dataSource.transaction(async (manager) => {
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

      const balance = this.toNumber(wallet.uw_balance);
      if (balance < dto.amount) {
        throw new BadRequestException('Insufficient available balance');
      }

      wallet.uw_balance = balance - dto.amount;
      wallet.uw_lock_balance = this.toNumber(wallet.uw_lock_balance) + dto.amount;
      await manager.save(UserWallet, wallet);

      const orderBook = manager.create(OrderBook, {
        ob_user_id: userId,
        ob_coin: dto.coinId,
        ob_national: dto.nationalCurrencyId,
        ob_adv_code: this.generateAdvCode(),
        ob_option: dto.option,
        ob_coin_symbol: dto.coinSymbol,
        ob_national_symbol: dto.nationalSymbol,
        ob_amount: this.formatAmount(dto.amount),
        ob_amount_remaining: this.formatAmount(dto.amount),
        ob_price: this.formatAmount(dto.price),
        ob_national_min:
          dto.nationalMin === undefined ? null : this.formatAmount(dto.nationalMin),
        ob_national_max:
          dto.nationalMax === undefined ? null : this.formatAmount(dto.nationalMax),
        ob_status: OrderBookStatus.PENDING,
      });

      return manager.save(OrderBook, orderBook);
    });
  }

  async getOrderBooks() {
    return this.orderBookRepository.find({
      where: { ob_status: OrderBookStatus.PENDING },
      order: { ob_id: 'DESC' },
    });
  }

  async getOrderBookDetail(id: number) {
    const orderBook = await this.orderBookRepository.findOne({
      where: { ob_id: id },
    });
    if (!orderBook) {
      throw new NotFoundException('Order book not found');
    }
    return orderBook;
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
    if (dto.nationalMin !== undefined) {
      orderBook.ob_national_min =
        dto.nationalMin === null ? null : this.formatAmount(dto.nationalMin);
    }
    if (dto.nationalMax !== undefined) {
      orderBook.ob_national_max =
        dto.nationalMax === null ? null : this.formatAmount(dto.nationalMax);
    }

    return this.orderBookRepository.save(orderBook);
  }

  async deleteOrderBook(userId: number, id: number) {
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

      const amountRemaining = this.toNumber(orderBook.ob_amount_remaining);
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

      const lockBalance = this.toNumber(wallet.uw_lock_balance);
      if (lockBalance < amountRemaining) {
        throw new BadRequestException('Wallet lock balance is not enough to unlock');
      }

      wallet.uw_lock_balance = lockBalance - amountRemaining;
      wallet.uw_balance = this.toNumber(wallet.uw_balance) + amountRemaining;
      await manager.save(UserWallet, wallet);

      orderBook.ob_status = OrderBookStatus.FAILED;
      await manager.save(OrderBook, orderBook);

      return { message: 'Order book deleted successfully' };
    });
  }
}
