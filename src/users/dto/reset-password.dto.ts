import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'Email để nhận mã đặt lại mật khẩu',
  })
  email: string;
}
