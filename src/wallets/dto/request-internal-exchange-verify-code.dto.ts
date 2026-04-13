import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestInternalExchangeVerifyCodeDto {
  @ApiPropertyOptional({
    example: 'Internal transfer to user 42',
    description: 'Tuỳ chọn — ghi chú / audit phía client.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  context?: string;
}
