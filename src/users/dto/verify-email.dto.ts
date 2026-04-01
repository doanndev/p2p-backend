import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ example: 'ABCDEF', description: 'Mã OTP xác thực email' })
  code: string;
}
