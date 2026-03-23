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

@Entity('use_wallet_networks')
@Index(['uwn_user_id'])
@Index(['uwn_network_id'])
export class UseWalletNetwork {
  @PrimaryGeneratedColumn({ name: 'uwn_id', type: 'integer' })
  uwn_id: number;

  @Column({ name: 'uwn_user_id', type: 'integer' })
  uwn_user_id: number;

  @Column({ name: 'uwn_end_path', type: 'smallint', nullable: true })
  uwn_end_path: number;

  @Column({ name: 'uwn_network_id', type: 'integer' })
  uwn_network_id: number;

  @Column({ name: 'uwn_public_key', type: 'varchar' })
  uwn_public_key: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uwn_user_id' })
  user: User;
}

