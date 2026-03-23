import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterKolDto {
  @ApiProperty({ example: 'John KOL', description: 'Tên KOL' })
  name: string;

  @ApiPropertyOptional({ example: 'https://facebook.com/john.kol', description: 'Link Facebook' })
  facebook_url?: string;

  @ApiPropertyOptional({ example: 'https://x.com/johnkol', description: 'Link X (Twitter)' })
  x_url?: string;

  @ApiPropertyOptional({ example: 'https://t.me/joinchat/example', description: 'Link group Telegram' })
  group_telegram_url?: string;

  @ApiPropertyOptional({ example: 'https://youtube.com/@johnkol', description: 'Link YouTube' })
  youtube_url?: string;

  @ApiPropertyOptional({ example: 'https://johnkol.com', description: 'Website cá nhân' })
  website_url?: string;
}

