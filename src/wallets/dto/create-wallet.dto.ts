import { IsNotEmpty, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWalletDto {
  @ApiProperty({ example: 1, description: 'ID network cần tạo ví' })
  @IsNotEmpty()
  @IsNumber()
  networkId: number;
}

