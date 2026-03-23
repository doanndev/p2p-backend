import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum UpdateKycStatus {
  VERIFY = 'verify',
  RETRY = 'retry',
}

export class UpdateKycStatusDto {
  @ApiProperty({ enum: UpdateKycStatus, example: UpdateKycStatus.VERIFY, description: 'Kết quả xử lý KYC' })
  @IsNotEmpty()
  @IsEnum(UpdateKycStatus)
  status: UpdateKycStatus;

  @ApiPropertyOptional({ example: 'Ảnh CCCD mờ, vui lòng chụp lại rõ nét', description: 'Lý do yêu cầu gửi lại (bắt buộc khi status=retry)' })
  @ValidateIf((o) => o.status === UpdateKycStatus.RETRY)
  @IsNotEmpty()
  @IsString()
  message?: string;
}

