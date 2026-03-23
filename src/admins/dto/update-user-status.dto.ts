import { IsEnum } from 'class-validator';
import { UserStatus } from '../../users/entities/user.entity';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserStatusDto {
  @ApiProperty({ enum: ['active', 'block_withdraw', 'block'], example: 'active', description: 'Trạng thái tài khoản user' })
  @IsEnum(UserStatus, {
    message: 'Status must be one of: active, block_withdraw, block',
  })
  status: UserStatus;
}

