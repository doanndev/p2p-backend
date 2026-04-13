import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum RefWithdrawHistoryStatus {
  CAN_WITHDRAW = 'can-withdraw',
  WITHDRAWN = 'withdrawn',
}

@Entity('ref_withdraw_histories')
@Index(['rwh_user_id'])
export class RefWithdrawHistory {
  @PrimaryGeneratedColumn({ name: 'rwh_id', type: 'integer' })
  rwh_id: number;

  @Column({ name: 'rwh_user_id', type: 'integer' })
  rwh_user_id: number;

  @Column({
    name: 'rwh_amount',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
  })
  rwh_amount: string;

  @Column({
    name: 'rwh_amount_usd',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
  })
  rwh_amount_usd: string;

  @Column({
    name: 'rwh_status',
    type: 'enum',
    enum: RefWithdrawHistoryStatus,
    enumName: 'ref_withdraw_histories_rwh_status_enum',
    default: RefWithdrawHistoryStatus.CAN_WITHDRAW,
  })
  rwh_status: RefWithdrawHistoryStatus;

  @CreateDateColumn({ name: 'rwh_date', type: 'timestamptz' })
  rwh_date: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'rwh_user_id' })
  user: User;
}
