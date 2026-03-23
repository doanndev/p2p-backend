import { IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum UpdateKolStatus {
  SUCCESS = 'success',
  FAIL = 'fail',
}

export class UpdateKolDto {
  @ApiPropertyOptional({ enum: UpdateKolStatus, example: UpdateKolStatus.SUCCESS, description: 'Kết quả duyệt hồ sơ KOL' })
  @IsOptional()
  @IsEnum(UpdateKolStatus, {
    message: 'Status must be either "success" or "fail"',
  })
  status?: UpdateKolStatus;
}

