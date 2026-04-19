import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';

export class SmartRefWithdrawDto {
  @ApiProperty({ example: 1, description: 'Network ID dùng để chuyển USDT' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  networkId: number;

  @ApiProperty({
    example: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    description: 'Địa chỉ ví nhận reward',
  })
  @IsString()
  address: string;
}
