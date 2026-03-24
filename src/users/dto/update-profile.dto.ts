import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Developer', description: 'Tên hiển thị mới' })
  displayName?: string;

  @ApiPropertyOptional({ example: '1998-12-31', description: 'Ngày sinh theo định dạng YYYY-MM-DD' })
  birthday?: string;

  @ApiPropertyOptional({ enum: ['man', 'woman', 'other'], example: 'man', description: 'Giới tính' })
  sex?: 'man' | 'woman' | 'other';
}

