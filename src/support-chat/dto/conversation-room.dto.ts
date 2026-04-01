import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ConversationRoomDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  conversationId: number;
}
