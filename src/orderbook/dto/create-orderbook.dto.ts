import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { OrderBookOption } from '../entities/order-book.entity';
import { OrderBookTradeMode } from '../entities/order-book-trade-mode';

export class CreateOrderbookDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  coinId: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  nationalCurrencyId: number;

  @ApiProperty({ enum: OrderBookOption, example: OrderBookOption.SELL })
  @IsEnum(OrderBookOption)
  option: OrderBookOption;

  @ApiProperty({ example: 100.5 })
  @IsNumber()
  @Min(0.00000001)
  amount: number;

  @ApiProperty({ example: 2.15 })
  @IsNumber()
  @Min(0.00000001)
  price: number;

  @ApiProperty({ example: 1000000, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  nationalMin?: number;

  @ApiProperty({ example: 10000000, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  nationalMax?: number;

  @ApiProperty({ example: 'USDT' })
  @IsNotEmpty()
  @IsString()
  coinSymbol: string;

  @ApiProperty({ example: 'VND' })
  @IsNotEmpty()
  @IsString()
  nationalSymbol: string;

  @ApiProperty({
    enum: OrderBookTradeMode,
    required: false,
    description: 'fast = khóa coin theo level buyer khi hoàn tất; safe = khóa 24h',
  })
  @IsOptional()
  @IsEnum(OrderBookTradeMode)
  tradeMode?: OrderBookTradeMode;
}
