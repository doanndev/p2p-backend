import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { OrderBook } from './order-book.entity';
import { Transaction } from './transaction.entity';

export enum NationalCurrencyStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('national_currencys')
export class NationalCurrency {
  @PrimaryGeneratedColumn({ name: 'nc_id', type: 'integer' })
  nc_id: number;

  @Column({ name: 'nc_name', type: 'varchar', unique: true })
  nc_name: string;

  @Column({ name: 'nc_symbol', type: 'varchar', unique: true })
  nc_symbol: string;

  @Column({ name: 'nc_logo', type: 'varchar' })
  nc_logo: string;

  @Column({
    name: 'nc_status',
    type: 'enum',
    enum: NationalCurrencyStatus,
  })
  nc_status: NationalCurrencyStatus;

  @OneToMany(() => OrderBook, (orderBook) => orderBook.national_currency)
  order_books: OrderBook[];

  @OneToMany(() => Transaction, (transaction) => transaction.national_currency)
  transactions: Transaction[];
}
