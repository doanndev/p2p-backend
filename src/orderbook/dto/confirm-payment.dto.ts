import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class ConfirmPaymentDto {
  @ApiProperty({
    type: [String],
    maxItems: 5,
    example: ['https://cdn.example.com/proof/transfer-1.jpg'],
    description:
      'Danh sách URL ảnh chứng từ chuyển khoản (tối đa 5, hiển thị cho người bán).',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one proof URL is required' })
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  @IsUrl(
    { require_protocol: true },
    { each: true, message: 'Each proof must be a valid URL with protocol' },
  )
  proofUrls: string[];
}
