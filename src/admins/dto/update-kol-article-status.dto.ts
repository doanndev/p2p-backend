import { IsEnum } from 'class-validator';
import { KolArticleStatus } from '../../users/entities/kol-article.entity';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateKolArticleStatusDto {
  @ApiProperty({
    enum: ['pending', 'approved', 'rejected'],
    example: 'approved',
    description: 'Trạng thái duyệt bài viết KOL',
  })
  @IsEnum(KolArticleStatus, {
    message: 'Status must be one of: pending, approved, rejected',
  })
  status: KolArticleStatus;
}
