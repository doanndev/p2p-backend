import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum KolArticleStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('kol_articles')
@Index(['ka_user_id'])
@Index(['ka_status'])
export class KolArticle {
  @PrimaryGeneratedColumn({ name: 'ka_id', type: 'integer' })
  ka_id: number;

  @Column({ name: 'ka_user_id', type: 'integer' })
  ka_user_id: number;

  @Column({ name: 'ka_article_url', type: 'varchar' })
  ka_article_url: string;

  @Column({
    name: 'ka_status',
    type: 'enum',
    enum: KolArticleStatus,
    default: KolArticleStatus.PENDING,
  })
  ka_status: KolArticleStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'ka_user_id' })
  user: User;
}
