import { ApiProperty } from '@nestjs/swagger';

export class KycDto {
  @ApiProperty({ example: '079123456789', description: 'Số CCCD/CMND' })
  idCardNumber: string;
}

