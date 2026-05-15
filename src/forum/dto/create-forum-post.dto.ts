import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ForumPostStatus } from '../entities/forum-post.entity';

export class CreateForumPostDto {
  @ApiProperty({ example: 'Scheduled maintenance — Jan 15' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'Full announcement body...' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({
    enum: ForumPostStatus,
    default: ForumPostStatus.DRAFT,
    description:
      'DRAFT: hidden from users; PUBLISHED: visible and triggers user notifications',
  })
  @IsOptional()
  @IsEnum(ForumPostStatus)
  status?: ForumPostStatus;
}
