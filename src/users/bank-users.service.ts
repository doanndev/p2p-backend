import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankUser } from './entities/bank-user.entity';
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

  async getMyBanks(userId: number) {
    const rows = await this.bankUserRepository.find({
      where: { bu_user_id: userId },
      order: { bu_id: 'DESC' },
    });

    return rows.map((b) => ({
      id: b.bu_id,
      userId: b.bu_user_id,
      bankName: b.bu_bank_name,
      bankBranch: b.bu_bank_branch,
      bankAccountName: b.bu_bank_account_name,
      bankAccountNumber: b.bu_bank_account_number,
    }));
  }

  async createMyBank(userId: number, dto: CreateBankUserDto) {
    const count = await this.bankUserRepository.count({
      where: { bu_user_id: userId },
    });
    if (count >= this.MAX_BANKS_PER_USER) {
      throw new BadRequestException('Each user can only create up to 5 banks');
    }

    const bank = this.bankUserRepository.create({
      bu_user_id: userId,
      bu_bank_name: dto.bankName.trim(),
      bu_bank_branch:
        dto.bankBranch === undefined ? null : (dto.bankBranch ?? null),
      bu_bank_account_name: dto.bankAccountName.trim(),
      bu_bank_account_number: dto.bankAccountNumber.trim(),
    });

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
    await this.emailService.sendEmailVerificationCode(user.uemail, code);

    return {
      message: 'Verification code has been sent to your email',
      expires_at: expiresAt.toISOString(),
    };
  }

  async updateMyBank(userId: number, bankId: number, dto: UpdateBankUserDto) {
    const bank = await this.bankUserRepository.findOne({
      where: { bu_id: bankId },
    });
    if (!bank) throw new NotFoundException('Bank not found');
    if (bank.bu_user_id !== userId) {
      throw new ForbiddenException('You can only update your own bank');
    }

    if (dto.bankName !== undefined) {
      bank.bu_bank_name = dto.bankName.trim();
    }
    if (dto.bankBranch !== undefined) {
      bank.bu_bank_branch = dto.bankBranch ?? null;
    }
    if (dto.bankAccountName !== undefined) {
      bank.bu_bank_account_name = dto.bankAccountName.trim();
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
      where: { bu_id: bankId },
    });
    if (!bank) throw new NotFoundException('Bank not found');
    if (bank.bu_user_id !== userId) {
      throw new ForbiddenException('You can only delete your own bank');
    }

    const linkedCount = await this.settingBankOrderRepository.count({
      where: { sbo_bank_id: bankId },
    });
    if (linkedCount > 0) {
      throw new BadRequestException(
        'This bank is attached to an orderbook. Detach it first.',
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
