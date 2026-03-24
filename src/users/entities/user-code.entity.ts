import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum UserCodeType {
  TELE_LOGIN = 'tele-login',
  ACTIVE_EMAIL = 'active-email',
  RESET_PASSWORD = 'reset-password',
  WITHDRAW = 'withdraw',
}

export enum UserCodePlace {
  TELEGRAM = 'telegram',
  EMAIL = 'email',
  PHONE = 'phone',
}

@Entity('user_codes')
export class UserCode {
  @PrimaryGeneratedColumn({ name: 'uc_id', type: 'integer' })
  uc_id: number;

  @Column({ name: 'uc_value', type: 'varchar' })
  uc_value: string;

  @Column({
    name: 'uc_type',
    type: 'enum',
    enum: UserCodeType,
  })
  uc_type: UserCodeType;

  @Column({
    name: 'uc_place',
    type: 'enum',
    enum: UserCodePlace,
    nullable: true,
  })
  uc_place: UserCodePlace | null;

  @Column({ name: 'uc_code_time', type: 'timestamp' })
  uc_code_time: Date;

  @Column({ name: 'uc_life', type: 'boolean' })
  uc_life: boolean;

  @Column({ name: 'uc_user_id', type: 'integer' })
  uc_user_id: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'update_at', type: 'timestamp' })
  update_at: Date;

  @ManyToOne(() => User, (user) => user.user_codes)
  @JoinColumn({ name: 'uc_user_id' })
  user: User;
}
