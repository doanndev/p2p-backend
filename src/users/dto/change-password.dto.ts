import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPassword@123', description: 'Mật khẩu hiện tại' })
  currentPassword: string;

  @ApiProperty({ example: 'NewPassword@123', description: 'Mật khẩu mới' })
  newPassword: string;
}

