import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class TransferRewardDto {
  @ApiPropertyOptional({
    example: '123456',
    description:
      'Mã TOTP 6 chữ số. **Bắt buộc** khi user đã bật 2FA; khi chưa bật có thể gửi body `{}`.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'twoFactorCode must be a 6-digit TOTP' })
  twoFactorCode?: string;
}
