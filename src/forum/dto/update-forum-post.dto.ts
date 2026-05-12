import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ForumPostStatus } from '../entities/forum-post.entity';

export class UpdateForumPostDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ enum: ForumPostStatus })
  @IsOptional()
  @IsEnum(ForumPostStatus)
  status?: ForumPostStatus;

  @ApiPropertyOptional({
    description: 'If true, clear soft-delete (restore a deleted post)',
  })
  @IsOptional()
  @IsBoolean()
  restore?: boolean;
}
