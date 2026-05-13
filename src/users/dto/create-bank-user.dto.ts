import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateBankUserDto {
  @ApiProperty({ example: 'Vietcombank' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  bankName: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/passbook.jpg',
    description: 'URL ảnh sổ tài khoản (passbook), bắt buộc khi tạo bank',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  passbookImageUrl: string;

  @ApiProperty({ example: '0123456789' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  bankAccountNumber: string;
}
