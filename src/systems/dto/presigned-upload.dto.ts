import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class PresignedUploadDto {
  @ApiProperty({ example: 'avatar.png' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ example: 1048576 })
  @IsInt()
  @Min(1)
  file_size_bytes: number;

  @ApiProperty({ example: 'uploads' })
  @IsString()
  @MaxLength(255)
  folder: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @MaxLength(100)
  content_type: string;
}
