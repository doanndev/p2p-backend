import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class SendMessageDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversationId: number;

  @ApiProperty()
  @IsString()
  @MaxLength(5000)
  content: string;
}
