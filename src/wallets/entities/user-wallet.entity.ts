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

export enum WalletType {
  NATIONAL = 'national',
  CRYPTO = 'crypto',
}

@Entity('user_wallets')
@Index(['uw_user_id'])
@Index(['uw_wallet_coins'])
export class UserWallet {
  @PrimaryGeneratedColumn({ name: 'uw_id', type: 'integer' })
  uw_id: number;

  @Column({ name: 'uw_user_id', type: 'integer' })
  uw_user_id: number;

  @Column({
    name: 'uw_wallet_type',
    type: 'enum',
    enum: WalletType,
  })
  uw_wallet_type: WalletType;

  @Column({ name: 'uw_wallet_coins', type: 'integer', nullable: true })
  uw_wallet_coins: number | null;

  @Column({
    name: 'uw_balance',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
  })
  uw_balance: number;

  @Column({
    name: 'uw_lock_balance',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
  })
  uw_lock_balance: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uw_user_id' })
  user: User;
}
