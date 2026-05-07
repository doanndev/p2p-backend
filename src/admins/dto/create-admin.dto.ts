import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAdminDto {
  @ApiProperty({ example: 'admin_ops', description: 'Username admin' })
  @IsNotEmpty({ message: 'username is required' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  username: string;

  @ApiProperty({ example: 'ops@example.com', description: 'Email admin' })
  @IsNotEmpty({ message: 'email is required' })
  @IsEmail()
  @MaxLength(100)
  email: string;

  @ApiPropertyOptional({
    example: 'Operations Team',
    description: 'Tên hiển thị đầy đủ',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullname?: string;

  @ApiProperty({
    example: 'AdminPassword@123',
    description: 'Mật khẩu admin mới',
  })
  @IsNotEmpty({ message: 'password is required' })
  @IsString()
  @MinLength(6, { message: 'password must be at least 6 characters' })
  @MaxLength(100)
  password: string;

  @ApiProperty({
    enum: ['moderator', 'admin', 'support'],
    example: 'support',
    description: 'Phân quyền tài khoản admin',
  })
  @IsNotEmpty({ message: 'level is required' })
  @IsString()
  @IsIn(['moderator', 'admin', 'support'], {
    message:
      'level must be one of: moderator, admin, support (super_admin cannot be created via this API)',
  })
  level: string;
}
