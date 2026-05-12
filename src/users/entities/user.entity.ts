import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { UserCode } from './user-code.entity';
import { UserVerify } from './user-verify.entity';
import { Notification } from './notification.entity';
import { UserLog } from './user-log.entity';
import { KolRegister } from './kol-register.entity';
import { BankUser } from './bank-user.entity';

export enum UserSex {
  MAN = 'man',
  WOMAN = 'woman',
  OTHER = 'other',
}

export enum UserStatus {
  ACTIVE = 'active',
  BLOCK_WITHDRAW = 'block_withdraw',
  BLOCK = 'block',
  /** Chặt giao dịch P2P (orderbook/transaction); không giống BLOCK toàn tài khoản */
  BLOCK_TRADE = 'block_trade',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn({ name: 'uid', type: 'integer' })
  uid: number;

  @Column({ name: 'uname', type: 'varchar', unique: true })
  uname: string;

  @Column({ name: 'uemail', type: 'varchar', unique: true })
  uemail: string;

  @Column({ name: 'uphone', type: 'varchar', unique: true, nullable: true })
  uphone: string | null;

  @Column({ name: 'utelegram', type: 'varchar', unique: true, nullable: true })
  utelegram: string | null;

  @Column({ name: 'uggauth', type: 'varchar', unique: true, nullable: true })
  uggauth: string | null;

  /** Google OAuth subject (`sub` claim); not Google Authenticator secret */
  @Column({
    name: 'ugoogle_sub',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  ugoogle_sub: string | null;

  @Column({ name: 'upassword', type: 'varchar' })
  upassword: string;

  @Column({ name: 'uref', type: 'varchar', unique: true })
  uref: string;

  @Column({ name: 'ufulllname', type: 'varchar' })
  ufulllname: string;

  @Column({ name: 'uavatar', type: 'varchar', nullable: true })
  uavatar: string | null;

  @Column({ name: 'ubirthday', type: 'date', nullable: true })
  ubirthday: Date | null;

  @Column({
    name: 'usex',
    type: 'enum',
    enum: UserSex,
  })
  usex: UserSex;

  @Column({ name: 'u_active_email', type: 'boolean' })
  u_active_email: boolean;

  @Column({ name: 'u_active_ggauth', type: 'boolean' })
  u_active_ggauth: boolean;

  @Column({ name: 'uverify', type: 'boolean' })
  uverify: boolean;

  @Column({ name: 'ulevel', type: 'smallint' })
  ulevel: number;

  @Column({ name: 'need_levelup', type: 'boolean', default: false })
  need_levelup: boolean;

  @Column({
    name: 'current_cycle_active_days',
    type: 'integer',
    default: 0,
  })
  current_cycle_active_days: number;

  /** When KYC was approved by admin (or first time identity became verified). */
  @Column({
    name: 'verify_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  verify_at: Date | null;

  /**
   * Start of the current 10-day P2P level-up evaluation window.
   * Set to the same instant as verify_at on first KYC approval; advanced by the daily job
   * when a window closes without a qualifying trade; reset on auto level-up and admin review.
   */
  @Column({
    name: 'levelup_window_started_at',
    type: 'timestamptz',
    nullable: true,
    default: null,
  })
  levelup_window_started_at: Date | null;

  @Column({ name: 'ukol', type: 'boolean', default: false })
  ukol: boolean;

  @Column({
    name: 'ustatus',
    type: 'enum',
    enum: UserStatus,
  })
  ustatus: UserStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @OneToMany(() => UserCode, (userCode) => userCode.user)
  user_codes: UserCode[];

  @OneToMany(() => UserVerify, (userVerify) => userVerify.user)
  user_verifies: UserVerify[];

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications: Notification[];

  @OneToMany(() => UserLog, (userLog) => userLog.user)
  user_logs: UserLog[];

  @OneToMany(() => KolRegister, (kolRegister) => kolRegister.user)
  kol_registers: KolRegister[];

  @OneToMany(() => BankUser, (bankUser) => bankUser.user)
  bank_users: BankUser[];
}
