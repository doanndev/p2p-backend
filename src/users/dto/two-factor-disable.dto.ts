import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class TwoFactorDisableDto {
  @ApiProperty({
    example: 'CurrentPassword@123',
    description: 'Mật khẩu đăng nhập hiện tại (dùng để xác nhận chủ tài khoản)',
  })
  @IsNotEmpty()
  @IsString()
  password: string;

  @ApiPropertyOptional({
    example: '123456',
    description:
      'Bắt buộc khi 2FA đã bật. Bỏ qua khi chỉ hủy setup đang chờ (chưa verify).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit TOTP' })
  code?: string;
}
