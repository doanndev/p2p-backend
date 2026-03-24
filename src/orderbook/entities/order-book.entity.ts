import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Coin } from '../../settings/entities/coin.entity';
import { NationalCurrency } from './national-currency.entity';
import { SettingBankOrder } from './setting-bank-order.entity';
import { Transaction } from './transaction.entity';

export enum OrderBookOption {
  BUY = 'buy',
  SELL = 'sell',
}

export enum OrderBookStatus {
  PENDING = 'pending',
  EXECUTED = 'executed',
  FAILED = 'failed',
}

@Entity('order_books')
export class OrderBook {
  @PrimaryGeneratedColumn({ name: 'ob_id', type: 'integer' })
  ob_id: number;

  @Column({ name: 'ob_user_id', type: 'integer' })
  ob_user_id: number;

  @Column({ name: 'ob_coin', type: 'integer' })
  ob_coin: number;

  @Column({ name: 'ob_national', type: 'integer' })
  ob_national: number;

  @Column({ name: 'ob_adv_code', type: 'varchar', unique: true })
  ob_adv_code: string;

  @Column({
    name: 'ob_option',
    type: 'enum',
    enum: OrderBookOption,
  })
  ob_option: OrderBookOption;

  @Column({ name: 'ob_coin_symbol', type: 'varchar' })
  ob_coin_symbol: string;

  @Column({ name: 'ob_national_symbol', type: 'varchar' })
  ob_national_symbol: string;

  @Column({ name: 'ob_amount', type: 'decimal' })
  ob_amount: string;

  @Column({ name: 'ob_amount_remaining', type: 'decimal' })
  ob_amount_remaining: string;

  @Column({ name: 'ob_price', type: 'decimal' })
  ob_price: string;

  @Column({ name: 'ob_national_min', type: 'decimal', nullable: true })
  ob_national_min: string | null;

  @Column({ name: 'ob_national_max', type: 'decimal', nullable: true })
  ob_national_max: string | null;

  @Column({
    name: 'ob_status',
    type: 'enum',
    enum: OrderBookStatus,
  })
  ob_status: OrderBookStatus;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'ob_user_id' })
  user: User;

  @ManyToOne(() => Coin)
  @JoinColumn({ name: 'ob_coin' })
  coin: Coin;

  @ManyToOne(
    () => NationalCurrency,
    (nationalCurrency) => nationalCurrency.order_books,
  )
  @JoinColumn({ name: 'ob_national' })
  national_currency: NationalCurrency;

  @OneToMany(
    () => SettingBankOrder,
    (settingBankOrder) => settingBankOrder.order_book,
  )
  setting_bank_orders: SettingBankOrder[];

  @OneToMany(() => Transaction, (transaction) => transaction.order_book)
  transactions: Transaction[];
}
