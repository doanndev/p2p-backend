import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min, ValidateIf } from 'class-validator';

export class UpdateOrderbookDto {
  @ApiProperty({ example: 2.15, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0.00000001)
  price?: number;

  @ApiProperty({
    example: 10,
    required: false,
    nullable: true,
    description:
      'Số coin tối thiểu mỗi giao dịch; null để xóa (fallback min 10 khi tạo transaction).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  @Min(0.00000001)
  nationalMin?: number | null;

  @ApiProperty({
    example: 500,
    required: false,
    nullable: true,
    description: 'Số coin tối đa mỗi giao dịch; null để xóa.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  @Min(0.00000001)
  nationalMax?: number | null;
}
