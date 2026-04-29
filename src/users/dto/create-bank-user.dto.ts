import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBankUserDto {
  @ApiProperty({ example: 'Vietcombank' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  bankName: string;

  @ApiPropertyOptional({ example: 'Hà Nội' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankBranch?: string | null;

  @ApiProperty({ example: '0123456789' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  bankAccountNumber: string;
}
