import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPassword@123', description: 'Mật khẩu hiện tại' })
  current_password: string;

  @ApiProperty({ example: 'NewPassword@123', description: 'Mật khẩu mới' })
  new_password: string;
}

