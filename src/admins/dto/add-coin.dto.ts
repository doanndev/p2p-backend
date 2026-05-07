import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddCoinDto {
  @ApiProperty({ example: 'Tether USD', description: 'Tên coin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'USDT', description: 'Ký hiệu coin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  symbol: string;

  @ApiProperty({
    example: 'https://cdn.example.com/coins/usdt.png',
    description: 'Link logo coin',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  logo: string;

  @ApiPropertyOptional({
    example: 'https://tether.to',
    description: 'Website chính thức',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  website?: string;
}
