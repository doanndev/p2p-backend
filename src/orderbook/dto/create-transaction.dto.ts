import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, Min } from 'class-validator';
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
}
