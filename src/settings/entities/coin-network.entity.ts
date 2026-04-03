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

/** Chuẩn token theo mạng (mint/contract chỉ bắt buộc với các loại không native). */
export enum CoinType {
  NATIVE = 'native',
  SPL = 'spl',
  ERC20 = 'erc20',
  BEP20 = 'bep20',
  TRC20 = 'trc20',
}

@Entity('coin_networks')
export class CoinNetwork {
  @PrimaryGeneratedColumn({ name: 'cn_id', type: 'integer' })
  cn_id: number;

  @Column({ name: 'cn_network_id', type: 'integer' })
  cn_network_id: number;

  @Column({ name: 'cn_coin_id', type: 'integer' })
  cn_coin_id: number;

  /** Mint SPL / contract EVM-BEP; null khi {@link CoinType.NATIVE}. */
  @Column({
    name: 'cn_coin_mint',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  cn_coin_mint: string | null;

  @Column({
    name: 'cn_coin_type',
    type: 'enum',
    enum: CoinType,
    nullable: true,
  })
  cn_coin_type: CoinType | null;

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
