import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  id_token: string;
  scope?: string;
  token_type?: string;
}

/** tokeninfo JSON — several fields are strings */
export interface GoogleTokenInfoPayload {
  iss?: string;
  sub?: string;
  aud?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(private readonly configService: ConfigService) {}

  private getClientConfig(): {
    clientId: string;
    clientSecret: string;
    redirectBase: string;
  } {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectBase = this.configService.get<string>(
      'FRONTEND_URL_GOOGLE_REDIRECT',
    );
    if (!clientId || !clientSecret || !redirectBase) {
      throw new BadRequestException(
        'Google OAuth is not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FRONTEND_URL_GOOGLE_REDIRECT)',
      );
    }
    return { clientId, clientSecret, redirectBase };
  }

  async exchangeCodeForToken(
    code: string,
    path: string,
  ): Promise<GoogleTokenResponse> {
    const { clientId, clientSecret, redirectBase } = this.getClientConfig();
    const decodedCode = decodeURIComponent(code);
    const redirectUri = `${redirectBase.replace(/\/$/, '')}/${path}`;

    const body = new URLSearchParams({
      code: decodedCode,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`Google token exchange failed: ${res.status} ${text}`);
        throw new BadRequestException('Failed to exchange code for token');
      }

      const data = (await res.json()) as GoogleTokenResponse;
      if (!data.id_token) {
        throw new BadRequestException('Invalid token response from Google');
      }
      return data;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error('Failed to exchange code for token', e);
      throw new BadRequestException('Failed to exchange code for token');
    }
  }

  async verifyIdToken(idToken: string): Promise<GoogleTokenInfoPayload> {
    const { clientId } = this.getClientConfig();

    try {
      const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
      const res = await fetch(url);

      if (!res.ok) {
        throw new BadRequestException('Invalid Google token');
      }

      const payload = (await res.json()) as GoogleTokenInfoPayload;

      if (
        payload.iss !== 'accounts.google.com' &&
        payload.iss !== 'https://accounts.google.com'
      ) {
        throw new BadRequestException('Invalid token issuer');
      }

      if (payload.aud !== clientId) {
        throw new BadRequestException('Invalid token audience');
      }

      const verified =
        payload.email_verified === true || payload.email_verified === 'true';
      if (!verified) {
        this.logger.warn(`Email not verified for Google user: ${payload.email}`);
        throw new BadRequestException('Email not verified');
      }

      if (!payload.sub || !payload.email) {
        throw new BadRequestException('Invalid Google token payload');
      }

      return payload;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error('Invalid Google token', e);
      throw new BadRequestException('Invalid Google token');
    }
  }
}
