import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { AdminRole } from './admin-role.entity';
import { AdminLog } from './admin-log.entity';
import { VerifyLog } from '../../users/entities/verify-log.entity';

export enum AdminLevel {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  MODERATOR = 'moderator',
  SUPPORT = 'support',
}

export enum AdminStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn({ name: 'admin_id', type: 'integer' })
  admin_id: number;

  @Column({ name: 'admin_username', type: 'varchar', length: 50, unique: true })
  admin_username: string;

  @Column({ name: 'admin_email', type: 'varchar', length: 100, unique: true })
  admin_email: string;

  @Column({ name: 'admin_password', type: 'varchar', length: 255 })
  admin_password: string;

  @Column({ name: 'admin_fullname', type: 'varchar', length: 100 })
  admin_fullname: string;

  @Column({ name: 'admin_avatar', type: 'text', nullable: true })
  admin_avatar: string | null;

  @Column({ name: 'admin_phone', type: 'varchar', length: 20, nullable: true })
  admin_phone: string | null;

  @Column({
    name: 'admin_level',
    type: 'enum',
    enum: AdminLevel,
    default: AdminLevel.SUPPORT,
  })
  admin_level: AdminLevel;

  @Column({ name: 'admin_role_id', type: 'integer' })
  admin_role_id: number;

  @Column({ name: 'admin_last_login', type: 'timestamp', nullable: true })
  admin_last_login: Date | null;

  @Column({ name: 'admin_last_ip', type: 'varchar', length: 45, nullable: true })
  admin_last_ip: string | null;

  @Column({
    name: 'admin_status',
    type: 'enum',
    enum: AdminStatus,
    default: AdminStatus.ACTIVE,
  })
  admin_status: AdminStatus;

  @Column({ name: 'admin_two_factor_enabled', type: 'boolean', default: false })
  admin_two_factor_enabled: boolean;

  @Column({ name: 'admin_two_factor_secret', type: 'text', nullable: true })
  admin_two_factor_secret: string | null;

  @Column({ name: 'admin_originator', type: 'integer', nullable: true })
  admin_originator: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => AdminRole, (adminRole) => adminRole.admins)
  @JoinColumn({ name: 'admin_role_id' })
  admin_role: AdminRole;

  @ManyToOne(() => Admin, (admin) => admin.created_admins)
  @JoinColumn({ name: 'admin_originator' })
  originator: Admin | null;

  @OneToMany(() => Admin, (admin) => admin.originator)
  created_admins: Admin[];

  @OneToMany(() => AdminLog, (adminLog) => adminLog.admin)
  admin_logs: AdminLog[];

  @OneToMany(() => VerifyLog, (verifyLog) => verifyLog.admin)
  verify_logs: VerifyLog[];
}

