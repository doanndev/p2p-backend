import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateOrderbookDto {
  @ApiProperty({ example: 2.15, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0.00000001)
  price?: number;

  @ApiProperty({ example: 1000000, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  nationalMin?: number | null;

  @ApiProperty({ example: 10000000, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  nationalMax?: number | null;
}
