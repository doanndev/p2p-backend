import { IncomingHttpHeaders } from 'http';

/** Parse `Cookie` header into a map (same rules as browser cookie parsing for simple cases). */
export function parseSupportChatCookie(
  header: string | undefined,
): Record<string, string> {
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k || rest.length === 0) return acc;
    acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

export function splitCommaUrls(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

/**
 * Prefer `Origin`; otherwise derive `protocol//host` from `Referer` so URL lists match
 * (Referer often includes a path; {@link matchesSupportChatOriginUrl} is host-scoped).
 */
export function getClientOriginLike(
  headers: Pick<IncomingHttpHeaders, 'origin' | 'referer'>,
): string {
  const origin = headers.origin;
  if (typeof origin === 'string' && origin.trim()) return origin.trim();
  const referer = headers.referer;
  if (typeof referer === 'string' && referer.trim()) {
    try {
      const u = new URL(referer);
      return `${u.protocol}//${u.host}`;
    } catch {
      return referer.trim();
    }
  }
  return '';
}

/**
 * True when `originLike` (scheme + host, optional port) matches configured app URL entries.
 */
export function matchesSupportChatOriginUrl(
  originLike: string,
  urls: string[],
): boolean {
  if (!originLike) return false;
  return urls.some((url) => {
    const normalizedUrl = url.replace(/\/$/, '');
    const regex = new RegExp(
      `^https?://([a-z0-9-]+\\.)?${normalizedUrl
        .replace('http://', '')
        .replace('https://', '')
        .replace(/\./g, '\\.')}(:\\d+)?$`,
    );
    return regex.test(originLike);
  });
}

export type SupportChatSelectedTokenType = 'admin' | 'user';

export type SupportChatEmptyOriginPolicy = 'http-legacy' | 'socket';

/**
 * Pick which JWT to use for support chat when both cookies may be present.
 * - Known admin SPA origin → `admin_access_token`
 * - Known user / other origin → `access_token`
 * - **http-legacy** (REST): if origin/referer is missing, prefer admin cookie then user (previous behavior).
 * - **socket**: if origin is missing, only `access_token` is considered (admin JWT still requires admin origin).
 */
export function selectSupportChatToken(args: {
  originLike: string;
  adminFrontendUrls: string[];
  userToken?: string;
  adminToken?: string;
  emptyOriginPolicy: SupportChatEmptyOriginPolicy;
}): {
  selectedTokenType: SupportChatSelectedTokenType;
  token?: string;
  isAdminOrigin: boolean;
} {
  const isAdminOrigin = matchesSupportChatOriginUrl(
    args.originLike,
    args.adminFrontendUrls,
  );

  if (!args.originLike) {
    if (args.emptyOriginPolicy === 'http-legacy') {
      if (args.adminToken) {
        return {
          selectedTokenType: 'admin',
          token: args.adminToken,
          isAdminOrigin: false,
        };
      }
      if (args.userToken) {
        return {
          selectedTokenType: 'user',
          token: args.userToken,
          isAdminOrigin: false,
        };
      }
      return {
        selectedTokenType: 'user',
        token: undefined,
        isAdminOrigin: false,
      };
    }

    return {
      selectedTokenType: 'user',
      token: args.userToken,
      isAdminOrigin: false,
    };
  }

  const selectedTokenType: SupportChatSelectedTokenType = isAdminOrigin
    ? 'admin'
    : 'user';
  const token =
    selectedTokenType === 'admin' ? args.adminToken : args.userToken;

  return { selectedTokenType, token, isAdminOrigin };
}
