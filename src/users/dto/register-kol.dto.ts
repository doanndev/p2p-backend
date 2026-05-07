import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterKolDto {
  @ApiProperty({ example: 'John KOL', description: 'Tên KOL' })
  name: string;

  @ApiPropertyOptional({
    example: 'https://facebook.com/john.kol',
    description: 'Link Facebook',
  })
  facebookUrl?: string;

  @ApiPropertyOptional({
    example: 'https://x.com/johnkol',
    description: 'Link X (Twitter)',
  })
  xUrl?: string;

  @ApiPropertyOptional({
    example: 'https://t.me/joinchat/example',
    description: 'Link group Telegram',
  })
  groupTelegramUrl?: string;

  @ApiPropertyOptional({
    example: 'https://youtube.com/@johnkol',
    description: 'Link YouTube',
  })
  youtubeUrl?: string;

  @ApiPropertyOptional({
    example: 'https://johnkol.com',
    description: 'Website cá nhân',
  })
  websiteUrl?: string;
}
