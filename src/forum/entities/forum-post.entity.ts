import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Admin } from '../../admins/entities/admin.entity';

export enum ForumPostStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

@Entity('forum_posts')
@Index('idx_forum_posts_status_deleted_published', [
  'status',
  'deleted_at',
  'published_at',
])
export class ForumPost {
  @PrimaryGeneratedColumn({ name: 'forum_post_id', type: 'integer' })
  forum_post_id: number;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'content', type: 'text' })
  content: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ForumPostStatus,
    default: ForumPostStatus.DRAFT,
  })
  status: ForumPostStatus;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deleted_at: Date | null;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  published_at: Date | null;

  @Column({ name: 'author_admin_id', type: 'integer' })
  author_admin_id: number;

  @ManyToOne(() => Admin, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_admin_id' })
  author: Admin;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
