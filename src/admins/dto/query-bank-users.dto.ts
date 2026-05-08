import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryBankUsersDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Trang (mặc định 1)',
  })
  @IsOptional()
  @Transform(({ value }) => {
    const parsed = Number(value);
    return isNaN(parsed) ? 1 : parsed;
  })
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    description: 'Số lượng item mỗi trang (mặc định 20, tối đa 100)',
  })
  @IsOptional()
  @Transform(({ value }) => {
    const parsed = Number(value);
    return isNaN(parsed) ? 20 : parsed;
  })
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    example: 'john_doe',
    description: 'Tìm kiếm theo username hoặc full name',
  })
  @IsOptional()
  @IsString()
  userName?: string;

  @ApiPropertyOptional({
    example: 'Agribank',
    description: 'Tìm kiếm theo tên ngân hàng',
  })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({
    example: '1234567890',
    description: 'Tìm kiếm theo số tài khoản ngân hàng',
  })
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional({
    example: 'Nguyễn Văn A',
    description: 'Tìm kiếm theo tên chủ tài khoản',
  })
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @ApiPropertyOptional({
    example: 'created_at',
    enum: ['created_at', 'username', 'bank_name'],
    description: 'Cột sắp xếp',
  })
  @IsOptional()
  @IsString()
  sortBy?: 'created_at' | 'username' | 'bank_name' = 'created_at';

  @ApiPropertyOptional({
    example: 'DESC',
    enum: ['ASC', 'DESC'],
    description: 'Hướng sắp xếp',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
