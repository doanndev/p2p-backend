import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  @Type(() => Number)
  @IsInt()
  coinId: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  nationalCurrencyId: number;

  @ApiProperty({ enum: OrderBookOption, example: OrderBookOption.SELL })
  @IsEnum(OrderBookOption)
  option: OrderBookOption;

  @ApiProperty({ example: 100.5 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.00000001)
  amount: number;

  @ApiProperty({ example: 2.15 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.00000001)
  price: number;

  @ApiProperty({ example: 1000000, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nationalMin?: number;

  @ApiProperty({ example: 10000000, required: false })
  @IsOptional()
  @Type(() => Number)
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

  @ApiProperty({
    example: 1,
    required: false,
    description:
      'Bank user id. Bắt buộc khi option=sell; không dùng khi option=buy.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  buId?: number;
}
