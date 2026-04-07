import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum FundType {
  GAIN_LOSS = 'gain_loss',
  ALWAYS_PROFITABLE = 'always_profitable',
}

export enum Difficulty {
  DEFAULT = 'default',
  ADVANCED = 'advanced',
}

export enum AdminSettingType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  JSON = 'json',
}

export enum AdminSettingStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('admin_settings')
export class AdminSetting {
  @PrimaryGeneratedColumn({ name: 'as_id', type: 'integer' })
  as_id: number;

  @Column({ name: 'setting_name', type: 'varchar', unique: true })
  setting_name: string;

  @Column({
    name: 'setting_type',
    type: 'enum',
    enum: AdminSettingType,
    default: AdminSettingType.STRING,
  })
  setting_type: AdminSettingType;

  @Column({
    name: 'setting_value',
    type: 'text',
    nullable: true,
    default: null,
  })
  setting_value: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: AdminSettingStatus,
    default: AdminSettingStatus.ACTIVE,
  })
  status: AdminSettingStatus;
}
