import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Network } from './network.entity';
import { Coin } from './coin.entity';

export enum CoinNetworkStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('coin_networks')
export class CoinNetwork {
  @PrimaryGeneratedColumn({ name: 'cn_id', type: 'integer' })
  cn_id: number;

  @Column({ name: 'cn_network_id', type: 'integer' })
  cn_network_id: number;

  @Column({ name: 'cn_coin_id', type: 'integer' })
  cn_coin_id: number;

  @Column({ name: 'cn_coin_mint', type: 'varchar', unique: true })
  cn_coin_mint: string;

  @Column({
    name: 'cn_status',
    type: 'enum',
    enum: CoinNetworkStatus,
    default: CoinNetworkStatus.ACTIVE,
  })
  cn_status: CoinNetworkStatus;

  @ManyToOne(() => Network, (network) => network.coin_networks)
  @JoinColumn({ name: 'cn_network_id' })
  network: Network;

  @ManyToOne(() => Coin, (coin) => coin.coin_networks)
  @JoinColumn({ name: 'cn_coin_id' })
  coin: Coin;
}

