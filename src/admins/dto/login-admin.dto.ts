import { ApiProperty } from '@nestjs/swagger';

export class LoginAdminDto {
  @ApiProperty({
    example: 'admin@example.com',
    description: 'Email đăng nhập admin',
  })
  email: string;

  @ApiProperty({
    example: 'AdminStrongPassword@123',
    description: 'Mật khẩu admin',
  })
  password: string;
}
