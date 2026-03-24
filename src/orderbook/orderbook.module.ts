import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderbookController } from './orderbook.controller';
import { OrderbookService } from './orderbook.service';
import { TransactionService } from './transaction.service';
import { OrderBook } from './entities/order-book.entity';
import { NationalCurrency } from './entities/national-currency.entity';
import { SettingBankOrder } from './entities/setting-bank-order.entity';
import { Transaction } from './entities/transaction.entity';
import { User } from '../users/entities/user.entity';
import { Coin } from '../settings/entities/coin.entity';
import { BankUser } from '../users/entities/bank-user.entity';
import { UserWallet } from '../wallets/entities/user-wallet.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderBook,
      NationalCurrency,
      SettingBankOrder,
      Transaction,
      User,
      Coin,
      BankUser,
      UserWallet,
    ]),
  ],
  controllers: [OrderbookController],
  providers: [OrderbookService, TransactionService],
  exports: [OrderbookService, TransactionService],
})
export class OrderbookModule {}
