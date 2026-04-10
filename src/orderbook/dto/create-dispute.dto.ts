import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DisputeType } from '../entities/dispute.entity';

export class CreateDisputeDto {
  @ApiProperty({
    enum: DisputeType,
    example: DisputeType.PAYMENT_NOT_RECEIVED,
  })
  @IsEnum(DisputeType)
  type: DisputeType;

  @ApiProperty({
    example: 'I sent money but seller says not received.',
  })
  @IsString()
  @MaxLength(5000)
  reason: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/evidence/payment-proof-123.png',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  evidence?: string;
}
