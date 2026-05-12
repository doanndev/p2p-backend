/** Match template outer background; use `on-dark` if the bar uses a dark fill. */
export type BrandLogoVariant = 'on-light' | 'on-dark';

type BrandLogoBarOptions = {
  /** Same as the email wrapper `background-color` (e.g. #ffffff, #f7f9fb). */
  background?: string;
  variant?: BrandLogoVariant;
  padding?: string;
  borderRadius?: string;
  marginBottom?: number;
  /** Underline color below the logo. Set to 'transparent' to hide. */
  dividerColor?: string;
};

const LOGO_COLORS: Record<BrandLogoVariant, { direct: string; won: string }> = {
  'on-light': { direct: '#7dd3fc', won: '#475569' },
  'on-dark': { direct: '#7dd3fc', won: '#f0f3f7' },
};

export function getBrandLogoHtml(
  variant: BrandLogoVariant = 'on-light',
): string {
  const { direct, won } = LOGO_COLORS[variant];
  return `
    <span style="display: inline-block; letter-spacing: -0.04em; font-family: 'Sora', 'Inter', Arial, sans-serif; -webkit-font-smoothing: antialiased; white-space: nowrap;">
      <span style="font-size: 24px; line-height: 32px; font-weight: 800; color: ${direct};">Direct</span><span style="font-size: 24px; line-height: 32px; font-weight: 300; color: ${won}; margin-left: 3px;">Won</span>
    </span>
  `;
}

export function getBrandLogoBarHtml(options: BrandLogoBarOptions = {}): string {
  const {
    background = '#ffffff',
    variant = 'on-light',
    padding = '14px 20px 12px',
    borderRadius = '0',
    marginBottom = 12,
    dividerColor = variant === 'on-dark' ? '#1f2937' : '#e2e8f0',
  } = options;

  return `
    <tr>
      <td align="center" style="background-color: ${background}; border-radius: ${borderRadius}; padding: ${padding}; border-bottom: 1px solid ${dividerColor}; text-align: center;">
        ${getBrandLogoHtml(variant)}
      </td>
    </tr>
    <tr><td style="height: ${marginBottom}px;"></td></tr>
  `;
}
