import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CloudinaryService } from '../common/services/cloudinary.service';
import { PresignedUploadDto } from './dto/presigned-upload.dto';

@ApiTags('Uploads')
@ApiCookieAuth('access_token')
@Controller()
export class UploadsController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Post('presigned_upload')
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate signed direct upload payload for Cloudinary',
  })
  @ApiBody({ type: PresignedUploadDto })
  @ApiOkResponse({
    description: 'Signed upload payload',
    schema: {
      example: {
        upload_url: 'https://api.cloudinary.com/v1_1/demo/image/upload',
        http_method: 'POST',
        form_fields: {
          api_key: '1234567890',
          timestamp: '1712733530',
          signature: 'abc123signature',
          folder: 'uploads',
          public_id: 'upload_1712733530231_abcd1234efg',
        },
      },
    },
  })
  getPresignedUpload(@Body() dto: PresignedUploadDto) {
    return this.cloudinaryService.generateSignedDirectUpload(dto);
  }
}
