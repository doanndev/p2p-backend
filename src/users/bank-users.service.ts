import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { CacheService } from '../systems/cache.service';

type CreateBankRequestPayload = {
  requestId: string;
  requestedByUserId: number;
  bankName: string;
  bankBranch: string | null;
  bankAccountName: string;
  bankAccountNumber: string;
  requestedAt: string;
};

const CREATE_BANK_REQUEST_TTL_SECONDS = 24 * 60 * 60;
const CREATE_BANK_REQUEST_INDEX_KEY = 'bank-user:create-request:index';

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
    private readonly cacheService: CacheService,
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

  private generateCreateBankRequestId(): string {
    return `bank-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private getCreateBankRequestKey(requestId: string): string {
    return `bank-user:create-request:${requestId}`;
  }

  private async getCreateBankRequestIndex(): Promise<string[]> {
    const raw = await this.cacheService.get(CREATE_BANK_REQUEST_INDEX_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => String(item))
        .filter((item) => item.trim().length > 0);
    } catch {
      return [];
    }
  }

  private async saveCreateBankRequestIndex(
    requestIds: string[],
  ): Promise<void> {
    const uniqueIds = [...new Set(requestIds)].filter(
      (requestId) => requestId.trim().length > 0,
    );
    await this.cacheService.set(
      CREATE_BANK_REQUEST_INDEX_KEY,
      JSON.stringify(uniqueIds),
    );
  }

  private async addCreateBankRequestToIndex(requestId: string): Promise<void> {
    const current = await this.getCreateBankRequestIndex();
    if (current.includes(requestId)) return;
    current.push(requestId);
    await this.saveCreateBankRequestIndex(current);
  }

  private async removeCreateBankRequestFromIndex(
    requestId: string,
  ): Promise<void> {
    const current = await this.getCreateBankRequestIndex();
    const next = current.filter((id) => id !== requestId);
    await this.saveCreateBankRequestIndex(next);
  }

  private async getCreateBankRequest(
    requestId: string,
  ): Promise<CreateBankRequestPayload | null> {
    const raw = await this.cacheService.get(
      this.getCreateBankRequestKey(requestId),
    );
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as CreateBankRequestPayload;
      if (
        !parsed ||
        typeof parsed.requestId !== 'string' ||
        !Number.isInteger(parsed.requestedByUserId) ||
        typeof parsed.bankName !== 'string' ||
        typeof parsed.bankAccountName !== 'string' ||
        typeof parsed.bankAccountNumber !== 'string' ||
        typeof parsed.requestedAt !== 'string'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
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

    const count = await this.bankUserRepository.count({
      where: { bu_user_id: userId },
    });
    const requestIds = await this.getCreateBankRequestIndex();
    const requestPairs = await Promise.all(
      requestIds.map(async (requestId) => ({
        requestId,
        request: await this.getCreateBankRequest(requestId),
      })),
    );
    const validRequests = requestPairs
      .filter((pair) => pair.request !== null)
      .map((pair) => pair.request as CreateBankRequestPayload);
    const missingIds = requestPairs
      .filter((pair) => pair.request === null)
      .map((pair) => pair.requestId);
    if (missingIds.length > 0) {
      await this.saveCreateBankRequestIndex(
        validRequests.map((r) => r.requestId),
      );
    }
    const myPendingCount = validRequests.filter(
      (request) => request.requestedByUserId === userId,
    ).length;

    if (count + myPendingCount >= this.MAX_BANKS_PER_USER) {
      throw new BadRequestException('Each user can only create up to 5 banks');
    }

    const requestId = this.generateCreateBankRequestId();
    const payload: CreateBankRequestPayload = {
      requestId,
      requestedByUserId: userId,
      bankName: dto.bankName.trim(),
      bankBranch:
        dto.bankBranch === undefined ? null : (dto.bankBranch ?? null),
      bankAccountName: requestUser.ufulllname.trim(),
      bankAccountNumber: dto.bankAccountNumber.trim(),
      requestedAt: new Date().toISOString(),
    };
    await this.cacheService.set(
      this.getCreateBankRequestKey(requestId),
      JSON.stringify(payload),
      CREATE_BANK_REQUEST_TTL_SECONDS,
    );
    await this.addCreateBankRequestToIndex(requestId);

    return {
      message: 'Bank create request submitted and waiting for admin approval',
      requestId,
      requestedAt: payload.requestedAt,
      expiresInSeconds: CREATE_BANK_REQUEST_TTL_SECONDS,
      bank: {
        bankName: payload.bankName,
        bankBranch: payload.bankBranch,
        bankAccountName: payload.bankAccountName,
        bankAccountNumber: payload.bankAccountNumber,
      },
    };
  }

  async getPendingCreateBankRequests() {
    const requestIds = await this.getCreateBankRequestIndex();
    if (requestIds.length === 0) {
      return { statusCode: 200, data: [] };
    }

    const requestPairs = await Promise.all(
      requestIds.map(async (requestId) => ({
        requestId,
        request: await this.getCreateBankRequest(requestId),
      })),
    );
    const validRequests = requestPairs
      .filter((pair) => pair.request !== null)
      .map((pair) => pair.request as CreateBankRequestPayload);
    const missingIds = requestPairs
      .filter((pair) => pair.request === null)
      .map((pair) => pair.requestId);
    if (missingIds.length > 0) {
      await this.saveCreateBankRequestIndex(
        validRequests.map((r) => r.requestId),
      );
    }
    if (validRequests.length === 0) {
      return { statusCode: 200, data: [] };
    }

    const requestUsers = await this.userRepository.find({
      where: { uid: In(validRequests.map((r) => r.requestedByUserId)) },
      select: ['uid', 'uname', 'uemail', 'ufulllname'],
    });
    const userById = new Map(requestUsers.map((u) => [u.uid, u]));

    return {
      statusCode: 200,
      data: validRequests.map((request) => {
        const requester = userById.get(request.requestedByUserId);
        return {
          requestId: request.requestId,
          requestedAt: request.requestedAt,
          requestedBy: requester
            ? {
                id: requester.uid,
                username: requester.uname,
                email: requester.uemail,
                fullName: requester.ufulllname,
              }
            : { id: request.requestedByUserId },
          bank: {
            bankName: request.bankName,
            bankBranch: request.bankBranch,
            bankAccountName: request.bankAccountName,
            bankAccountNumber: request.bankAccountNumber,
          },
        };
      }),
    };
  }

  async reviewCreateBankRequest(requestId: string, approve: boolean) {
    const request = await this.getCreateBankRequest(requestId);
    if (!request) {
      throw new NotFoundException('No pending create-bank request found');
    }

    let createdBankId: number | null = null;
    if (approve) {
      const count = await this.bankUserRepository.count({
        where: { bu_user_id: request.requestedByUserId },
      });
      if (count >= this.MAX_BANKS_PER_USER) {
        throw new BadRequestException(
          'Cannot approve: user already reached max bank limit',
        );
      }

      const created = this.bankUserRepository.create({
        bu_user_id: request.requestedByUserId,
        bu_bank_name: request.bankName,
        bu_bank_branch: request.bankBranch,
        bu_bank_account_name: request.bankAccountName,
        bu_bank_account_number: request.bankAccountNumber,
      });
      const saved = await this.bankUserRepository.save(created);
      createdBankId = saved.bu_id;
    }

    await this.cacheService.del(this.getCreateBankRequestKey(requestId));
    await this.removeCreateBankRequestFromIndex(requestId);

    return {
      message: approve
        ? 'Create bank request approved'
        : 'Create bank request rejected',
      requestId,
      approved: approve,
      bankId: createdBankId,
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
