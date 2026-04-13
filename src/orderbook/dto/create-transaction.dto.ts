import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { TransactionType } from '../entities/transaction.entity';

export class CreateTransactionDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  orderBookId: number;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(0.00000001)
  amount: number;

  @ApiProperty({ enum: TransactionType, example: TransactionType.BANKING })
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiPropertyOptional({
    example: 10,
    description:
      'Bank user id. Bắt buộc khi tạo transaction với orderbook option=buy.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  buId?: number;
}
