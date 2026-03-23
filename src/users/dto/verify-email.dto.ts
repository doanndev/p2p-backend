import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ example: '123456', description: 'Mã OTP xác thực email' })
  code: string;
}

