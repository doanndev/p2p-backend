import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum KolRegisterStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAIL = 'fail',
}

@Entity('kol_register')
export class KolRegister {
  @PrimaryGeneratedColumn({ name: 'kr_id', type: 'integer' })
  kr_id: number;

  @Column({ name: 'kr_user_id', type: 'integer' })
  kr_user_id: number;

  @Column({ name: 'kr_name', type: 'varchar' })
  kr_name: string;

  @Column({ name: 'kr_facebook_url', type: 'varchar', nullable: true })
  kr_facebook_url: string | null;

  @Column({ name: 'kr_x_url', type: 'varchar', nullable: true })
  kr_x_url: string | null;

  @Column({ name: 'kr_gruop_telegram_url', type: 'varchar', nullable: true })
  kr_gruop_telegram_url: string | null;

  @Column({ name: 'kr_youtube_url', type: 'varchar', nullable: true })
  kr_youtube_url: string | null;

  @Column({ name: 'kr_website_url', type: 'varchar', nullable: true })
  kr_website_url: string | null;

  @Column({
    name: 'kr_status',
    type: 'enum',
    enum: KolRegisterStatus,
    default: KolRegisterStatus.PENDING,
  })
  kr_status: KolRegisterStatus;

  @ManyToOne(() => User, (user) => user.kol_registers)
  @JoinColumn({ name: 'kr_user_id' })
  user: User;
}

