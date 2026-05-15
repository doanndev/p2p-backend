import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SupportChat } from './support-chat.entity';

export enum SupportChatSenderType {
  USER = 'user',
  ADMIN = 'admin',
  SYSTEM = 'system',
}

export enum SupportChatMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  SYSTEM_EVENT = 'system_event',
}

export enum SupportChatSystemEventType {
  USER_JOINED = 'user_joined',
  USER_LEFT = 'user_left',
  ADMIN_JOINED = 'admin_joined',
  ADMIN_LEFT = 'admin_left',
}

@Entity('support_chat_message')
@Index('idx_support_chat_message_conversation_created_at', [
  'conversation_id',
  'created_at',
])
export class SupportChatMessage {
  @PrimaryGeneratedColumn({ name: 'id', type: 'integer' })
  id: number;

  @Column({ name: 'conversation_id', type: 'integer' })
  conversation_id: number;

  @Column({
    name: 'sender_type',
    type: 'enum',
    enum: SupportChatSenderType,
  })
  sender_type: SupportChatSenderType;

  @Column({ name: 'sender_user_id', type: 'integer', nullable: true })
  sender_user_id: number | null;

  @Column({ name: 'sender_admin_id', type: 'integer', nullable: true })
  sender_admin_id: number | null;

  @Column({
    name: 'message_type',
    type: 'enum',
    enum: SupportChatMessageType,
    default: SupportChatMessageType.TEXT,
  })
  message_type: SupportChatMessageType;

  @Column({ name: 'content', type: 'text' })
  content: string;

  @Column({
    name: 'system_event_type',
    type: 'enum',
    enum: SupportChatSystemEventType,
    nullable: true,
  })
  system_event_type: SupportChatSystemEventType | null;

  @Column({ name: 'seen_by_user_at', type: 'timestamp', nullable: true })
  seen_by_user_at: Date | null;

  @Column({ name: 'seen_by_admin_at', type: 'timestamp', nullable: true })
  seen_by_admin_at: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => SupportChat, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: SupportChat;
}
