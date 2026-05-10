import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AdminRole } from './admin-role.entity';
import { Permission } from './permission.entity';

@Entity('role_permissions')
export class RolePermission {
  @PrimaryGeneratedColumn({ name: 'rp_id', type: 'integer' })
  rp_id: number;

  @Column({ name: 'rp_role_id', type: 'integer' })
  rp_role_id: number;

  @Column({ name: 'rp_permission_id', type: 'integer' })
  rp_permission_id: number;

  @Column({ name: 'rp_granted', type: 'boolean', default: true })
  rp_granted: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => AdminRole, (adminRole) => adminRole.role_permissions)
  @JoinColumn({ name: 'rp_role_id' })
  role: AdminRole;

  @ManyToOne(() => Permission, (permission) => permission.role_permissions)
  @JoinColumn({ name: 'rp_permission_id' })
  permission: Permission;
}
