import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class CreateConversationDto {
  @ApiPropertyOptional({
    description:
      'Khi gọi bằng admin: bắt buộc — `uid` user sẽ sở hữu conversation. Khi gọi bằng user: không dùng (hoặc phải trùng với chính mình).',
    example: 1001,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;
}
