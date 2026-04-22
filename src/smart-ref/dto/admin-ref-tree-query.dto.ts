import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class AdminRefTreeQueryDto {
  @ApiProperty({
    example: 123,
    description: 'Root user id to inspect downline tree',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId: number;

  @ApiProperty({
    example: 5,
    required: false,
    description: 'Max tree depth from root (default 5, max 10)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxDepth?: number = 5;
}
