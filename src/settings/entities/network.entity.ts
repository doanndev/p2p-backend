import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { CoinNetwork } from './coin-network.entity';

export enum NetStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('networks')
export class Network {
  @PrimaryGeneratedColumn({ name: 'net_id', type: 'integer' })
  net_id: number;

  @Column({ name: 'net_name', type: 'varchar', unique: true })
  net_name: string;

  @Column({ name: 'net_symbol', type: 'varchar', unique: true })
  net_symbol: string;

  @Column({ name: 'net_logo', type: 'varchar' })
  net_logo: string;

  @Column({ name: 'net_scan', type: 'varchar', unique: true })
  net_scan: string;

  @Column({
    name: 'net_status',
    type: 'enum',
    enum: NetStatus,
    default: NetStatus.ACTIVE,
  })
  net_status: NetStatus;

  @OneToMany(() => CoinNetwork, (coinNetwork) => coinNetwork.network)
  coin_networks: CoinNetwork[];
}

