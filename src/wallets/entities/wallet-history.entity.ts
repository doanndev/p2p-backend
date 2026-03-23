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
import { UserWalletNetwork } from './user-wallet-network.entity';

export enum WalletHistoryType {
  NATIONAL = 'national',
  CRYPTO = 'crypto',
}

export enum WalletHistoryOption {
  ADMIN_DEPOSIT = 'admin-deposit',
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
}

export enum WalletHistoryStatus {
  PENDING = 'pedding',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCEL = 'cancel',
  CHECKED = 'checked',
}

@Entity('wallet_histories')
@Index(['wh_wallet_netword_id'])
@Index(['wh_coins'])
@Index(['wh_user'])
@Index(['wh_status'])
export class WalletHistory {
  @PrimaryGeneratedColumn({ name: 'wh_id', type: 'integer' })
  wh_id: number;

  @Column({ name: 'wh_wallet_netword_id', type: 'integer', nullable: true })
  wh_wallet_netword_id: number | null;

  @Column({
    name: 'wh_type',
    type: 'enum',
    enum: WalletHistoryType,
  })
  wh_type: WalletHistoryType;

  @Column({
    name: 'wh_option',
    type: 'enum',
    enum: WalletHistoryOption,
  })
  wh_option: WalletHistoryOption;

  @Column({ name: 'wh_coins', type: 'integer', nullable: true })
  wh_coins: number | null;

  @Column({
    name: 'wh_amount',
    type: 'decimal',
    precision: 18,
    scale: 8,
  })
  wh_amount: number;

  @Column({ name: 'wh_hash', type: 'varchar', nullable: true })
  wh_hash: string | null;

  @Column({ name: 'wh_imnage_veryfy', type: 'varchar', nullable: true })
  wh_imnage_veryfy: string | null;

  @Column({
    name: 'wh_status',
    type: 'enum',
    enum: WalletHistoryStatus,
  })
  wh_status: WalletHistoryStatus;

  @Column({ name: 'wh_node', type: 'varchar', nullable: true })
  wh_node: string | null;

  @Column({ name: 'wh_user', type: 'integer', nullable: true })
  wh_user: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => UserWalletNetwork)
  @JoinColumn({ name: 'wh_wallet_netword_id' })
  wallet_network: UserWalletNetwork | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'wh_user' })
  user: User | null;
}

