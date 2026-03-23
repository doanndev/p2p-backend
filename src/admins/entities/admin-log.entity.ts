import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Admin } from './admin.entity';

export enum AdminLogAction {
  LOGIN = 'login',
  LOGOUT = 'logout',
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  APPROVE = 'approve',
  REJECT = 'reject',
  SUSPEND = 'suspend',
  ACTIVATE = 'activate',
  VIEW = 'view',
  EXPORT = 'export',
  IMPORT = 'import',
}

export enum AdminLogModule {
  USERS = 'users',
  TRANSACTIONS = 'transactions',
  DISPUTES = 'disputes',
  SETTINGS = 'settings',
  ADMINS = 'admins',
  REPORTS = 'reports',
  SYSTEM = 'system',
}

@Entity('admin_logs')
export class AdminLog {
  @PrimaryGeneratedColumn({ name: 'log_id', type: 'integer' })
  log_id: number;

  @Column({ name: 'log_admin_id', type: 'integer' })
  log_admin_id: number;

  @Column({
    name: 'log_action',
    type: 'enum',
    enum: AdminLogAction,
  })
  log_action: AdminLogAction;

  @Column({
    name: 'log_module',
    type: 'enum',
    enum: AdminLogModule,
  })
  log_module: AdminLogModule;

  @Column({ name: 'log_description', type: 'text' })
  log_description: string;

  @Column({ name: 'log_ip_address', type: 'varchar', length: 45, nullable: true })
  log_ip_address: string | null;

  @Column({ name: 'log_user_agent', type: 'text', nullable: true })
  log_user_agent: string | null;

  @Column({ name: 'log_target_id', type: 'integer', nullable: true })
  log_target_id: number | null;

  @Column({ name: 'log_target_type', type: 'varchar', length: 50, nullable: true })
  log_target_type: string | null;

  @Column({ name: 'log_old_data', type: 'json', nullable: true })
  log_old_data: Record<string, any> | null;

  @Column({ name: 'log_new_data', type: 'json', nullable: true })
  log_new_data: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => Admin, (admin) => admin.admin_logs)
  @JoinColumn({ name: 'log_admin_id' })
  admin: Admin;
}

