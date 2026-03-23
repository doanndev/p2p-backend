import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('admin_setting_turn')
export class AdminSettingTurn {
  @PrimaryGeneratedColumn({ name: 'ast_id', type: 'integer' })
  ast_id: number;

  @Column({
    name: 'ast_min_staking',
    type: 'decimal',
    precision: 10,
    scale: 2,
  })
  ast_min_staking: number;

  @Column({ name: 'ast_turn_watch', type: 'smallint' })
  ast_turn_watch: number;

  @Column({ name: 'ast_devices', type: 'smallint' })
  ast_devices: number;
}

