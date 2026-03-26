import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Coin } from '../../settings/entities/coin.entity';
import { NationalCurrency } from './national-currency.entity';
import { OrderBook } from './order-book.entity';

export enum TransactionOption {
  BUY = 'buy',
  SELL = 'sell',
}

export enum TransactionType {
  BANKING = 'banking',
  WALLET = 'wallet',
  EXCHANGE = 'exchange',
}

export enum TransactionStatus {
  PENDDING = 'pendding',
  EXECUTED = 'executed',
  FAILED = 'failed',
  PAYMENT_CONFIRMED = 'payment_confirmed',
  CANCELLED = 'cancelled',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn({ name: 'trans_id', type: 'integer' })
  trans_id: number;

  @Column({ name: 'transs_reference_code', type: 'varchar' })
  transs_reference_code: string;

  @Column({ name: 'trans_user_buy', type: 'integer' })
  trans_user_buy: number;

  @Column({ name: 'trans_user_sell', type: 'integer' })
  trans_user_sell: number;

  @Column({ name: 'trans_coin', type: 'integer' })
  trans_coin: number;

  @Column({ name: 'trans_national', type: 'integer' })
  trans_national: number;

  @Column({ name: 'trans_order_book', type: 'integer', nullable: true })
  trans_order_book: number | null;

  @Column({
    name: 'trans_option',
    type: 'enum',
    enum: TransactionOption,
  })
  trans_option: TransactionOption;

  @Column({
    name: 'trans_type',
    type: 'enum',
    enum: TransactionType,
  })
  trans_type: TransactionType;

  @Column({ name: 'trans_coin_symbol', type: 'varchar' })
  trans_coin_symbol: string;

  @Column({ name: 'trans_national_symbol', type: 'varchar' })
  trans_national_symbol: string;

  @Column({ name: 'trans_amount', type: 'decimal' })
  trans_amount: string;

  @Column({ name: 'trans_price', type: 'decimal' })
  trans_price: string;

  @Column({ name: 'trans_price_usd', type: 'decimal' })
  trans_price_usd: string;

  @Column({ name: 'trans_total_price', type: 'decimal' })
  trans_total_price: string;

  @Column({ name: 'trans_total_usd', type: 'decimal' })
  trans_total_usd: string;

  @Column({ name: 'trans_dispute_status', type: 'boolean' })
  trans_dispute_status: boolean;

  @Column({ name: 'trans_time_bank', type: 'timestamp', nullable: true })
  trans_time_bank: Date | null;

  @Column({
    name: 'trans_status',
    type: 'enum',
    enum: TransactionStatus,
  })
  trans_status: TransactionStatus;

  @Column({ name: 'trans_message', type: 'varchar', nullable: true })
  trans_message: string | null;

  @CreateDateColumn({ name: 'trans_created_at', type: 'timestamptz' })
  trans_created_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'trans_user_buy' })
  user_buy: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'trans_user_sell' })
  user_sell: User;

  @ManyToOne(() => Coin)
  @JoinColumn({ name: 'trans_coin' })
  coin: Coin;

  @ManyToOne(
    () => NationalCurrency,
    (nationalCurrency) => nationalCurrency.transactions,
  )
  @JoinColumn({ name: 'trans_national' })
  national_currency: NationalCurrency;

  @ManyToOne(() => OrderBook, (orderBook) => orderBook.transactions, {
    nullable: true,
  })
  @JoinColumn({ name: 'trans_order_book' })
  order_book: OrderBook | null;
}
