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
import { Type } from 'class-transformer';

@ValidatorConstraint({ name: 'transactionChatTextOrImageUrl', async: false })
class TransactionChatTextOrImageUrlConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const o = args.object as SendTransactionChatMessageDto;
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

export class SendTransactionChatMessageDto {
  @ApiProperty({ example: 123 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Validate(TransactionChatTextOrImageUrlConstraint)
  transaction_id: number;

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
      'URL ảnh (http/https). Lưu message_type=image, message_content = URL (giống support chat).',
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
