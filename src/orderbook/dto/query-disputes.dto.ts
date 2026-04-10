import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { DisputeStatus } from '../entities/dispute.entity';

export class QueryDisputesDto {
  @ApiPropertyOptional({
    enum: DisputeStatus,
    example: DisputeStatus.OPEN,
  })
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;
}
