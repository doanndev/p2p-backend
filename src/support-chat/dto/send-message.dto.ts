import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'supportChatTextOrImageUrl', async: false })
class SupportChatTextOrImageUrlConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const o = args.object as SendMessageDto;
    const text = (o.content ?? '').trim();
    const img = (o.imageUrl ?? '').trim();
    if (text && img) {
      return false;
    }
    if (!text && !img) {
      return false;
    }
    return true;
  }

  defaultMessage() {
    return 'Provide exactly one of: content (text) or imageUrl (http/https URL)';
  }
}

export class SendMessageDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Validate(SupportChatTextOrImageUrlConstraint)
  conversationId: number;

  @ApiPropertyOptional({
    description: 'Nội dung text (không gửi cùng imageUrl trong một tin)',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({
    description:
      'URL ảnh (http/https). Lưu vào DB với message_type=image, content = URL.',
    maxLength: 2048,
  })
  @IsOptional()
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: 'imageUrl must be a valid http(s) URL' },
  )
  @MaxLength(2048)
  imageUrl?: string;
}
