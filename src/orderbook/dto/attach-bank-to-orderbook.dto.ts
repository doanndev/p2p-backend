import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class AttachBankToOrderbookDto {
  @ApiProperty({ example: 1, description: 'BankUser ID' })
  @IsInt()
  @Min(1)
  bankUserId: number;
}
