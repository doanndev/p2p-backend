import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import {
  OrderBookOption,
  OrderBookStatus,
} from '../entities/order-book.entity';
import { OrderBookTradeMode } from '../entities/order-book-trade-mode';
import {
  TransactionOption,
  TransactionStatus,
} from '../entities/transaction.entity';

export enum AmountSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class QueryOrderbooksDto {
  @ApiPropertyOptional({
    description: 'Trang hiện tại',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (max 100)',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Lọc từ ngày (ISO 8601), theo thời điểm tạo orderbook',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Lọc đến ngày (ISO 8601)',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    enum: AmountSortOrder,
    description:
      'Sắp xếp theo amount (chủ yếu dùng cho API my orderbooks; API public tự sort theo option/price).',
  })
  @IsOptional()
  @IsEnum(AmountSortOrder)
  sortAmount?: AmountSortOrder;

  @ApiPropertyOptional({ enum: OrderBookOption })
  @IsOptional()
  @IsEnum(OrderBookOption)
  option?: OrderBookOption;

  @ApiPropertyOptional({
    description: 'Số coin tối thiểu theo amount_remaining',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountMin?: number;

  @ApiPropertyOptional({
    description: 'Số coin tối đa theo amount_remaining',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountMax?: number;

  @ApiPropertyOptional({
    description: 'Số dư còn lại tối thiểu (amount_remaining)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountRemainingMin?: number;

  @ApiPropertyOptional({
    description: 'Số dư còn lại tối đa (amount_remaining)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountRemainingMax?: number;

  @ApiPropertyOptional({ description: 'Lọc theo coin id' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  coinId?: number;

  @ApiPropertyOptional({ description: 'Lọc theo national currency id' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  nationalCurrencyId?: number;

  @ApiPropertyOptional({
    enum: OrderBookTradeMode,
    description: 'Lọc theo chế độ giao dịch (fast / safe)',
  })
  @IsOptional()
  @IsEnum(OrderBookTradeMode)
  tradeMode?: OrderBookTradeMode;
}

export class QueryMyOrderbooksDto extends QueryOrderbooksDto {
  @ApiPropertyOptional({
    enum: OrderBookStatus,
    description: 'Lọc theo trạng thái orderbook (mặc định: tất cả)',
  })
  @IsOptional()
  @IsEnum(OrderBookStatus)
  status?: OrderBookStatus;
}

export class QueryTransactionsDto {
  @ApiPropertyOptional({
    description: 'Trang hiện tại',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (max 100)',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({
    description: 'Lọc từ ngày (ISO 8601), theo thời điểm tạo transaction',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Lọc đến ngày (ISO 8601)',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    enum: AmountSortOrder,
    description: 'Sắp xếp theo amount',
  })
  @IsOptional()
  @IsEnum(AmountSortOrder)
  sortAmount?: AmountSortOrder;

  @ApiPropertyOptional({ enum: TransactionOption })
  @IsOptional()
  @IsEnum(TransactionOption)
  option?: TransactionOption;

  @ApiPropertyOptional({ description: 'Số coin tối thiểu (trans_amount)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountMin?: number;

  @ApiPropertyOptional({ description: 'Số coin tối đa (trans_amount)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountMax?: number;

  @ApiPropertyOptional({ description: 'Lọc theo coin id' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  coinId?: number;

  @ApiPropertyOptional({ description: 'Lọc theo national currency id' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  nationalCurrencyId?: number;
}
