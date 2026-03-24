import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { TransactionStatus } from '../entities/transaction.entity';

export class QueryTransactionsDto {
  @ApiProperty({ required: false, enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;
}
