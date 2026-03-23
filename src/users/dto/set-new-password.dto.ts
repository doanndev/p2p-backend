import { ApiProperty } from '@nestjs/swagger';

export class SetNewPasswordDto {
  @ApiProperty({ example: '123456', description: 'Mã xác thực reset mật khẩu' })
  code: string;

  @ApiProperty({ example: 'NewStrongPassword@123', description: 'Mật khẩu mới' })
  password: string;
}

