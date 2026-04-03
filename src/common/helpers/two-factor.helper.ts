import { BadRequestException } from '@nestjs/common';
import { verifySync } from 'otplib';
import { User } from '../../users/entities/user.entity';

export function isValidTotpTokenFormat(token: string | undefined): boolean {
  const t = token?.trim() ?? '';
  return /^\d{6}$/.test(t);
}

export function verifyUserTotp(secret: string, token: string): boolean {
  const trimmed = token.trim();
  if (!isValidTotpTokenFormat(trimmed)) {
    return false;
  }
  const result = verifySync({ secret, token: trimmed });
  return result.valid === true;
}

/**
 * Nếu user đã bật 2FA thì bắt buộc mã TOTP hợp lệ; nếu chưa bật thì bỏ qua.
 */
export function requireTotpIfEnabled(
  user: Pick<User, 'u_active_ggauth' | 'uggauth'>,
  twoFactorCode: string | undefined,
): void {
  if (!user.u_active_ggauth) {
    return;
  }
  if (!user.uggauth) {
    throw new BadRequestException(
      'Two-factor authentication is enabled but secret is missing; contact support',
    );
  }
  const code = twoFactorCode?.trim();
  if (!code) {
    throw new BadRequestException(
      'Two-factor authentication code is required for this action',
    );
  }
  if (!verifyUserTotp(user.uggauth, code)) {
    throw new BadRequestException('Invalid two-factor authentication code');
  }
}
