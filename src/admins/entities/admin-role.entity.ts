import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Admin } from './admin.entity';
import { RolePermission } from './role-permission.entity';

export enum RoleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('admin_roles')
export class AdminRole {
  @PrimaryGeneratedColumn({ name: 'role_id', type: 'integer' })
  role_id: number;

  @Column({ name: 'role_name', type: 'varchar', length: 100, unique: true })
  role_name: string;

  @Column({ name: 'role_description', type: 'text', nullable: true })
  role_description: string | null;

  @Column({
    name: 'role_status',
    type: 'enum',
    enum: RoleStatus,
    default: RoleStatus.ACTIVE,
  })
  role_status: RoleStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @OneToMany(() => Admin, (admin) => admin.admin_role)
  admins: Admin[];

  @OneToMany(() => RolePermission, (rolePermission) => rolePermission.role)
  role_permissions: RolePermission[];
}
