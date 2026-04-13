import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class BankMutationSecurityDto {
  @ApiProperty({
    example: 'A1B2C3',
    description: 'Email verification code sent for bank update/delete action.',
  })
  @IsString()
  @Length(6, 6)
  @Matches(/^[A-Z0-9]{6}$/, {
    message: 'emailCode must be 6 uppercase letters/numbers',
  })
  emailCode: string;

  @ApiPropertyOptional({
    example: '123456',
    description: 'Required only when 2FA is enabled.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'twoFactorCode must be 6 digits' })
  twoFactorCode?: string;
}
