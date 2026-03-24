import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BankUser } from '../../users/entities/bank-user.entity';
import { OrderBook } from './order-book.entity';

@Entity('setting_bank_order')
export class SettingBankOrder {
  @PrimaryGeneratedColumn({ name: 'sbo_id', type: 'integer' })
  sbo_id: number;

  @Column({ name: 'sbo_bank_id', type: 'integer' })
  sbo_bank_id: number;

  @Column({ name: 'sbo_order_book', type: 'integer' })
  sbo_order_book: number;

  @ManyToOne(() => BankUser)
  @JoinColumn({ name: 'sbo_bank_id' })
  bank_user: BankUser;

  @ManyToOne(() => OrderBook, (orderBook) => orderBook.setting_bank_orders)
  @JoinColumn({ name: 'sbo_order_book' })
  order_book: OrderBook;
}
