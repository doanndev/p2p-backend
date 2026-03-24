import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'john_doe', description: 'Username đăng nhập' })
  uname: string;

  @ApiProperty({ example: 'john@example.com', description: 'Email người dùng' })
  email: string;

  @ApiPropertyOptional({ example: '+84901234567', description: 'Số điện thoại' })
  phone?: string;

  @ApiProperty({ example: 'StrongPassword@123', description: 'Mật khẩu tài khoản' })
  password: string;

  @ApiProperty({ example: 'John Doe', description: 'Tên hiển thị' })
  displayName: string;

  @ApiPropertyOptional({ example: 'REF2026', description: 'Mã giới thiệu' })
  refCode?: string;
}
