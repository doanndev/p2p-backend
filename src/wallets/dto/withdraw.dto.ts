import { IsNotEmpty, IsString, IsNumber, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class WithdrawDto {
  @ApiProperty({ example: 'BSC', description: 'Mạng rút tiền (network id hoặc symbol)' })
  @IsNotEmpty()
  @IsString()
  network: string; // net_id hoặc net_symbol

  @ApiProperty({ example: 'USDT', description: 'Coin rút (coin id hoặc symbol)' })
  @IsNotEmpty()
  @IsString()
  coin: string; // coin_id hoặc coin_symbol

  @ApiProperty({ example: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', description: 'Địa chỉ ví nhận' })
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  address: string; // Địa chỉ ví nhận (đã được trim để loại bỏ khoảng trắng)

  @ApiProperty({ example: 10.5, description: 'Số lượng coin rút, tối thiểu 0.00000001' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.00000001)
  amount: number; // Số lượng coin cần chuyển
}

