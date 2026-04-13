import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('setting_rewards_smartref')
@Index(['srs_level'], { unique: true })
export class SettingRewardSmartref {
  @PrimaryGeneratedColumn({ name: 'srs_id', type: 'integer' })
  srs_id: number;

  @Column({ name: 'srs_level', type: 'smallint' })
  srs_level: number;

  /** Phần trăm hoa hồng theo cấp (tên cột theo schema gốc: parcentage) */
  @Column({
    name: 'srs_parcentage',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
  })
  srs_parcentage: string;

  @Column({ name: 'srs_is_active', type: 'boolean', default: true })
  srs_is_active: boolean;
}
