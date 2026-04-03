import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({
    description: 'Authorization code từ Google OAuth redirect',
  })
  @IsString()
  @MinLength(1)
  code: string;

  @ApiPropertyOptional({
    default: 'google-login',
    description:
      'Path segment sau FRONTEND_URL_GOOGLE_REDIRECT; redirect_uri phải khớp khi đổi code',
  })
  @IsOptional()
  @IsString()
  path?: string;
}
