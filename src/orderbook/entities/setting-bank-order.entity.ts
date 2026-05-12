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

  /** When set, user requested switching payout bank to this row; `sbo_bank_id` stays the live bank until admin approves. */
  @Column({ name: 'sbo_pending_bank_id', type: 'integer', nullable: true })
  sbo_pending_bank_id: number | null;

  @Column({
    name: 'sbo_bank_change_requested_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  sbo_bank_change_requested_at: Date | null;

  @ManyToOne(() => BankUser)
  @JoinColumn({ name: 'sbo_bank_id' })
  bank_user: BankUser;

  @ManyToOne(() => BankUser, { nullable: true })
  @JoinColumn({ name: 'sbo_pending_bank_id' })
  pending_bank_user: BankUser | null;

  @ManyToOne(() => OrderBook, (orderBook) => orderBook.setting_bank_orders)
  @JoinColumn({ name: 'sbo_order_book' })
  order_book: OrderBook;
}
