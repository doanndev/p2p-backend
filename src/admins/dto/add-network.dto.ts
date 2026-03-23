import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddNetworkDto {
  @ApiProperty({ example: 'Binance Smart Chain', description: 'Tên network' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'BSC', description: 'Ký hiệu network' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  symbol: string;

  @ApiProperty({ example: 'https://cdn.example.com/networks/bsc.png', description: 'Logo network' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  logo: string;

  @ApiProperty({ example: 'https://bscscan.com', description: 'Link explorer của network' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  scan: string;
}

