import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { BankUserApprovalStatus } from './bank-user-approval-status';

@Entity('bank_users')
export class BankUser {
  @PrimaryGeneratedColumn({ name: 'bu_id', type: 'integer' })
  bu_id: number;

  @Column({ name: 'bu_user_id', type: 'integer' })
  bu_user_id: number;

  @Column({ name: 'bu_bank_name', type: 'varchar' })
  bu_bank_name: string;

  /** Ảnh sổ tài khoản (passbook) — URL do client upload (ví dụ Cloudinary), dùng xác minh. */
  @Column({
    name: 'bu_passbook_image_url',
    type: 'varchar',
    length: 2048,
    nullable: true,
  })
  bu_passbook_image_url: string | null;

  @Column({ name: 'bu_bank_account_name', type: 'varchar' })
  bu_bank_account_name: string;

  @Column({ name: 'bu_bank_account_number', type: 'varchar' })
  bu_bank_account_number: string;

  @Column({
    name: 'bu_approval_status',
    type: 'varchar',
    length: 16,
    default: BankUserApprovalStatus.ACTIVE,
  })
  bu_approval_status: BankUserApprovalStatus;

  @Column({
    name: 'bu_requested_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  bu_requested_at: Date | null;

  @ManyToOne(() => User, (user) => user.bank_users)
  @JoinColumn({ name: 'bu_user_id' })
  user: User;
}
