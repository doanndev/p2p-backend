import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Transaction } from './transaction.entity';
import { User } from '../../users/entities/user.entity';
import { Admin } from '../../admins/entities/admin.entity';

export enum DisputeType {
  PAYMENT_NOT_RECEIVED = 'payment_not_received',
  PAYMENT_SENT_NO_CONFIRMATION = 'payment_sent_no_confirmation',
  WRONG_AMOUNT = 'wrong_amount',
  FAKE_PAYMENT_PROOF = 'fake_payment_proof',
  OTHER = 'other',
}

export enum DisputeStatus {
  OPEN = 'open',
  UNDER_REVIEW = 'under_review',
  RESOLVED_BUYER_WIN = 'resolved_buyer_win',
  RESOLVED_SELLER_WIN = 'resolved_seller_win',
  CANCELLED = 'cancelled',
}

@Entity('disputes')
export class Dispute {
  @PrimaryGeneratedColumn({ name: 'dispute_id', type: 'integer' })
  dispute_id: number;

  @Column({ name: 'dispute_transaction_id', type: 'integer' })
  dispute_transaction_id: number;

  @Column({ name: 'dispute_initiator_id', type: 'integer' })
  dispute_initiator_id: number;

  @Column({ name: 'dispute_responder_id', type: 'integer' })
  dispute_responder_id: number;

  @Column({
    name: 'dispute_type',
    type: 'enum',
    enum: DisputeType,
  })
  dispute_type: DisputeType;

  @Column({ name: 'dispute_reason', type: 'text' })
  dispute_reason: string;

  @Column({ name: 'dispute_evidence', type: 'text', nullable: true })
  dispute_evidence: string | null;

  @Column({
    name: 'dispute_status',
    type: 'enum',
    enum: DisputeStatus,
  })
  dispute_status: DisputeStatus;

  @Column({ name: 'dispute_admin_id', type: 'integer', nullable: true })
  dispute_admin_id: number | null;

  @Column({ name: 'dispute_resolution', type: 'text', nullable: true })
  dispute_resolution: string | null;

  @CreateDateColumn({ name: 'dispute_created_at', type: 'timestamptz' })
  dispute_created_at: Date;

  @UpdateDateColumn({ name: 'dispute_updated_at', type: 'timestamptz' })
  dispute_updated_at: Date;

  @Column({ name: 'dispute_resolved_at', type: 'timestamptz', nullable: true })
  dispute_resolved_at: Date | null;

  @ManyToOne(() => Transaction)
  @JoinColumn({ name: 'dispute_transaction_id' })
  transaction: Transaction;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'dispute_initiator_id' })
  initiator: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'dispute_responder_id' })
  responder: User;

  @ManyToOne(() => Admin, { nullable: true })
  @JoinColumn({ name: 'dispute_admin_id' })
  admin: Admin | null;
}
