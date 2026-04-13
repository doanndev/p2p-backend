import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { RefWithdrawHistory } from './ref-withdraw-history.entity';
import { SmartRefTree } from './smart-ref-tree.entity';

@Entity('smart_ref_rewards')
@Index(['srr_tree_id'])
@Index(['srr_withdraw_id'])
export class SmartRefReward {
  @PrimaryGeneratedColumn({ name: 'srr_id', type: 'integer' })
  srr_id: number;

  @Column({ name: 'srr_withdraw_id', type: 'integer', nullable: true })
  srr_withdraw_id: number | null;

  @Column({ name: 'srr_tree_id', type: 'integer' })
  srr_tree_id: number;

  @Column({
    name: 'srr_usdt_reward',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
  })
  srr_usdt_reward: string;

  @Column({
    name: 'srr_usd_value',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
  })
  srr_usd_value: string;

  @Column({ name: 'srr_withdraw_status', type: 'boolean', default: false })
  srr_withdraw_status: boolean;

  @ManyToOne(() => RefWithdrawHistory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'srr_withdraw_id' })
  withdraw_history: RefWithdrawHistory | null;

  @ManyToOne(() => SmartRefTree, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'srr_tree_id' })
  tree: SmartRefTree;
}
