import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** Tuyến SmartRef, tối đa 7 cấp (kiểm tra ở tầng nghiệp vụ). */
@Entity('smart_ref_trees')
@Index(['srt_invitee', 'srt_level'], { unique: true })
export class SmartRefTree {
  @PrimaryGeneratedColumn({ name: 'srt_id', type: 'integer' })
  srt_id: number;

  @Column({ name: 'srt_invitee', type: 'integer' })
  srt_invitee: number;

  @Column({ name: 'srt_referral', type: 'integer' })
  srt_referral: number;

  @Column({ name: 'srt_level', type: 'smallint' })
  srt_level: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'srt_invitee' })
  invitee: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'srt_referral' })
  referral: User;
}
