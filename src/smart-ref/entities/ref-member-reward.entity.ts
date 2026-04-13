import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { RefWithdrawHistory } from './ref-withdraw-history.entity';

@Entity('ref_member_rewards')
@Index(['srm_user_id'])
@Index(['srm_withdraw_id'])
export class RefMemberReward {
  @PrimaryGeneratedColumn({ name: 'srm_id', type: 'integer' })
  srm_id: number;

  @Column({ name: 'srm_user_id', type: 'integer' })
  srm_user_id: number;

  @Column({ name: 'srm_withdraw_id', type: 'integer', nullable: true })
  srm_withdraw_id: number | null;

  @Column({ name: 'srm_milestone', type: 'smallint' })
  srm_milestone: number;

  @Column({
    name: 'srm_token_reward',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
  })
  srm_token_reward: string;

  @Column({
    name: 'srm_usd_value',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
  })
  srm_usd_value: string;

  @Column({ name: 'srm_withdraw_status', type: 'boolean', default: false })
  srm_withdraw_status: boolean;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'srm_user_id' })
  user: User;

  @ManyToOne(() => RefWithdrawHistory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'srm_withdraw_id' })
  withdraw_history: RefWithdrawHistory | null;
}
