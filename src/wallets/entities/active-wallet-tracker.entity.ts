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
import { UseWalletNetwork } from './use-wallet-network.entity';
import { Network } from '../../settings/entities/network.entity';

@Entity('active_wallet_trackers')
@Index('idx_last_accessed_at', ['awt_last_accessed_at'])
@Index('idx_expires_at', ['awt_expires_at'])
@Index('idx_network_id', ['awt_network_id'])
@Index('idx_user_id', ['awt_user_id'])
@Index('uq_awt_address_network', ['awt_address', 'awt_network_id'], { unique: true })
export class ActiveWalletTracker {
  @PrimaryGeneratedColumn({ name: 'awt_id', type: 'integer' })
  awt_id: number;

  @Column({ name: 'uwn_id', type: 'integer', nullable: false })
  uwn_id: number;

  /** Lưu UTC; dùng timestamptz để DB lưu đúng instant, tránh lệch với created_at (UTC). */
  @Column({ name: 'awt_last_accessed_at', type: 'timestamptz', nullable: false })
  awt_last_accessed_at: Date;

  @Column({ name: 'awt_expires_at', type: 'timestamptz', nullable: false })
  awt_expires_at: Date;

  @Column({ name: 'awt_network_id', type: 'integer', nullable: false })
  awt_network_id: number;

  @Column({ name: 'awt_user_id', type: 'integer', nullable: false })
  awt_user_id: number;

  @Column({ name: 'awt_address', type: 'varchar', length: 255, nullable: false })
  awt_address: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', nullable: false })
  created_at: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamp',
    nullable: false,
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  @ManyToOne(() => UseWalletNetwork)
  @JoinColumn({ name: 'uwn_id' })
  wallet_network: UseWalletNetwork;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'awt_user_id' })
  user: User;

  @ManyToOne(() => Network)
  @JoinColumn({ name: 'awt_network_id' })
  network: Network;
}

