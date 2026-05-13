import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateBankUserDto {
  @ApiPropertyOptional({ example: 'Vietcombank' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankName?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/passbook.jpg',
    description: 'URL ảnh sổ tài khoản (passbook)',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  passbookImageUrl?: string;

  @ApiPropertyOptional({ example: '0123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankAccountNumber?: string;
}
