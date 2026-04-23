/* eslint-disable @typescript-eslint/no-unused-vars */
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
      total_deposit: number;
      total_withdraw: number;
      total_balance: number;
    };
  }> {
    // 1. Tổng số users
    const totalUsers = await this.userRepository.count();

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

    // 7. Tổng số tiền đã chuyển từ reward sang main (wallet_transfers, lịch sử)
    const totalRewardResult = await this.walletTransferRepository
      .createQueryBuilder('wt')
      .select('COALESCE(SUM(wt.wt_amount), 0)', 'total')
      .where('wt.wt_from = :from', { from: WalletTransferFrom.REWARD })
      .andWhere('wt.wt_to = :to', { to: WalletTransferTo.MAIN })
      .andWhere('wt.wt_status = :status', {
        status: WalletTransferStatus.SUCCESS,
      })
      .getRawOne();
    const totalReward = parseFloat(totalRewardResult?.total || '0');

    // 8. Tổng số tiền trong hệ thống (balance)
    const totalBalanceResult = await this.userWalletRepository
      .createQueryBuilder('uw')
      .select('COALESCE(SUM(uw.uw_balance), 0)', 'total')
      .getRawOne();
    const totalBalance = parseFloat(totalBalanceResult?.total || '0');

    // 9. Tổng số tiền chuyển từ gift sang main (wallet_transfers)
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
        total_deposit: totalDeposit,
        total_withdraw: totalWithdraw,
        total_balance: totalBalance,
      },
    };
  }

  async getRunningStatistics(): Promise<{
    statusCode: number;
    message: string;
    statistics: {
      total_users: number;
      total_deposit: number;
      total_withdraw: number;
      total_balance: number;
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
