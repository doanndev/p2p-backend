import { Injectable } from '@nestjs/common';
import type { ChainDepositSyncPort } from './chain-deposit-sync.port';
import { SolChainSyncService } from './sol-chain-sync.service';
import { EvmChainSyncService } from './evm-chain-sync.service';
import { BtcChainSyncService } from './btc-chain-sync.service';
import { TronChainSyncService } from './tron-chain-sync.service';

@Injectable()
export class ChainSyncRouterService {
  constructor(
    private readonly solChainSync: SolChainSyncService,
    private readonly evmChainSync: EvmChainSyncService,
    private readonly btcChainSync: BtcChainSyncService,
    private readonly tronChainSync: TronChainSyncService,
  ) {}

  /** Specific chains before broad EVM set. */
  resolve(netSymbol: string): ChainDepositSyncPort | null {
    const u = netSymbol.trim().toUpperCase();
    if (this.solChainSync.supports(u)) return this.solChainSync;
    if (this.btcChainSync.supports(u)) return this.btcChainSync;
    if (this.tronChainSync.supports(u)) return this.tronChainSync;
    if (this.evmChainSync.supports(u)) return this.evmChainSync;
    return null;
  }
}
