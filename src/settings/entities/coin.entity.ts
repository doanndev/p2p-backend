import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { CoinNetwork } from './coin-network.entity';

export enum CoinStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('coins')
export class Coin {
  @PrimaryGeneratedColumn({ name: 'coin_id', type: 'integer' })
  coin_id: number;

  @Column({ name: 'coin_name', type: 'varchar', unique: true })
  coin_name: string;

  @Column({ name: 'coin_symbol', type: 'varchar', unique: true })
  coin_symbol: string;

  @Column({ name: 'coin_logo', type: 'varchar' })
  coin_logo: string;

  @Column({ name: 'coin_website', type: 'varchar', nullable: true })
  coin_website: string;

  @Column({
    name: 'coin_status',
    type: 'enum',
    enum: CoinStatus,
    default: CoinStatus.ACTIVE,
  })
  coin_status: CoinStatus;

  @OneToMany(() => CoinNetwork, (coinNetwork) => coinNetwork.coin)
  coin_networks: CoinNetwork[];
}

