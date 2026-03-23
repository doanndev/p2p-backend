import { ApiPropertyOptional } from '@nestjs/swagger';

export class WithdrawSettingsDto {
  @ApiPropertyOptional({ example: 2, description: 'Số lượt rút miễn phí mỗi ngày' })
  turn_free?: number;
}

