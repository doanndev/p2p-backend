import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SearchWalletDto {
  @ApiProperty({
    example: '0x742d35',
    description: 'Từ khóa tìm ví: địa chỉ/public key/user id',
  })
  @IsString()
  @IsNotEmpty()
  q: string;
}
