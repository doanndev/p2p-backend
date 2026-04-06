import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum FundType {
  GAIN_LOSS = 'gain_loss',
  ALWAYS_PROFITABLE = 'always_profitable',
}

export enum Difficulty {
  DEFAULT = 'default',
  ADVANCED = 'advanced',
}

@Entity('admin_settings')
export class AdminSetting {
  @PrimaryGeneratedColumn({ name: 'as_id', type: 'integer' })
  as_id: number;

  @Column({ name: 'as_turn_watch_default', type: 'smallint', default: 10 })
  as_turn_watch_default: number;

  @Column({ name: 'as_devices_default', type: 'smallint', default: 20 })
  as_devices_default: number;

  @Column({ name: 'as_time_gap', type: 'integer', default: 15 })
  as_time_gap: number;

  @Column({
    name: 'as_time_lock_gift_balance',
    type: 'integer',
    nullable: true,
    default: null,
  })
  as_time_lock_gift_balance: number | null;

  @Column({
    name: 'as_percent_day',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.2,
  })
  as_percent_day: number;

  @Column({
    name: 'as_percent_week',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 2.5,
  })
  as_percent_week: number;

  @Column({
    name: 'as_percent_month',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 20,
  })
  as_percent_month: number;

  @Column({ name: 'as_smart_ref_level', type: 'smallint', default: 2 })
  as_smart_ref_level: number;

  @Column({
    name: 'as_fund_type',
    type: 'enum',
    enum: FundType,
  })
  as_fund_type: FundType;

  @Column({
    name: 'as_fund_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  as_fund_amount: number;

  @Column({ name: 'as_turn_withdraw_free', type: 'smallint', default: 5 })
  as_turn_withdraw_free: number;

  @Column({
    name: 'as_difficulty',
    type: 'enum',
    enum: Difficulty,
  })
  as_difficulty: Difficulty;

  @Column({
    name: 'as_config_zerion_key',
    type: 'varchar',
    nullable: true,
    default: null,
  })
  as_config_zerion_key: string | null;

  @Column({
    name: 'as_config_rps_sol',
    type: 'varchar',
    nullable: true,
    default: null,
  })
  as_config_rps_sol: string | null;

  @Column({
    name: 'as_config_rps_eth',
    type: 'varchar',
    nullable: true,
    default: null,
  })
  as_config_rps_eth: string | null;

  /** RPC BSC (cột DB giữ tên as_config_rps_bnb). */
  @Column({
    name: 'as_config_rps_bnb',
    type: 'varchar',
    nullable: true,
    default: null,
  })
  as_config_rps_bnb: string | null;

  @Column({ name: 'as_config_rps_rate_limit', type: 'int', default: 50 })
  as_config_rps_rate_limit: number;
}
