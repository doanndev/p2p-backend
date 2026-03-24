import { IsString, IsNotEmpty, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitKolArticleDto {
  @ApiProperty({
    example: 'https://medium.com/@john/my-crypto-article',
    description: 'URL bài viết KOL gửi duyệt',
  })
  @IsString()
  @IsNotEmpty({ message: 'Article URL is required' })
  @IsUrl({}, { message: 'Article URL must be a valid URL' })
  articleUrl: string;
}

