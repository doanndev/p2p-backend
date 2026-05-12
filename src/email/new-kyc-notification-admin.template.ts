import { getBrandLogoBarHtml } from './brand-logo.partial';

export type NewKycNotificationAdminPayload = {
  userId: number;
  userName: string;
  userEmail: string;
  fullName: string;
  verificationId: number;
  submittedAt?: Date | string;
};

function formatSubmittedAt(submittedAt?: Date | string): string {
  if (!submittedAt) return new Date().toLocaleString();
  const date =
    typeof submittedAt === 'string' ? new Date(submittedAt) : submittedAt;
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString();
  return date.toLocaleString();
}

export function getNewKycNotificationAdminEmailHtml(
  payload: NewKycNotificationAdminPayload,
  options: { reviewUrl?: string } = {},
): string {
  const reviewUrl = options.reviewUrl?.trim() ? options.reviewUrl : '#';
  const submitted = formatSubmittedAt(payload.submittedAt);

  return `
    <div style="margin: 0; padding: 0; background-color: #f7f9fb; font-family: Inter, Arial, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f7f9fb; padding: 24px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width: 100%; max-width: 600px; margin: 0 auto; padding: 0 12px;">
              ${getBrandLogoBarHtml({ background: '#f7f9fb' })}
              <tr>
                <td align="center" style="padding: 16px 0 20px;">
                  <div style="font-size: 34px; line-height: 34px;">🪪</div>
                  <h1 style="margin: 8px 0 0; color: #0f172a; font-size: 22px; font-weight: 700;">New KYC submission</h1>
                  <p style="margin: 8px 0 0; color: #64748b; font-size: 14px;">A user submitted identity verification for review.</p>
                </td>
              </tr>

              <tr>
                <td style="background-color: #ffffff; border-radius: 14px; padding: 28px 24px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);">
                  <div style="background-color: #f8fafc; border-left: 4px solid #102a43; border-radius: 8px; padding: 14px 16px; margin-bottom: 22px;">
                    <span style="color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.06em;">Verification ID</span>
                    <div style="color: #0f172a; font-family: ui-monospace, monospace; font-size: 18px; font-weight: 800; margin-top: 4px;">${payload.verificationId}</div>
                  </div>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                    <tr>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px; width: 38%;">User ID</td>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 14px; font-weight: 600;">${payload.userId}</td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px;">Username</td>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 14px; font-weight: 600;">@${payload.userName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px;">Full name</td>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 14px; font-weight: 600;">${payload.fullName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px;">Email</td>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #1e40af; font-size: 14px;">${payload.userEmail}</td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 0; color: #64748b; font-size: 14px;">Submitted at</td>
                      <td style="padding: 12px 0; color: #0f172a; font-size: 13px;">${submitted}</td>
                    </tr>
                  </table>

                  <div style="text-align: center; margin-top: 28px;">
                    <a href="${reviewUrl}" style="display: inline-block; padding: 12px 28px; background-color: #102a43; color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 15px; font-weight: 700;">
                      Review in admin
                    </a>
                  </div>

                  <p style="margin: 18px 0 0; color: #94a3b8; font-size: 12px; text-align: center;">
                    Automated notification · Admin only
                  </p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding: 20px 6px 6px; color: #64748b; font-size: 12px; line-height: 1.7;">
                  <div>If the button does not work, open your admin app and go to the KYC queue.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}
