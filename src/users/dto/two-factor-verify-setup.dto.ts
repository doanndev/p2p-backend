import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class TwoFactorVerifySetupDto {
  @ApiProperty({
    example: '123456',
    description: 'Mã 6 số từ Google Authenticator để xác nhận bật 2FA',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit TOTP' })
  code: string;
}
