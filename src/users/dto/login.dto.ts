import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'john@example.com', description: 'Email đăng nhập' })
  email: string;

  @ApiProperty({
    example: 'StrongPassword@123',
    description: 'Mật khẩu đăng nhập',
  })
  password: string;
}
