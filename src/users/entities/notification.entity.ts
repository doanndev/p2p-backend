import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum NotificationType {
  SYSTEM = 'system',
  SECURITY = 'security',
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn({ name: 'notif_id', type: 'integer' })
  notif_id: number;

  @Column({ name: 'notif_user_id', type: 'integer' })
  notif_user_id: number;

  @Column({
    name: 'notif_type',
    type: 'enum',
    enum: NotificationType,
  })
  notif_type: NotificationType;

  @Column({ name: 'notif_title', type: 'varchar' })
  notif_title: string;

  @Column({ name: 'notif_message', type: 'text' })
  notif_message: string;

  @Column({ name: 'notif_data', type: 'json', nullable: true })
  notif_data: Record<string, any> | null;

  @Column({ name: 'notif_is_read', type: 'boolean', default: false })
  notif_is_read: boolean;

  @CreateDateColumn({ name: 'notif_created_at', type: 'timestamp' })
  notif_created_at: Date;

  @Column({ name: 'notif_read_at', type: 'timestamp', nullable: true })
  notif_read_at: Date | null;

  @ManyToOne(() => User, (user) => user.notifications)
  @JoinColumn({ name: 'notif_user_id' })
  user: User;
}

