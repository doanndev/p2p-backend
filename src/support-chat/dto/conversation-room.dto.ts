import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ConversationRoomDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversationId: number;

  /** Admin: join/leave room không tạo system event (dùng khi xem chat, tránh spam). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  silent?: boolean;
}
