import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Transaction } from '../../orderbook/entities/transaction.entity';
import { User } from '../../users/entities/user.entity';
import { ChatMessage } from './chat-message.entity';

export enum ChatRoomStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
  ARCHIVED = 'archived',
}

@Entity('chat_rooms')
export class ChatRoom {
  @PrimaryGeneratedColumn({ name: 'room_id', type: 'integer' })
  room_id: number;

  @Column({ name: 'room_transaction_id', type: 'integer' })
  room_transaction_id: number;

  @Column({ name: 'room_buyer_id', type: 'integer' })
  room_buyer_id: number;

  @Column({ name: 'room_seller_id', type: 'integer' })
  room_seller_id: number;

  @Column({
    name: 'room_status',
    type: 'enum',
    enum: ChatRoomStatus,
  })
  room_status: ChatRoomStatus;

  @Column({ name: 'room_created_at', type: 'timestamp' })
  room_created_at: Date;

  @Column({ name: 'room_closed_at', type: 'timestamp', nullable: true })
  room_closed_at: Date | null;

  @ManyToOne(() => Transaction)
  @JoinColumn({ name: 'room_transaction_id' })
  transaction: Transaction;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'room_buyer_id' })
  buyer: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'room_seller_id' })
  seller: User;

  @OneToMany(() => ChatMessage, (chatMessage) => chatMessage.room)
  messages: ChatMessage[];
}
