import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum UserLogType {
  BALANCE_SYNC = 'balance_sync',
  BALANCE_MISMATCH = 'balance_mismatch',
  LOGIN = 'login',
  LOGOUT = 'logout',
  PROFILE_UPDATE = 'profile_update',
  VERIFICATION = 'verification',
  SECURITY_ALERT = 'security_alert',
  WALLET_CREATE = 'wallet_create',
  WALLET_UPDATE = 'wallet_update',
  SYSTEM = 'system',
}

export enum UserLogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

@Entity('user_logs')
export class UserLog {
  @PrimaryGeneratedColumn({ name: 'log_id', type: 'integer' })
  log_id: number;

  @Column({ name: 'log_user_id', type: 'integer' })
  log_user_id: number;

  @Column({
    name: 'log_type',
    type: 'enum',
    enum: UserLogType,
  })
  log_type: UserLogType;

  @Column({
    name: 'log_level',
    type: 'enum',
    enum: UserLogLevel,
  })
  log_level: UserLogLevel;

  @Column({ name: 'log_title', type: 'varchar' })
  log_title: string;

  @Column({ name: 'log_message', type: 'text' })
  log_message: string;

  @Column({ name: 'log_data', type: 'json', nullable: true })
  log_data: Record<string, any> | null;

  @Column({ name: 'log_ip_address', type: 'varchar', nullable: true })
  log_ip_address: string | null;

  @Column({ name: 'log_user_agent', type: 'varchar', nullable: true })
  log_user_agent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User, (user) => user.user_logs)
  @JoinColumn({ name: 'log_user_id' })
  user: User;
}
