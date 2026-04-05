import type { ChainDepositAssetContext } from './chain-deposit-asset.context';
import type { OnchainTransaction } from './onchain-transaction.types';

export interface ChainDepositSyncPort {
  supports(netSymbol: string): boolean;

  fetchAllDeposits(
    address: string,
    ctx: ChainDepositAssetContext,
  ): Promise<OnchainTransaction[]>;

  fetchRecentDeposits(
    address: string,
    ctx: ChainDepositAssetContext,
    recentBlockOrSlotCount: number,
  ): Promise<OnchainTransaction[]>;

  getDepositBalanceOnChain(
    address: string,
    ctx: ChainDepositAssetContext,
  ): Promise<number>;
}
