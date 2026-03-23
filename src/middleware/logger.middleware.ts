// src/common/middleware/logger.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
    const startTime = Date.now(); // Đo thời gian bắt đầu request

    // Lấy địa chỉ URL của frontend từ header 'Referer' (URL trang gốc yêu cầu)
    const referer = req.headers['referer'] || 'N/A'; // Nếu không có, mặc định là 'N/A'

    // Xử lý khi request hoàn thành
    res.on('finish', () => {
      const duration = Date.now() - startTime; // Thời gian phản hồi
      const statusCode = res.statusCode;
      const message = `[${method}] ${originalUrl} | Referer: ${referer} | Status: ${statusCode} | Duration: ${duration}ms`;

      // Format/màu log đồng nhất với NestJS logger mặc định
      if (statusCode >= 500) {
        this.logger.error(message);
      } else if (statusCode >= 400) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    });

    next(); // Chuyển sang middleware hoặc controller tiếp theo
  }
}
