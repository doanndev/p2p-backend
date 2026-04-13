import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('ref_member')
@Index(['rm_user_invitee'], { unique: true })
export class RefMember {
  @PrimaryGeneratedColumn({ name: 'rm_id', type: 'integer' })
  rm_id: number;

  @Column({ name: 'rm_user_invitee', type: 'integer' })
  rm_user_invitee: number;

  @Column({ name: 'rm_user_referral', type: 'integer' })
  rm_user_referral: number;

  @Column({ name: 'rm_active', type: 'boolean', default: false })
  rm_active: boolean;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'rm_user_invitee' })
  invitee_user: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'rm_user_referral' })
  referral_user: User;
}
