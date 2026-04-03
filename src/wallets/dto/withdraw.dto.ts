import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WithdrawDto {
  @ApiProperty({
    example: 1,
    description: 'ID mạng (networks.net_id)',
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  networkId: number;

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
    example: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    description: 'Địa chỉ ví nhận',
  })
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  address: string;

  @ApiProperty({
    example: 10.5,
    description: 'Số lượng coin rút, tối thiểu 0.00000001',
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.00000001)
  amount: number;

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
