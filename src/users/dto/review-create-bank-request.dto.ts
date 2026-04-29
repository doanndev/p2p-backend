import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ReviewCreateBankRequestDto {
  @ApiProperty({
    example: true,
    description: 'true = approve and create bank, false = reject request',
  })
  @IsBoolean()
  approve: boolean;
}
