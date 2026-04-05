import { Injectable, Logger } from '@nestjs/common';
import type { ChainDepositAssetContext } from './chain-deposit-asset.context';
import type { ChainDepositSyncPort } from './chain-deposit-sync.port';
import type { OnchainTransaction } from './onchain-transaction.types';

@Injectable()
export class BtcChainSyncService implements ChainDepositSyncPort {
  private readonly logger = new Logger(BtcChainSyncService.name);

  supports(netSymbol: string): boolean {
    return netSymbol.toUpperCase() === 'BTC';
  }

  async fetchAllDeposits(
    _address: string,
    ctx: ChainDepositAssetContext,
  ): Promise<OnchainTransaction[]> {
    this.logger.debug(
      `[phase-stub] BTC fetchAllDeposits mode=${ctx.mode} — not implemented yet`,
    );
    return [];
  }

  async fetchRecentDeposits(
    _address: string,
    ctx: ChainDepositAssetContext,
    _recentBlockOrSlotCount: number,
  ): Promise<OnchainTransaction[]> {
    this.logger.debug(
      `[phase-stub] BTC fetchRecentDeposits mode=${ctx.mode} — not implemented yet`,
    );
    return [];
  }

  async getDepositBalanceOnChain(
    _address: string,
    ctx: ChainDepositAssetContext,
  ): Promise<number> {
    this.logger.debug(
      `[phase-stub] BTC getDepositBalanceOnChain mode=${ctx.mode} — not implemented yet (return 0)`,
    );
    return 0;
  }
}
