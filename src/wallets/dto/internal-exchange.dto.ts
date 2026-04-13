import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class InternalExchangeDto {
  @ApiProperty({
    example: 42,
    description: 'User ID (uid) người nhận token trên sàn',
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  recipientUserId: number;

  @ApiProperty({
    example: 2,
    description: 'ID coin (coins.coin_id)',
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coinId: number;

  @ApiProperty({
    example: 10.5,
    description: 'Số lượng chuyển (cùng quy tắc phí / max như rút on-chain)',
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.00000001)
  amount: number;

  @ApiProperty({
    example: 'A1B2C3',
    description:
      'Mã xác minh email (6 ký tự). Lấy qua `POST /wallets/exchange/internal/verify-code` — email dùng template Verify Email Code.',
  })
  @IsString()
  @Length(6, 6)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{6}$/, {
    message: 'emailCode must be 6 uppercase letters/numbers',
  })
  emailCode: string;

  @ApiPropertyOptional({
    example: '123456',
    description:
      'Mã TOTP 6 chữ số khi user đã bật 2FA (`GET /users/security/2fa/status`).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'twoFactorCode must be a 6-digit TOTP' })
  twoFactorCode?: string;
}
