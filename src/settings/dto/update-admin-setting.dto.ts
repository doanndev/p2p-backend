import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateAdminSettingDto {
  @ApiProperty({
    example: 'withdraw.turn_free',
    description: 'Admin setting key',
  })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({
    example: 5,
    description: 'Admin setting value (string/number/boolean/object)',
  })
  value: string | number | boolean | Record<string, unknown> | null;
}
