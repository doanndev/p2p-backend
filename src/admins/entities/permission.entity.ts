import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { RolePermission } from './role-permission.entity';

export enum PermissionResource {
  USERS = 'users',
  ADMINS = 'admins',
  STAKING = 'staking',
  SETTINGS = 'settings',
  NETWORKS = 'networks',
  COINS = 'coins',
  REFERRAL = 'referral',
  SYSTEM = 'system',
}

export enum PermissionAction {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  ADVANCED = 'advanced',
}

export enum PermissionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn({ name: 'permission_id', type: 'integer' })
  permission_id: number;

  @Column({
    name: 'permission_name',
    type: 'varchar',
    length: 100,
    unique: true,
  })
  permission_name: string;

  @Column({
    name: 'permission_resource',
    type: 'enum',
    enum: PermissionResource,
  })
  permission_resource: PermissionResource;

  @Column({
    name: 'permission_action',
    type: 'enum',
    enum: PermissionAction,
  })
  permission_action: PermissionAction;

  @Column({ name: 'permission_description', type: 'text', nullable: true })
  permission_description: string | null;

  @Column({
    name: 'permission_status',
    type: 'enum',
    enum: PermissionStatus,
    default: PermissionStatus.ACTIVE,
  })
  permission_status: PermissionStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @OneToMany(
    () => RolePermission,
    (rolePermission) => rolePermission.permission,
  )
  role_permissions: RolePermission[];
}
