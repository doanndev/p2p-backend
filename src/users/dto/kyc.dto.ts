import { ApiProperty } from '@nestjs/swagger';

export class KycDto {
  @ApiProperty({ example: '079123456789', description: 'Số CCCD/CMND' })
  id_card_number: string;
}

