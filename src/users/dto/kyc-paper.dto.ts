import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl } from 'class-validator';

export class KycPaperDto {
  @ApiProperty({
    example:
      'https://res.cloudinary.com/demo/video/upload/v1234567890/kyc/paper_video.mp4',
    description: 'URL video cầm giấy',
  })
  @IsString()
  @IsUrl({ require_protocol: true })
  paperVideoUrl: string;
}
