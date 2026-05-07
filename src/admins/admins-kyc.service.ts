import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  UserVerify,
  UserVerifyStatus,
} from '../users/entities/user-verify.entity';
import { VerifyLog } from '../users/entities/verify-log.entity';
import { UpdateKycStatusDto } from './dto/update-kyc-status.dto';

@Injectable()
export class AdminsKycService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserVerify)
    private userVerifyRepository: Repository<UserVerify>,
    @InjectRepository(VerifyLog)
    private verifyLogRepository: Repository<VerifyLog>,
  ) {}

  async getKycList(status?: string): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      uv_id: number;
      uv_user_id: number;
      uv_id_card_number: string;
      uv_front_image: string;
      uv_backside_image: string | null;
      uv_paper_image: string | null;
      uv_challenge_code: string | null;
      uv_challenge_expires_at: Date | null;
      uv_status: UserVerifyStatus;
      user: {
        uid: number;
        uname: string;
        ufulllname: string;
        uemail: string;
        uphone: string | null;
        uavatar: string | null;
      };
    }>;
  }> {
    // Build query with optional status filter
    const queryBuilder = this.userVerifyRepository
      .createQueryBuilder('uv')
      .leftJoinAndSelect('uv.user', 'user')
      .select([
        'uv.uv_id',
        'uv.uv_user_id',
        'uv.uv_id_card_number',
        'uv.uv_front_image',
        'uv.uv_backside_image',
        'uv.uv_paper_image',
        'uv.uv_challenge_code',
        'uv.uv_challenge_expires_at',
        'uv.uv_status',
        'user.uid',
        'user.uname',
        'user.ufulllname',
        'user.uemail',
        'user.uphone',
        'user.uavatar',
      ])
      .orderBy('uv.uv_id', 'DESC');

    // Filter by status if provided
    if (status) {
      const validStatuses = [
        UserVerifyStatus.PENDING,
        UserVerifyStatus.CHALLENGE_PENDING,
        UserVerifyStatus.VERIFY,
        UserVerifyStatus.CANCEL,
        UserVerifyStatus.RETRY,
      ];

      const normalizedStatus = status.toLowerCase();
      let matchedStatus: UserVerifyStatus | null = null;

      for (const validStatus of validStatuses) {
        if (validStatus.toLowerCase() === normalizedStatus) {
          matchedStatus = validStatus;
          break;
        }
      }

      if (matchedStatus) {
        queryBuilder.where('uv.uv_status = :status', { status: matchedStatus });
        if (matchedStatus === UserVerifyStatus.PENDING) {
          queryBuilder.andWhere('uv.uv_paper_image IS NOT NULL');
        }
      }
    }

    const kycList = await queryBuilder.getMany();

    const formattedData = kycList.map((kyc) => ({
      uv_id: kyc.uv_id,
      uv_user_id: kyc.uv_user_id,
      uv_id_card_number: kyc.uv_id_card_number,
      uv_front_image: kyc.uv_front_image,
      uv_backside_image: kyc.uv_backside_image,
      uv_paper_image: kyc.uv_paper_image,
      uv_challenge_code: kyc.uv_challenge_code,
      uv_challenge_expires_at: kyc.uv_challenge_expires_at,
      uv_status: kyc.uv_status,
      user: {
        uid: kyc.user.uid,
        uname: kyc.user.uname,
        ufulllname: kyc.user.ufulllname,
        uemail: kyc.user.uemail,
        uphone: kyc.user.uphone,
        uavatar: kyc.user.uavatar,
      },
    }));

    return {
      statusCode: 200,
      message: 'KYC list retrieved successfully',
      data: formattedData,
    };
  }

  async getUserKycHistory(userId: number): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      uv_id: number;
      uv_user_id: number;
      uv_id_card_number: string;
      uv_front_image: string;
      uv_backside_image: string | null;
      uv_paper_image: string | null;
      uv_challenge_code: string | null;
      uv_challenge_expires_at: Date | null;
      uv_status: UserVerifyStatus;
      created_at?: Date;
    }>;
  }> {
    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    // Check if user exists
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const kycHistory = await this.userVerifyRepository
      .createQueryBuilder('uv')
      .where('uv.uv_user_id = :userId', { userId })
      .select([
        'uv.uv_id',
        'uv.uv_user_id',
        'uv.uv_id_card_number',
        'uv.uv_front_image',
        'uv.uv_backside_image',
        'uv.uv_paper_image',
        'uv.uv_challenge_code',
        'uv.uv_challenge_expires_at',
        'uv.uv_status',
      ])
      .orderBy(
        `CASE 
          WHEN uv.uv_status = '${UserVerifyStatus.PENDING}' THEN 1
          WHEN uv.uv_status = '${UserVerifyStatus.CHALLENGE_PENDING}' THEN 2
          WHEN uv.uv_status = '${UserVerifyStatus.RETRY}' THEN 3
          ELSE 4
        END`,
        'ASC',
      )
      .addOrderBy('uv.uv_id', 'DESC')
      .getMany();

    const formattedData = kycHistory.map((kyc) => ({
      uv_id: kyc.uv_id,
      uv_user_id: kyc.uv_user_id,
      uv_id_card_number: kyc.uv_id_card_number,
      uv_front_image: kyc.uv_front_image,
      uv_backside_image: kyc.uv_backside_image,
      uv_paper_image: kyc.uv_paper_image,
      uv_challenge_code: kyc.uv_challenge_code,
      uv_challenge_expires_at: kyc.uv_challenge_expires_at,
      uv_status: kyc.uv_status,
    }));

    return {
      statusCode: 200,
      message: 'KYC history retrieved successfully',
      data: formattedData,
    };
  }

  async checkUserKycStatus(userId: number): Promise<{
    statusCode: number;
    message: string;
    status:
      | 'verify'
      | 'retry'
      | 'pending'
      | 'not-verified'
      | 'awaiting_paper'
      | 'challenge_expired';
    notes?: Array<{ id: number; message: string | null }>;
    challenge_code?: string;
    challenge_expires_at?: string;
  }> {
    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    // First, check uverify field of the user
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // If uverify = true, return verify immediately
    if (user.uverify === true) {
      return {
        statusCode: 200,
        message: 'KYC status retrieved successfully',
        status: 'verify',
      };
    }

    // If uverify = false, continue with existing logic
    // Get all KYC verifications for this user
    const verifications = await this.userVerifyRepository.find({
      where: {
        uv_user_id: userId,
      },
    });

    // Check in priority order:
    // 1. If at least one record has uv_status = "verify" → status = "verify"
    const hasVerify = verifications.some(
      (v) => v.uv_status === UserVerifyStatus.VERIFY,
    );

    if (hasVerify) {
      // Update uverify to true if at least one verification is verified
      user.uverify = true;
      await this.userRepository.save(user);
      return {
        statusCode: 200,
        message: 'KYC status retrieved successfully',
        status: 'verify',
      };
    }

    // 2. If no verify, check if at least one record has uv_status = "retry" → status = "retry"
    const hasRetry = verifications.some(
      (v) => v.uv_status === UserVerifyStatus.RETRY,
    );

    if (hasRetry) {
      // Get all retry verifications' uv_id
      const retryVerifications = verifications.filter(
        (v) => v.uv_status === UserVerifyStatus.RETRY,
      );
      const retryVerifyIds = retryVerifications.map((v) => v.uv_id);

      // Get all verify_logs for these uv_ids
      const verifyLogs = await this.verifyLogRepository.find({
        where: {
          vl_verify_id: In(retryVerifyIds),
        },
      });

      // Format notes with id (vl_id) and message (vl_note)
      const notes = verifyLogs.map((log) => ({
        id: log.vl_id,
        message: log.vl_note,
      }));

      return {
        statusCode: 200,
        message: 'KYC status retrieved successfully',
        status: 'retry',
        notes: notes,
      };
    }

    const challengeRecords = verifications.filter(
      (v) => v.uv_status === UserVerifyStatus.CHALLENGE_PENDING,
    );
    if (challengeRecords.length > 0) {
      const challenge = challengeRecords.sort((a, b) => b.uv_id - a.uv_id)[0];
      const now = new Date();
      if (
        challenge.uv_challenge_expires_at &&
        now > challenge.uv_challenge_expires_at
      ) {
        return {
          statusCode: 200,
          message: 'KYC status retrieved successfully',
          status: 'challenge_expired',
        };
      }
      return {
        statusCode: 200,
        message: 'KYC status retrieved successfully',
        status: 'awaiting_paper',
        challenge_code: challenge.uv_challenge_code ?? undefined,
        challenge_expires_at: challenge.uv_challenge_expires_at
          ? challenge.uv_challenge_expires_at.toISOString()
          : undefined,
      };
    }

    const hasPending = verifications.some(
      (v) => v.uv_status === UserVerifyStatus.PENDING,
    );

    if (hasPending) {
      return {
        statusCode: 200,
        message: 'KYC status retrieved successfully',
        status: 'pending',
      };
    }

    return {
      statusCode: 200,
      message: 'KYC status retrieved successfully',
      status: 'not-verified',
    };
  }

  async updateKycStatus(
    userId: number,
    updateKycStatusDto: UpdateKycStatusDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
  }> {
    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    // Check if user exists
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check current KYC status (similar to checkUserKycStatus but without returning)
    let statusCheck: 'verify' | 'retry' | 'pending' | 'not-verified';

    // If uverify = true, status is verify
    if (user.uverify === true) {
      statusCheck = 'verify';
    } else {
      const verifications = await this.userVerifyRepository.find({
        where: {
          uv_user_id: userId,
        },
      });

      const hasChallengePending = verifications.some(
        (v) => v.uv_status === UserVerifyStatus.CHALLENGE_PENDING,
      );
      if (hasChallengePending) {
        throw new BadRequestException(
          'Cannot update KYC: user has not submitted the paper-holding photo yet (status: challenge_pending).',
        );
      }

      const hasVerify = verifications.some(
        (v) => v.uv_status === UserVerifyStatus.VERIFY,
      );
      const hasRetry = verifications.some(
        (v) => v.uv_status === UserVerifyStatus.RETRY,
      );
      const hasPending = verifications.some(
        (v) => v.uv_status === UserVerifyStatus.PENDING,
      );

      if (hasVerify) {
        statusCheck = 'verify';
      } else if (hasRetry) {
        statusCheck = 'retry';
      } else if (hasPending) {
        statusCheck = 'pending';
      } else {
        statusCheck = 'not-verified';
      }
    }

    if (statusCheck === 'verify' || statusCheck === 'not-verified') {
      throw new BadRequestException(
        'Cannot update KYC status. User KYC status is already verified or not-verified.',
      );
    }

    if (statusCheck === 'retry' || statusCheck === 'pending') {
      if (
        updateKycStatusDto.status !== 'verify' &&
        updateKycStatusDto.status !== 'retry'
      ) {
        throw new BadRequestException(
          'Status must be either "verify" or "retry" when current status is retry or pending',
        );
      }

      const verificationsToUpdate = await this.userVerifyRepository
        .createQueryBuilder('uv')
        .where('uv.uv_user_id = :userId', { userId })
        .andWhere(
          '(uv.uv_status = :retry OR (uv.uv_status = :pending AND uv.uv_paper_image IS NOT NULL))',
          {
            retry: UserVerifyStatus.RETRY,
            pending: UserVerifyStatus.PENDING,
          },
        )
        .getMany();

      if (verificationsToUpdate.length === 0) {
        throw new BadRequestException(
          'No verification records ready for review (pending with paper proof, or retry).',
        );
      }

      if (updateKycStatusDto.status === 'retry') {
        // If status = retry, message is required
        if (
          !updateKycStatusDto.message ||
          updateKycStatusDto.message.trim() === ''
        ) {
          throw new BadRequestException(
            'Message is required when status is retry',
          );
        }

        // Update all verification records to retry
        for (const verification of verificationsToUpdate) {
          verification.uv_status = UserVerifyStatus.RETRY;
          await this.userVerifyRepository.save(verification);

          // Create verify_log with message
          await this.verifyLogRepository.save({
            vl_verify_id: verification.uv_id,
            vl_admin_id: adminId,
            vl_note: updateKycStatusDto.message.trim(),
          });
        }

        return {
          statusCode: 200,
          message: 'KYC status updated to retry successfully',
        };
      } else if (updateKycStatusDto.status === 'verify') {
        // If status = verify, no message needed
        // Update all verification records to verify
        for (const verification of verificationsToUpdate) {
          verification.uv_status = UserVerifyStatus.VERIFY;
          await this.userVerifyRepository.save(verification);
        }

        // Update uverify to true
        user.uverify = true;
        await this.userRepository.save(user);

        return {
          statusCode: 200,
          message: 'KYC status updated to verify successfully',
        };
      }
    }

    // Should not reach here
    throw new BadRequestException('Invalid status update');
  }
}
