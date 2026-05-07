import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateNetworkDto {
  @ApiPropertyOptional({
    example: 'Binance Smart Chain Mainnet',
    description: 'Tên network mới',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/networks/bsc-v2.png',
    description: 'Logo network mới',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  logo?: string;

  @ApiPropertyOptional({
    example: 'https://bscscan.com',
    description: 'Link explorer mới',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  scan?: string;
}
