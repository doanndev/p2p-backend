import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserVerify } from './user-verify.entity';
import { Admin } from '../../admins/entities/admin.entity';

@Entity('verify_logs')
export class VerifyLog {
  @PrimaryGeneratedColumn({ name: 'vl_id', type: 'integer' })
  vl_id: number;

  @Column({ name: 'vl_verify_id', type: 'integer' })
  vl_verify_id: number;

  @Column({ name: 'vl_admin_id', type: 'integer' })
  vl_admin_id: number;

  @Column({ name: 'vl_note', type: 'text', nullable: true })
  vl_note: string | null;

  @ManyToOne(() => UserVerify, (userVerify) => userVerify.verify_logs)
  @JoinColumn({ name: 'vl_verify_id' })
  user_verify: UserVerify;

  @ManyToOne(() => Admin, (admin) => admin.verify_logs)
  @JoinColumn({ name: 'vl_admin_id' })
  admin: Admin;
}

