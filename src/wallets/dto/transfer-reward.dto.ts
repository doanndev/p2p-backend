import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class TransferRewardDto {
  @ApiPropertyOptional({
    example: '123456',
    description:
      'Bắt buộc khi tài khoản đã bật 2FA (Google Authenticator).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'twoFactorCode must be a 6-digit TOTP' })
  twoFactorCode?: string;
}
