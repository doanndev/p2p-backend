import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class TransactionHistoryDto {
  @ApiPropertyOptional({ example: 'USDT', description: 'Lọc theo coin id hoặc symbol' })
  @IsOptional()
  @IsString()
  coin?: string; // coin_id hoặc coin_symbol

  @ApiPropertyOptional({ example: 'BSC', description: 'Lọc theo network id hoặc symbol' })
  @IsOptional()
  @IsString()
  network?: string; // network_id hoặc network_symbol

  @ApiPropertyOptional({ enum: ['withdraw', 'deposit'], example: 'withdraw', description: 'Lọc theo loại giao dịch' })
  @IsOptional()
  @IsString()
  @IsIn(['withdraw', 'deposit'])
  type?: 'withdraw' | 'deposit'; // withdraw hoặc deposit, nếu trống thì lấy cả hai
}

