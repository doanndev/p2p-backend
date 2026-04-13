import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  WalletHistory,
  WalletHistoryOption,
  WalletHistoryStatus,
} from '../wallets/entities/wallet-history.entity';
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import {
  WalletTransfer,
  WalletTransferFrom,
  WalletTransferStatus,
  WalletTransferTo,
} from '../wallets/entities/wallet-transfer.entity';

@Injectable()
export class AdminsStatisticsService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(WalletHistory)
    private walletHistoryRepository: Repository<WalletHistory>,
    @InjectRepository(UserWallet)
    private userWalletRepository: Repository<UserWallet>,
    @InjectRepository(WalletTransfer)
    private walletTransferRepository: Repository<WalletTransfer>,
  ) {}

  async getPlatformStatistics(): Promise<{
    statusCode: number;
    message: string;
    statistics: {
      total_users: number;
      total_staking_count: number;
      total_staking_amount: number;
      total_estimated_reward: number;
      total_deposit: number;
      total_withdraw: number;
      total_reward: number;
      total_balance: number;
      total_balance_gift: number;
      total_transfer_main: number;
    };
  }> {
    // 1. Tổng số users
    const totalUsers = await this.userRepository.count();

    const totalStakingCount = 0;
    const totalStakingAmount = 0;
    const totalEstimatedReward = 0;

    // 5. Tổng số tiền nạp (deposit - SUCCESS hoặc CHECKED)
    const totalDepositResult = await this.walletHistoryRepository
      .createQueryBuilder('wh')
      .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
      .where('wh.wh_option = :option', { option: WalletHistoryOption.DEPOSIT })
      .andWhere('wh.wh_status IN (:...statuses)', {
        statuses: [WalletHistoryStatus.SUCCESS, WalletHistoryStatus.CHECKED],
      })
      .getRawOne();
    const totalDeposit = parseFloat(totalDepositResult?.total || '0');

    // 6. Tổng số tiền rút (withdraw - SUCCESS hoặc CHECKED)
    const totalWithdrawResult = await this.walletHistoryRepository
      .createQueryBuilder('wh')
      .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
      .where('wh.wh_option = :option', { option: WalletHistoryOption.WITHDRAW })
      .andWhere('wh.wh_status IN (:...statuses)', {
        statuses: [WalletHistoryStatus.SUCCESS, WalletHistoryStatus.CHECKED],
      })
      .getRawOne();
    const totalWithdraw = parseFloat(totalWithdrawResult?.total || '0');

    // 7. Tổng số tiền reward (tổng uw_balance_reward trên hệ thống)
    const totalRewardResult = await this.userWalletRepository
      .createQueryBuilder('uw')
      .select('COALESCE(SUM(uw.uw_balance_reward), 0)', 'total')
      .getRawOne();
    const totalReward = parseFloat(totalRewardResult?.total || '0');

    // 8. Tổng số tiền trong hệ thống (balance)
    const totalBalanceResult = await this.userWalletRepository
      .createQueryBuilder('uw')
      .select('COALESCE(SUM(uw.uw_balance), 0)', 'total')
      .getRawOne();
    const totalBalance = parseFloat(totalBalanceResult?.total || '0');

    // 9. Tổng số tiền gift trong hệ thống
    const totalBalanceGiftResult = await this.userWalletRepository
      .createQueryBuilder('uw')
      .select('COALESCE(SUM(uw.uw_balance_gift), 0)', 'total')
      .getRawOne();
    const totalBalanceGift = parseFloat(totalBalanceGiftResult?.total || '0');

    // 10. Tổng số tiền chuyển từ gift sang main (wallet_transfers)
    const totalTransferMainResult = await this.walletTransferRepository
      .createQueryBuilder('wt')
      .select('COALESCE(SUM(wt.wt_amount), 0)', 'total')
      .where('wt.wt_from = :from', { from: WalletTransferFrom.GIFT })
      .andWhere('wt.wt_to = :to', { to: WalletTransferTo.MAIN })
      .andWhere('wt.wt_status = :status', {
        status: WalletTransferStatus.SUCCESS,
      })
      .getRawOne();
    const totalTransferMain = parseFloat(totalTransferMainResult?.total || '0');

    return {
      statusCode: 200,
      message: 'Platform statistics retrieved successfully',
      statistics: {
        total_users: totalUsers,
        total_staking_count: totalStakingCount,
        total_staking_amount: totalStakingAmount,
        total_estimated_reward: totalEstimatedReward,
        total_deposit: totalDeposit,
        total_withdraw: totalWithdraw,
        total_reward: totalReward,
        total_balance: totalBalance,
        total_balance_gift: totalBalanceGift,
        total_transfer_main: totalTransferMain,
      },
    };
  }

  async getRunningStatistics(): Promise<{
    statusCode: number;
    message: string;
    statistics: {
      total_users: number;
      total_staking_count: number;
      total_staking_amount: number;
      total_estimated_reward: number;
      total_deposit: number;
      total_withdraw: number;
      total_reward: number;
      total_balance: number;
      total_balance_gift: number;
      total_transfer_main: number;
    };
  }> {
    const platform = await this.getPlatformStatistics();
    return {
      statusCode: 200,
      message: 'Running statistics retrieved successfully',
      statistics: platform.statistics,
    };
  }

}
