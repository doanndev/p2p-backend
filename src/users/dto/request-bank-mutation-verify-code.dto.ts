import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestBankMutationVerifyCodeDto {
  @ApiPropertyOptional({
    example: 'Update bank account #3',
    description: 'Optional context for audit/logging purposes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  context?: string;
}
