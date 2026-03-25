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

@Injectable()
export class BankUsersService {
  private readonly MAX_BANKS_PER_USER = 5;

  constructor(
    @InjectRepository(BankUser)
    private readonly bankUserRepository: Repository<BankUser>,
    @InjectRepository(SettingBankOrder)
    private readonly settingBankOrderRepository: Repository<SettingBankOrder>,
  ) {}

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
}
