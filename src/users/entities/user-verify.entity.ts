import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { VerifyLog } from './verify-log.entity';

export enum UserVerifyStatus {
  PENDING = 'pedding',
  CHALLENGE_PENDING = 'challenge_pending',
  VERIFY = 'verify',
  CANCEL = 'cancel',
  RETRY = 'retry',
}

@Entity('user_verifies')
export class UserVerify {
  @PrimaryGeneratedColumn({ name: 'uv_id', type: 'integer' })
  uv_id: number;

  @Column({ name: 'uv_user_id', type: 'integer' })
  uv_user_id: number;

  @Column({ name: 'uv_id_card_number', type: 'varchar' })
  uv_id_card_number: string;

  @Column({ name: 'uv_front_image', type: 'varchar' })
  uv_front_image: string;

  @Column({ name: 'uv_backside_image', type: 'varchar', nullable: true })
  uv_backside_image: string | null;

  @Column({
    name: 'uv_status',
    type: 'enum',
    enum: UserVerifyStatus,
  })
  uv_status: UserVerifyStatus;

  @Column({ name: 'uv_challenge_code', type: 'varchar', nullable: true })
  uv_challenge_code: string | null;

  @Column({
    name: 'uv_challenge_expires_at',
    type: 'timestamp',
    nullable: true,
  })
  uv_challenge_expires_at: Date | null;

  @Column({ name: 'uv_paper_image', type: 'varchar', nullable: true })
  uv_paper_image: string | null;

  @ManyToOne(() => User, (user) => user.user_verifies)
  @JoinColumn({ name: 'uv_user_id' })
  user: User;

  @OneToMany(() => VerifyLog, (verifyLog) => verifyLog.user_verify)
  verify_logs: VerifyLog[];
}
