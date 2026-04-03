import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPassword@123', description: 'Mật khẩu hiện tại' })
  @IsNotEmpty()
  @IsString()
  currentPassword: string;

  @ApiProperty({ example: 'NewPassword@123', description: 'Mật khẩu mới' })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  newPassword: string;

  @ApiPropertyOptional({
    example: '123456',
    description: 'Bắt buộc khi tài khoản đã bật 2FA (Google Authenticator).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'twoFactorCode must be a 6-digit TOTP' })
  twoFactorCode?: string;
}
