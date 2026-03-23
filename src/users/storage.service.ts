import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class StorageService {
  private readonly uploadPath = process.env.UPLOAD_PATH || './uploads';

  constructor() {
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadPath)) {
      fs.mkdirSync(this.uploadPath, { recursive: true });
    }
  }

  generateImageHash(): string {
    const timestamp = Date.now();
    const random = Math.random().toString();
    return crypto.createHash('md5').update(`${timestamp}-${random}`).digest('hex');
  }

  async saveImage(file: Express.Multer.File, userId: number, imageHash: string): Promise<string> {
    // Create user directory
    const userDir = path.join(this.uploadPath, userId.toString());
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // Generate filename with extension
    const fileExtension = path.extname(file.originalname) || '.jpg';
    const filename = `${imageHash}${fileExtension}`;
    const filePath = path.join(userDir, filename);

    // Check if file already exists (prevent duplicate)
    let attempts = 0;
    let finalHash = imageHash;
    let finalPath = filePath;
    while (fs.existsSync(finalPath) && attempts < 10) {
      // If exists, generate new hash
      finalHash = this.generateImageHash();
      finalPath = path.join(userDir, `${finalHash}${fileExtension}`);
      attempts++;
    }

    if (attempts >= 10) {
      throw new Error('Unable to generate unique filename after multiple attempts');
    }

    // Save file from buffer
    fs.writeFileSync(finalPath, file.buffer);

    // Return relative path for database storage: [uid]/filename
    return `${userId}/${finalHash}${fileExtension}`;
  }

  getImagePath(storedPath: string): string {
    return path.join(this.uploadPath, storedPath);
  }
}

