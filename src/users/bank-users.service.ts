import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Not, Repository } from 'typeorm';
import { BankUser } from './entities/bank-user.entity';
import { BankUserApprovalStatus } from './entities/bank-user-approval-status';
import { CreateBankUserDto } from './dto/create-bank-user.dto';
import { UpdateBankUserDto } from './dto/update-bank-user.dto';
import { SettingBankOrder } from '../orderbook/entities/setting-bank-order.entity';
import { User } from './entities/user.entity';
import {
  UserCode,
  UserCodePlace,
  UserCodeType,
} from './entities/user-code.entity';
import { EmailService } from '../systems/email.service';
import { requireTotpIfEnabled } from '../common/helpers/two-factor.helper';
import { BankMutationSecurityDto } from './dto/bank-mutation-security.dto';

@Injectable()
export class BankUsersService {
  private readonly logger = new Logger(BankUsersService.name);
  private readonly MAX_BANKS_PER_USER = 5;

  constructor(
    @InjectRepository(BankUser)
    private readonly bankUserRepository: Repository<BankUser>,
    @InjectRepository(SettingBankOrder)
    private readonly settingBankOrderRepository: Repository<SettingBankOrder>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserCode)
    private readonly userCodeRepository: Repository<UserCode>,
    private readonly emailService: EmailService,
  ) {}

  private generateEmailCode(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    return result;
  }

  private async verifyBankMutationSecurity(
    userId: number,
    dto: BankMutationSecurityDto,
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      select: ['uid', 'u_active_ggauth', 'uggauth'],
    });
    if (!user) throw new NotFoundException('User not found');

    requireTotpIfEnabled(user, dto.twoFactorCode);

    const userCode = await this.userCodeRepository.findOne({
      where: {
        uc_user_id: userId,
        uc_type: UserCodeType.BANK_MUTATION,
        uc_value: dto.emailCode.trim().toUpperCase(),
        uc_life: true,
      },
      order: { created_at: 'DESC' },
    });
    if (!userCode) {
      throw new BadRequestException('Invalid verification code');
    }

    if (userCode.uc_code_time < new Date()) {
      userCode.uc_life = false;
      await this.userCodeRepository.save(userCode);
      throw new BadRequestException('Verification code has expired');
    }

    userCode.uc_life = false;
    await this.userCodeRepository.save(userCode);
  }

  /**
   * Default: only **active** banks (safe for orderbook / buId pickers).
   * Pass `includePending=true` to also list pending rows (still excludes rejected).
   */
  async getMyBanks(userId: number, includePending = false) {
    const where: FindOptionsWhere<BankUser> = {
      bu_user_id: userId,
      ...(includePending
        ? { bu_approval_status: Not(BankUserApprovalStatus.REJECTED) }
        : { bu_approval_status: BankUserApprovalStatus.ACTIVE }),
    };
    const rows = await this.bankUserRepository.find({
      where,
      order: { bu_id: 'DESC' },
    });

    return rows.map((b) => ({
      id: b.bu_id,
      userId: b.bu_user_id,
      bankName: b.bu_bank_name,
      bankBranch: b.bu_bank_branch,
      bankAccountName: b.bu_bank_account_name,
      bankAccountNumber: b.bu_bank_account_number,
      approvalStatus: b.bu_approval_status,
      requestedAt: b.bu_requested_at,
    }));
  }

  async createMyBank(userId: number, dto: CreateBankUserDto) {
    const requestUser = await this.userRepository.findOne({
      where: { uid: userId },
      select: ['uid', 'uverify', 'ufulllname'],
    });
    if (!requestUser) throw new NotFoundException('User not found');
    if (requestUser.uverify !== true) {
      throw new ForbiddenException(
        'Identity not verified. Please verify your identity to continue.',
      );
    }

    const usageCount = await this.bankUserRepository.count({
      where: {
        bu_user_id: userId,
        bu_approval_status: In([
          BankUserApprovalStatus.ACTIVE,
          BankUserApprovalStatus.PENDING,
        ]),
      },
    });

    if (usageCount >= this.MAX_BANKS_PER_USER) {
      throw new BadRequestException('Each user can only create up to 5 banks');
    }

    const requestedAt = new Date();
    const created = this.bankUserRepository.create({
      bu_user_id: userId,
      bu_bank_name: dto.bankName.trim(),
      bu_bank_branch:
        dto.bankBranch === undefined ? null : (dto.bankBranch ?? null),
      bu_bank_account_name: requestUser.ufulllname.trim(),
      bu_bank_account_number: dto.bankAccountNumber.trim(),
      bu_approval_status: BankUserApprovalStatus.PENDING,
      bu_requested_at: requestedAt,
    });
    const saved = await this.bankUserRepository.save(created);

    return {
      message: 'Bank create request submitted and waiting for admin approval',
      requestId: String(saved.bu_id),
      requestedAt: requestedAt.toISOString(),
      bank: {
        bankName: saved.bu_bank_name,
        bankBranch: saved.bu_bank_branch,
        bankAccountName: saved.bu_bank_account_name,
        bankAccountNumber: saved.bu_bank_account_number,
      },
    };
  }

  async getPendingCreateBankRequests() {
    const pending = await this.bankUserRepository.find({
      where: { bu_approval_status: BankUserApprovalStatus.PENDING },
      order: { bu_id: 'DESC' },
    });
    if (pending.length === 0) {
      return { statusCode: 200, data: [] };
    }

    const requestUsers = await this.userRepository.find({
      where: { uid: In(pending.map((r) => r.bu_user_id)) },
      select: ['uid', 'uname', 'uemail', 'ufulllname'],
    });
    const userById = new Map(requestUsers.map((u) => [u.uid, u]));

    return {
      statusCode: 200,
      data: pending.map((row) => {
        const requester = userById.get(row.bu_user_id);
        return {
          requestId: String(row.bu_id),
          requestedAt: row.bu_requested_at?.toISOString() ?? null,
          requestedBy: requester
            ? {
                id: requester.uid,
                username: requester.uname,
                email: requester.uemail,
                fullName: requester.ufulllname,
              }
            : { id: row.bu_user_id },
          bank: {
            bankName: row.bu_bank_name,
            bankBranch: row.bu_bank_branch,
            bankAccountName: row.bu_bank_account_name,
            bankAccountNumber: row.bu_bank_account_number,
          },
        };
      }),
    };
  }

  async reviewCreateBankRequest(requestId: string, approve: boolean) {
    const bankPendingId = Number(requestId);
    if (!Number.isInteger(bankPendingId) || bankPendingId <= 0) {
      throw new BadRequestException('Invalid request id');
    }

    const row = await this.bankUserRepository.findOne({
      where: { bu_id: bankPendingId },
    });
    if (!row || row.bu_approval_status !== BankUserApprovalStatus.PENDING) {
      throw new NotFoundException('No pending create-bank request found');
    }

    if (approve) {
      const activeCount = await this.bankUserRepository.count({
        where: {
          bu_user_id: row.bu_user_id,
          bu_approval_status: BankUserApprovalStatus.ACTIVE,
        },
      });
      if (activeCount >= this.MAX_BANKS_PER_USER) {
        throw new BadRequestException(
          'Cannot approve: user already reached max bank limit',
        );
      }
      row.bu_approval_status = BankUserApprovalStatus.ACTIVE;
      row.bu_requested_at = null;
      await this.bankUserRepository.save(row);
      return {
        message: 'Create bank request approved',
        requestId: String(row.bu_id),
        approved: true,
        bankId: row.bu_id,
      };
    }

    row.bu_approval_status = BankUserApprovalStatus.REJECTED;
    row.bu_requested_at = null;
    await this.bankUserRepository.save(row);
    return {
      message: 'Create bank request rejected',
      requestId: String(row.bu_id),
      approved: false,
      bankId: null,
    };
  }

  async sendBankMutationVerifyCode(userId: number) {
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      select: ['uid', 'uemail'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.uemail) throw new BadRequestException('User email is missing');

    await this.userCodeRepository.update(
      {
        uc_user_id: userId,
        uc_type: UserCodeType.BANK_MUTATION,
        uc_life: true,
      },
      { uc_life: false },
    );

    const code = this.generateEmailCode();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
    const userCode = this.userCodeRepository.create({
      uc_value: code,
      uc_type: UserCodeType.BANK_MUTATION,
      uc_place: UserCodePlace.EMAIL,
      uc_code_time: expiresAt,
      uc_life: true,
      uc_user_id: userId,
    });
    await this.userCodeRepository.save(userCode);
    void this.emailService
      .sendEmailVerificationCode(user.uemail, code)
      .catch((err) => {
        this.logger.warn(
          `bank mutation verify email failed userId=${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    return {
      message: 'Verification code has been sent to your email',
      expires_at: expiresAt.toISOString(),
    };
  }

  async updateMyBank(userId: number, bankId: number, dto: UpdateBankUserDto) {
    const bank = await this.bankUserRepository.findOne({
      where: { bu_id: bankId, bu_user_id: userId },
    });
    if (!bank) throw new NotFoundException('Bank not found');
    if (bank.bu_user_id !== userId) {
      throw new ForbiddenException('You can only update your own bank');
    }
    if (bank.bu_approval_status !== BankUserApprovalStatus.ACTIVE) {
      throw new BadRequestException(
        'Only active banks can be updated. Pending or rejected rows cannot be edited.',
      );
    }

    if (dto.bankName !== undefined) {
      bank.bu_bank_name = dto.bankName.trim();
    }
    if (dto.bankBranch !== undefined) {
      bank.bu_bank_branch = dto.bankBranch ?? null;
    }
    if (dto.bankAccountNumber !== undefined) {
      bank.bu_bank_account_number = dto.bankAccountNumber.trim();
    }

    const saved = await this.bankUserRepository.save(bank);
    return {
      id: saved.bu_id,
      userId: saved.bu_user_id,
      bankName: saved.bu_bank_name,
      bankBranch: saved.bu_bank_branch,
      bankAccountName: saved.bu_bank_account_name,
      bankAccountNumber: saved.bu_bank_account_number,
    };
  }

  async updateMyBankSecure(
    userId: number,
    bankId: number,
    dto: UpdateBankUserDto & BankMutationSecurityDto,
  ) {
    await this.verifyBankMutationSecurity(userId, dto);
    return this.updateMyBank(userId, bankId, dto);
  }

  async deleteMyBank(userId: number, bankId: number) {
    const bank = await this.bankUserRepository.findOne({
      where: { bu_id: bankId, bu_user_id: userId },
    });
    if (!bank) throw new NotFoundException('Bank not found');
    if (bank.bu_user_id !== userId) {
      throw new ForbiddenException('You can only delete your own bank');
    }

    const linkedAsPrimary = await this.settingBankOrderRepository.count({
      where: { sbo_bank_id: bankId },
    });
    const linkedAsPending = await this.settingBankOrderRepository.count({
      where: { sbo_pending_bank_id: bankId },
    });
    if (linkedAsPrimary > 0 || linkedAsPending > 0) {
      throw new BadRequestException(
        'This bank is attached to an orderbook (or pending change). Detach or wait for admin review first.',
      );
    }

    await this.bankUserRepository.delete({ bu_id: bankId });
    return { message: 'Bank deleted successfully' };
  }

  async deleteMyBankSecure(
    userId: number,
    bankId: number,
    dto: BankMutationSecurityDto,
  ) {
    await this.verifyBankMutationSecurity(userId, dto);
    return this.deleteMyBank(userId, bankId);
  }
}
