import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ReviewBankChangeRequestDto {
  @ApiProperty({
    example: true,
    description:
      'true = approve and update bank for orderbook, false = reject request',
  })
  @IsBoolean()
  approve: boolean;
}
