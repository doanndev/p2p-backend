import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { UserVerify, UserVerifyStatus } from '../users/entities/user-verify.entity';
import { BankUser } from '../users/entities/bank-user.entity';
import { BankUserApprovalStatus } from '../users/entities/bank-user-approval-status';
import { SettingBankOrder } from '../orderbook/entities/setting-bank-order.entity';

export type AdminPendingSummaryData = {
  kyc: number;
  kyc_pending: number;
  kyc_retry: number;
  bank_requests: number;
  bank_create: number;
  bank_orderbook_change: number;
};

@Injectable()
export class AdminsPendingSummaryService {
  constructor(
    @InjectRepository(UserVerify)
    private readonly userVerifyRepository: Repository<UserVerify>,
    @InjectRepository(BankUser)
    private readonly bankUserRepository: Repository<BankUser>,
    @InjectRepository(SettingBankOrder)
    private readonly settingBankOrderRepository: Repository<SettingBankOrder>,
  ) {}

  async getPendingSummary(): Promise<{
    statusCode: number;
    data: AdminPendingSummaryData;
  }> {
    const [kycPending, kycRetry, bankCreate, bankOrderbookChange] =
      await Promise.all([
        this.userVerifyRepository.count({
          where: {
            uv_status: UserVerifyStatus.PENDING,
            uv_paper_image: Not(IsNull()),
          },
        }),
        this.userVerifyRepository.count({
          where: { uv_status: UserVerifyStatus.RETRY },
        }),
        this.bankUserRepository.count({
          where: { bu_approval_status: BankUserApprovalStatus.PENDING },
        }),
        this.settingBankOrderRepository.count({
          where: { sbo_pending_bank_id: Not(IsNull()) },
        }),
      ]);

    return {
      statusCode: 200,
      data: {
        kyc: kycPending + kycRetry,
        kyc_pending: kycPending,
        kyc_retry: kycRetry,
        bank_requests: bankCreate + bankOrderbookChange,
        bank_create: bankCreate,
        bank_orderbook_change: bankOrderbookChange,
      },
    };
  }
}
