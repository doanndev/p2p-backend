import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl } from 'class-validator';

export class KycPaperDto {
  @ApiProperty({
    example:
      'https://res.cloudinary.com/demo/image/upload/v1234567890/kyc/paper_proof.jpg',
    description: 'URL ảnh cầm giấy challenge',
  })
  @IsString()
  @IsUrl({ require_protocol: true })
  paperImageUrl: string;
}
