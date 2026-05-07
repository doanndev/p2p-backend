import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';

/**
 * Middleware để xác minh origin của request
 * - Nếu origin trùng với ADMIN_FRONTEND_URLS => chỉ định sử dụng admin_access_token
 * - Nếu origin trùng với FRONTEND_URLS => chỉ định sử dụng access_token
 * - Lưu trữ thông tin vào request.originType để JWT strategies sử dụng
 */
@Injectable()
export class OriginValidationMiddleware implements NestMiddleware {
  private adminFrontendUrls: string[] = [];
  private frontendUrls: string[] = [];

  constructor(private configService: ConfigService) {
    this.loadUrls();
  }

  private loadUrls(): void {
    // Lấy danh sách admin frontend URLs
    const adminUrlsRaw =
      this.configService.get<string>('ADMIN_FRONTEND_URLS') || '';
    this.adminFrontendUrls = adminUrlsRaw
      .split(',')
      .map((url) => url.trim())
      .filter((url) => url);

    // Lấy danh sách frontend URLs
    const frontendUrlsRaw =
      this.configService.get<string>('FRONTEND_URLS') || '';
    this.frontendUrls = frontendUrlsRaw
      .split(',')
      .map((url) => url.trim())
      .filter((url) => url);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const originHeader = req.headers.origin as string | undefined;
    const refererHeader = req.headers.referer as string | undefined;
    const origin = this.extractRequestOrigin(originHeader, refererHeader);

    // Kiểm tra xem origin có phải từ admin frontend không
    const isAdminOrigin = this.matchesUrls(origin, this.adminFrontendUrls);

    // Kiểm tra xem origin có phải từ regular frontend không
    const isFrontendOrigin = this.matchesUrls(origin, this.frontendUrls);

    const hasUserToken = Boolean(req.cookies?.['access_token']);
    const hasAdminToken = Boolean(req.cookies?.['admin_access_token']);

    // Khi origin khớp cả admin và user (thường gặp ở môi trường localhost),
    // ưu tiên phân loại theo loại token đang có để tránh chọn sai strategy.
    let originType: 'admin' | 'user' = 'user';
    if (isAdminOrigin && !isFrontendOrigin) {
      originType = 'admin';
    } else if (isAdminOrigin && isFrontendOrigin) {
      if (hasAdminToken && !hasUserToken) {
        originType = 'admin';
      }
    }

    // Ghi lại thông tin origin vào request object
    (req as any).originType = originType;
    (req as any).isValidOrigin = isAdminOrigin || isFrontendOrigin || !origin;

    next();
  }

  /**
   * So sánh origin với danh sách URLs được phép
   * Hỗ trợ so khớp cơ bản với protocol, domain, port
   */
  private matchesUrls(origin: string, urls: string[]): boolean {
    if (!origin) {
      return false;
    }

    return urls.some((url) => {
      const normalizedUrl = url.replace(/\/$/, ''); // Loại bỏ trailing slash
      const regex = new RegExp(
        `^https?://([a-z0-9-]+\\.)?${normalizedUrl
          .replace('http://', '')
          .replace('https://', '')
          .replace(/\./g, '\\.')}(:\\d+)?$`,
      );
      return regex.test(origin);
    });
  }

  private extractRequestOrigin(origin?: string, referer?: string): string {
    if (origin) {
      return origin;
    }

    if (!referer) {
      return '';
    }

    try {
      return new URL(referer).origin;
    } catch {
      return '';
    }
  }
}
