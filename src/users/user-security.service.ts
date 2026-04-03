import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { User } from './entities/user.entity';
import { verifyUserTotp } from '../common/helpers/two-factor.helper';

@Injectable()
export class UserSecurityService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  private issuer(): string {
    return (
      this.configService.get<string>('APP_NAME') ||
      this.configService.get<string>('app.name') ||
      'App'
    );
  }

  async getTwoFactorStatus(userId: number): Promise<{
    enabled: boolean;
    pendingSetup: boolean;
  }> {
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      select: ['uid', 'u_active_ggauth', 'uggauth'],
    });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return {
      enabled: user.u_active_ggauth === true,
      pendingSetup: !user.u_active_ggauth && !!user.uggauth,
    };
  }

  /**
   * Tạo secret mới (ghi đè nếu đang pending), chưa bật 2FA cho đến verify-setup.
   */
  async setupTwoFactor(userId: number): Promise<{
    otpauthUrl: string;
    qrCodeDataUrl: string;
    manualEntryKey: string;
  }> {
    const user = await this.userRepository.findOne({ where: { uid: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.u_active_ggauth) {
      throw new ConflictException(
        'Two-factor authentication is already enabled. Disable it before setting up again.',
      );
    }

    const secret = generateSecret();
    const issuer = this.issuer();
    const label = user.uemail || user.uname || String(user.uid);
    const otpauthUrl = generateURI({
      issuer,
      label,
      secret,
    });

    user.uggauth = secret;
    user.u_active_ggauth = false;
    await this.userRepository.save(user);

    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
    });

    return {
      otpauthUrl,
      qrCodeDataUrl,
      manualEntryKey: secret,
    };
  }

  async verifyTwoFactorSetup(
    userId: number,
    code: string,
  ): Promise<{ statusCode: number; message: string }> {
    const user = await this.userRepository.findOne({ where: { uid: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.u_active_ggauth) {
      throw new ConflictException(
        'Two-factor authentication is already enabled',
      );
    }
    if (!user.uggauth) {
      throw new BadRequestException(
        'No pending setup. Call POST /users/security/2fa/setup first.',
      );
    }
    const trimmed = code.trim();
    const result = verifySync({ secret: user.uggauth, token: trimmed });
    if (!result.valid) {
      throw new BadRequestException('Invalid verification code');
    }

    user.u_active_ggauth = true;
    await this.userRepository.save(user);

    return {
      statusCode: 200,
      message: 'Two-factor authentication enabled successfully',
    };
  }

  async disableTwoFactor(
    userId: number,
    password: string,
    code: string | undefined,
  ): Promise<{ statusCode: number; message: string }> {
    const user = await this.userRepository.findOne({ where: { uid: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const okPassword = await bcrypt.compare(password, user.upassword);
    if (!okPassword) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (user.u_active_ggauth) {
      if (!user.uggauth) {
        throw new BadRequestException(
          'Two-factor is enabled but secret is missing; contact support',
        );
      }
      const c = code?.trim();
      if (!c) {
        throw new BadRequestException(
          'Two-factor authentication code is required to disable 2FA',
        );
      }
      if (!verifyUserTotp(user.uggauth, c)) {
        throw new BadRequestException('Invalid two-factor authentication code');
      }
    } else if (user.uggauth) {
      // Hủy pending setup: chỉ cần mật khẩu
    } else {
      throw new BadRequestException(
        'Two-factor authentication is not configured',
      );
    }

    user.uggauth = null;
    user.u_active_ggauth = false;
    await this.userRepository.save(user);

    return {
      statusCode: 200,
      message: 'Two-factor authentication disabled successfully',
    };
  }
}
