import { ApiPropertyOptional } from '@nestjs/swagger';

export class VideoSettingsDto {
  @ApiPropertyOptional({ example: 3, description: 'Số lượt video mặc định/ngày' })
  turn_default?: number;

  @ApiPropertyOptional({ example: 2, description: 'Số thiết bị mặc định được phép' })
  devices_default?: number;

  @ApiPropertyOptional({ example: 30, description: 'Khoảng cách thời gian giữa các lượt (phút)' })
  time_gap?: number;
}

