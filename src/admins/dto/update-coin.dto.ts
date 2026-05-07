import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCoinDto {
  @ApiPropertyOptional({ example: 'Tether USD', description: 'Tên coin mới' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/coins/usdt-new.png',
    description: 'Logo coin mới',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  logo?: string;

  @ApiPropertyOptional({
    example: 'https://tether.to',
    description: 'Website mới',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  website?: string;
}
