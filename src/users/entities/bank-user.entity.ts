import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('bank_users')
export class BankUser {
  @PrimaryGeneratedColumn({ name: 'bu_id', type: 'integer' })
  bu_id: number;

  @Column({ name: 'bu_user_id', type: 'integer' })
  bu_user_id: number;

  @Column({ name: 'bu_bank_name', type: 'varchar' })
  bu_bank_name: string;

  @Column({ name: 'bu_bank_branch', type: 'varchar', nullable: true })
  bu_bank_branch: string | null;

  @Column({ name: 'bu_bank_account_name', type: 'varchar' })
  bu_bank_account_name: string;

  @Column({ name: 'bu_bank_account_number', type: 'varchar' })
  bu_bank_account_number: string;

  @ManyToOne(() => User, (user) => user.bank_users)
  @JoinColumn({ name: 'bu_user_id' })
  user: User;
}
