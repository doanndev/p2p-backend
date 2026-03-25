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
import { SettingBankOrder } from './entities/setting-bank-order.entity';
import { BankUser } from '../users/entities/bank-user.entity';

@Injectable()
export class OrderbookService {
  constructor(
    @InjectRepository(OrderBook)
    private readonly orderBookRepository: Repository<OrderBook>,
    @InjectRepository(UserWallet)
    private readonly userWalletRepository: Repository<UserWallet>,
    @InjectRepository(SettingBankOrder)
    private readonly settingBankOrderRepository: Repository<SettingBankOrder>,
    @InjectRepository(BankUser)
    private readonly bankUserRepository: Repository<BankUser>,
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

      const amountStr = this.formatAmount(dto.amount);
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
        throw new BadRequestException('Insufficient available balance');
      }

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
          dto.nationalMin === undefined
            ? null
            : this.formatAmount(dto.nationalMin),
        ob_national_max:
          dto.nationalMax === undefined
            ? null
            : this.formatAmount(dto.nationalMax),
        ob_status: OrderBookStatus.PENDING,
      });

      const saved = await manager.save(OrderBook, orderBook);
      return {
        id: saved.ob_id,
        user_id: saved.ob_user_id,
        coin: saved.ob_coin,
        national: saved.ob_national,
        adv_code: saved.ob_adv_code,
        option: saved.ob_option,
        coin_symbol: saved.ob_coin_symbol,
        national_symbol: saved.ob_national_symbol,
        amount: saved.ob_amount,
        amount_remaining: saved.ob_amount_remaining,
        price: saved.ob_price,
        national_min: saved.ob_national_min,
        national_max: saved.ob_national_max,
        status: saved.ob_status,
      };
    });
  }

  async getOrderBooks() {
    const rows = await this.orderBookRepository.find({
      where: { ob_status: OrderBookStatus.PENDING },
      order: { ob_id: 'DESC' },
    });
    return rows.map((book) => ({
      id: book.ob_id,
      user_id: book.ob_user_id,
      coin: book.ob_coin,
      national: book.ob_national,
      adv_code: book.ob_adv_code,
      option: book.ob_option,
      coin_symbol: book.ob_coin_symbol,
      national_symbol: book.ob_national_symbol,
      amount: book.ob_amount,
      amount_remaining: book.ob_amount_remaining,
      price: book.ob_price,
      national_min: book.ob_national_min,
      national_max: book.ob_national_max,
      status: book.ob_status,
    }));
  }

  async getOrderBookDetail(id: number) {
    const orderBook = await this.orderBookRepository.findOne({
      where: { ob_id: id },
    });
    if (!orderBook) {
      throw new NotFoundException('Order book not found');
    }

    const setting = await this.settingBankOrderRepository.findOne({
      where: { sbo_order_book: id },
      relations: ['bank_user'],
    });

    const bankUser = setting?.bank_user
      ? {
          id: setting.bank_user.bu_id,
          userId: setting.bank_user.bu_user_id,
          bankName: setting.bank_user.bu_bank_name,
          bankBranch: setting.bank_user.bu_bank_branch,
          bankAccountName: setting.bank_user.bu_bank_account_name,
          bankAccountNumber: setting.bank_user.bu_bank_account_number,
        }
      : null;

    return {
      id: orderBook.ob_id,
      user_id: orderBook.ob_user_id,
      coin: orderBook.ob_coin,
      national: orderBook.ob_national,
      adv_code: orderBook.ob_adv_code,
      option: orderBook.ob_option,
      coin_symbol: orderBook.ob_coin_symbol,
      national_symbol: orderBook.ob_national_symbol,
      amount: orderBook.ob_amount,
      amount_remaining: orderBook.ob_amount_remaining,
      price: orderBook.ob_price,
      national_min: orderBook.ob_national_min,
      national_max: orderBook.ob_national_max,
      status: orderBook.ob_status,
      bankUser: bankUser,
    };
  }

  async attachBankToOrderBook(
    userId: number,
    orderBookId: number,
    bankUserId: number,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const orderBook = await manager.findOne(OrderBook, {
        where: { ob_id: orderBookId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!orderBook) throw new NotFoundException('Order book not found');
      if (orderBook.ob_user_id !== userId) {
        throw new ForbiddenException(
          'You can only attach bank to your own order book',
        );
      }

      const bankUser = await manager.findOne(BankUser, {
        where: { bu_id: bankUserId },
      });
      if (!bankUser) throw new NotFoundException('Bank not found');
      if (bankUser.bu_user_id !== userId) {
        throw new ForbiddenException('You can only use your own bank');
      }

      const existing = await manager.findOne(SettingBankOrder, {
        where: { sbo_order_book: orderBookId },
      });
      if (existing) {
        existing.sbo_bank_id = bankUserId;
        await manager.save(SettingBankOrder, existing);
      } else {
        const created = manager.create(SettingBankOrder, {
          sbo_order_book: orderBookId,
          sbo_bank_id: bankUserId,
        });
        await manager.save(SettingBankOrder, created);
      }

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
    });
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

    const saved = await this.orderBookRepository.save(orderBook);
    return {
      id: saved.ob_id,
      user_id: saved.ob_user_id,
      coin: saved.ob_coin,
      national: saved.ob_national,
      adv_code: saved.ob_adv_code,
      option: saved.ob_option,
      coin_symbol: saved.ob_coin_symbol,
      national_symbol: saved.ob_national_symbol,
      amount: saved.ob_amount,
      amount_remaining: saved.ob_amount_remaining,
      price: saved.ob_price,
      national_min: saved.ob_national_min,
      national_max: saved.ob_national_max,
      status: saved.ob_status,
    };
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
      const amountStr = this.formatAmount(amountRemaining);

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

      orderBook.ob_status = OrderBookStatus.FAILED;
      await manager.save(OrderBook, orderBook);

      return { message: 'Order book deleted successfully' };
    });
  }
}
