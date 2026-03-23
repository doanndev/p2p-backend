import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum WalletTransferFrom {
  MAIN = 'main',
  REWARD = 'reward',
  GIFT = 'gift',
}

export enum WalletTransferTo {
  MAIN = 'main',
  REWARD = 'reward',
  GIFT = 'gift',
}

export enum WalletTransferStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  ERROR = 'error',
}

@Entity('wallet_transfers')
@Index(['wt_user_id'])
@Index(['wt_status'])
export class WalletTransfer {
  @PrimaryGeneratedColumn({ name: 'wt_id', type: 'integer' })
  wt_id: number;

  @Column({ name: 'wt_user_id', type: 'integer' })
  wt_user_id: number;

  @Column({
    name: 'wt_from',
    type: 'enum',
    enum: WalletTransferFrom,
  })
  wt_from: WalletTransferFrom;

  @Column({
    name: 'wt_to',
    type: 'enum',
    enum: WalletTransferTo,
  })
  wt_to: WalletTransferTo;

  @Column({
    name: 'wt_amount',
    type: 'decimal',
    precision: 18,
    scale: 8,
  })
  wt_amount: number;

  @Column({
    name: 'wt_status',
    type: 'enum',
    enum: WalletTransferStatus,
    default: WalletTransferStatus.PENDING,
  })
  wt_status: WalletTransferStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'wt_user_id' })
  user: User;
}

