import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

type SignedDirectUploadInput = {
  filename: string;
  file_size_bytes: number;
  folder: string;
  content_type: string;
};

type SignedDirectUploadResult = {
  upload_url: string;
  http_method: 'POST';
  form_fields: Record<string, string>;
};

@Injectable()
export class CloudinaryService {
  constructor(private configService: ConfigService) {
    // Initialize Cloudinary
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  /**
   * Upload image to Cloudinary
   * @param file Express.Multer.File
   * @param folder Folder path in Cloudinary (e.g., 'kyc', 'avatars')
   * @param publicId Optional public ID for the image
   * @returns Cloudinary upload result with secure_url
   */
  async uploadImage(
    file: Express.Multer.File,
    folder: string,
    publicId?: string,
  ): Promise<{ url: string; public_id: string }> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          public_id: publicId,
          resource_type: 'image',
          format: this.getImageFormat(file.mimetype),
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve({
              url: result.secure_url,
              public_id: result.public_id,
            });
          }
        },
      );

      // Convert buffer to stream
      const readableStream = new Readable();
      readableStream.push(file.buffer);
      readableStream.push(null);
      readableStream.pipe(uploadStream);
    });
  }

  /**
   * Delete image from Cloudinary
   * @param publicId Public ID of the image to delete
   */
  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      console.error(`Error deleting image ${publicId}:`, error);
      // Don't throw error, just log it
    }
  }

  /**
   * Get image format from mimetype
   */
  private getImageFormat(mimetype: string): string {
    const formatMap: { [key: string]: string } = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    };

    return formatMap[mimetype] || 'jpg';
  }

  /**
   * Generate unique public ID
   */
  generatePublicId(prefix: string = 'img'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `${prefix}_${timestamp}_${random}`;
  }

  private normalizeFolder(folder: string): string {
    return (folder || 'uploads')
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .replace(/[^a-zA-Z0-9/_-]/g, '');
  }

  private getSafeExtension(filename: string, contentType: string): string {
    const fromName = filename?.split('.').pop()?.toLowerCase() || '';
    const allow = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
    if (allow.has(fromName)) return fromName;

    const fromTypeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    };
    return fromTypeMap[contentType] || 'jpg';
  }

  generateSignedDirectUpload(
    input: SignedDirectUploadInput,
  ): SignedDirectUploadResult {
    const cloudName =
      this.configService.get<string>('CLOUDINARY_CLOUD_NAME') || '';
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY') || '';
    const apiSecret =
      this.configService.get<string>('CLOUDINARY_API_SECRET') || '';

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary credentials are not configured');
    }

    const folder = this.normalizeFolder(input.folder || 'uploads');
    const uniqueId = this.generatePublicId('upload');
    const publicId = uniqueId;

    const timestamp = Math.floor(Date.now() / 1000);

    // Cloudinary signed-upload parameters (frontend sends these with file upload request).
    const signParams = {
      timestamp,
      public_id: publicId,
      folder,
    };
    const signature = cloudinary.utils.api_sign_request(signParams, apiSecret);

    return {
      upload_url: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      http_method: 'POST',
      form_fields: {
        api_key: apiKey,
        timestamp: String(timestamp),
        signature,
        folder,
        public_id: publicId,
      },
    };
  }
}
