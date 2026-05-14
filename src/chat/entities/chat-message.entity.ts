import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ChatRoom } from './chat-room.entity';
import { User } from '../../users/entities/user.entity';
import { Admin } from '../../admins/entities/admin.entity';

export enum ChatMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  PAYMENT_PROOF = 'payment_proof',
  SYSTEM = 'system',
}

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn({ name: 'message_id', type: 'integer' })
  message_id: number;

  @Column({ name: 'message_room_id', type: 'integer' })
  message_room_id: number;

  /** Buyer/seller user `uid` when the sender is a user; null when sender is an admin. */
  @Column({ name: 'message_sender_id', type: 'integer', nullable: true })
  message_sender_id: number | null;

  /** `admins.admin_id` when the sender is an admin; null for user messages. */
  @Column({ name: 'message_sender_admin_id', type: 'integer', nullable: true })
  message_sender_admin_id: number | null;

  @Column({
    name: 'message_type',
    type: 'enum',
    enum: ChatMessageType,
  })
  message_type: ChatMessageType;

  @Column({ name: 'message_content', type: 'text' })
  message_content: string;

  @Column({ name: 'message_file_url', type: 'varchar', nullable: true })
  message_file_url: string | null;

  @Column({ name: 'message_file_name', type: 'varchar', nullable: true })
  message_file_name: string | null;

  @Column({ name: 'message_file_size', type: 'integer', nullable: true })
  message_file_size: number | null;

  @Column({ name: 'message_is_read', type: 'boolean', default: false })
  message_is_read: boolean;

  @Column({ name: 'message_created_at', type: 'timestamp' })
  message_created_at: Date;

  @Column({ name: 'message_read_at', type: 'timestamp', nullable: true })
  message_read_at: Date | null;

  @ManyToOne(() => ChatRoom, (chatRoom) => chatRoom.messages)
  @JoinColumn({ name: 'message_room_id' })
  room: ChatRoom;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'message_sender_id' })
  sender: User | null;

  @ManyToOne(() => Admin, { nullable: true })
  @JoinColumn({ name: 'message_sender_admin_id' })
  senderAdmin: Admin | null;
}
