import { getBrandLogoBarHtml } from './brand-logo.partial';

export function getPasswordResetEmailHtml(
  resetLink: string,
  expireMinutes = 3,
): string {
  const safeLink = resetLink?.trim() ? resetLink : '#';

  return `
    <div style="margin: 0; padding: 0; background-color: #f7f9fb; font-family: Inter, Arial, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f7f9fb; padding: 24px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width: 100%; max-width: 600px; margin: 0 auto; padding: 0 12px;">
              ${getBrandLogoBarHtml({ background: '#f7f9fb' })}
              <tr>
                <td align="center" style="padding: 16px 0 20px;">
                  <div style="font-size: 34px; line-height: 34px;">🔑</div>
                  <h1 style="margin: 8px 0 0; color: #0f172a; font-size: 22px; font-weight: 700;">Password reset</h1>
                </td>
              </tr>

              <tr>
                <td style="background-color: #ffffff; border-radius: 14px; padding: 32px 24px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);">
                  <h2 style="margin: 0; color: #00152a; font-size: 24px; font-weight: 800; text-align: center; line-height: 1.25;">
                    Reset your password
                  </h2>
                  <p style="margin: 14px 0 26px; color: #475569; font-size: 16px; text-align: center; line-height: 1.6;">
                    You requested a password reset. Use the button below to choose a new password.
                  </p>

                  <div style="text-align: center; margin-bottom: 22px;">
                    <a href="${safeLink}" style="display: inline-block; padding: 12px 28px; background-color: #102a43; color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 16px; font-weight: 700;">
                      Reset password
                    </a>
                  </div>

                  <p style="margin: 0 0 12px; color: #64748b; font-size: 13px; text-align: center;">
                    Or copy this link into your browser:
                  </p>
                  <div style="background-color: #f2f4f6; border-radius: 10px; padding: 14px 16px; margin-bottom: 22px;">
                    <p style="margin: 0; color: #0f172a; font-size: 13px; word-break: break-all; text-align: center;">
                      ${safeLink}
                    </p>
                  </div>

                  <p style="margin: 0 0 18px; color: #475569; font-size: 13px; text-align: center;">
                    This link expires in <strong style="color: #00152a;">${expireMinutes} minutes</strong>.
                  </p>

                  <div style="background-color: #f2f4f6; border-radius: 10px; padding: 14px;">
                    <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.65; text-align: center;">
                      If you did not request a password reset, you can safely ignore this email.
                    </p>
                  </div>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding: 20px 6px 6px; color: #64748b; font-size: 12px; line-height: 1.7;">
                  <div style="margin-bottom: 4px;">Support | Privacy Policy | Unsubscribe</div>
                  <div>© 2024 Editorial Precision. All rights reserved.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}
