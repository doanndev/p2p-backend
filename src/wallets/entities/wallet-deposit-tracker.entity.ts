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
import { Network } from '../../settings/entities/network.entity';

// Tracker các ví đã nạp tiền
@Entity('wallet_deposit_tracker')
@Index(['wdt_user_id'])
@Index(['wdt_network_id'])
export class WalletDepositTracker {
  @PrimaryGeneratedColumn({ name: 'wwdt_id', type: 'integer' })
  wwdt_id: number;

  @Column({ name: 'wdt_user_id', type: 'integer' })
  wdt_user_id: number;

  @Column({ name: 'wdt_network_id', type: 'integer' })
  wdt_network_id: number;

  @Column({ name: 'wdt_address', type: 'varchar', length: 255 })
  wdt_address: string;

  @Column({ name: 'wdt_withdraw', type: 'boolean', default: false })
  wdt_withdraw: boolean;

  @CreateDateColumn({ name: 'create_at', type: 'timestamp' })
  create_at: Date;

  @UpdateDateColumn({
    name: 'update_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  update_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'wdt_user_id' })
  user: User;

  @ManyToOne(() => Network)
  @JoinColumn({ name: 'wdt_network_id' })
  network: Network;
}

