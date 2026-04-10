import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength } from 'class-validator';

export class KycDto {
  @ApiProperty({ example: '079123456789', description: 'Số CCCD/CMND' })
  @IsString()
  @MaxLength(50)
  idCardNumber: string;

  @ApiProperty({
    example:
      'https://res.cloudinary.com/demo/image/upload/v1234567890/kyc/front_abc.jpg',
    description: 'URL ảnh CCCD mặt trước',
  })
  @IsString()
  @IsUrl({ require_protocol: true })
  frontImageUrl: string;

  @ApiProperty({
    example:
      'https://res.cloudinary.com/demo/image/upload/v1234567890/kyc/back_xyz.jpg',
    description: 'URL ảnh CCCD mặt sau',
  })
  @IsString()
  @IsUrl({ require_protocol: true })
  backsideImageUrl: string;
}
