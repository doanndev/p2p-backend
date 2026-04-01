import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SupportChatMessage } from './support-chat-message.entity';

export enum SupportChatStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

@Entity('support_chat')
@Index('idx_support_chat_user_status_last_message_at', [
  'user_id',
  'status',
  'last_message_at',
])
@Index('idx_support_chat_status_updated_at', ['status', 'updated_at'])
export class SupportChat {
  @PrimaryGeneratedColumn({ name: 'id', type: 'integer' })
  id: number;

  @Column({ name: 'conversation_code', type: 'varchar', length: 120 })
  conversation_code: string;

  @Column({ name: 'user_id', type: 'integer' })
  user_id: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: SupportChatStatus,
    default: SupportChatStatus.OPEN,
  })
  status: SupportChatStatus;

  @Column({ name: 'last_message_at', type: 'timestamp', nullable: true })
  last_message_at: Date | null;

  @Column({ name: 'closed_at', type: 'timestamp', nullable: true })
  closed_at: Date | null;

  @Column({ name: 'closed_by_admin_id', type: 'integer', nullable: true })
  closed_by_admin_id: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @OneToMany(() => SupportChatMessage, (message) => message.conversation)
  messages: SupportChatMessage[];
}
