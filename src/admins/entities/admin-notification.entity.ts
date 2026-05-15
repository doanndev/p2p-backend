import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Admin } from './admin.entity';
import { NotificationType } from '../../users/entities/notification.entity';

/**
 * In-app notifications for admin panel (separate from {@link Notification} for end users).
 */
@Entity('admin_notifications')
@Index('idx_admin_notifications_admin_created', ['admin', 'created_at'])
export class AdminNotification {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Admin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id' })
  admin: Admin;

  @Column({
    name: 'type',
    type: 'enum',
    enum: NotificationType,
  })
  type: NotificationType;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'json', nullable: true })
  data: Record<string, unknown> | null;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  is_read: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  read_at: Date | null;
}
