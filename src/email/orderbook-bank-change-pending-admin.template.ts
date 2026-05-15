import { getBrandLogoBarHtml } from './brand-logo.partial';

export type OrderbookBankChangePendingAdminPayload = {
  orderbookId: number;
  requestedByUserId: number;
  requestedByUsername: string;
  requestedByEmail: string;
  targetBankUserId: number;
  requestedAt?: Date | string;
};

function formatRequestedAt(requestedAt?: Date | string): string {
  if (!requestedAt) return new Date().toLocaleString();
  const date =
    typeof requestedAt === 'string' ? new Date(requestedAt) : requestedAt;
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString();
  return date.toLocaleString();
}

export function getOrderbookBankChangePendingAdminEmailHtml(
  payload: OrderbookBankChangePendingAdminPayload,
  options: { reviewUrl?: string } = {},
): string {
  const reviewUrl = options.reviewUrl?.trim() ? options.reviewUrl : '#';
  const requested = formatRequestedAt(payload.requestedAt);

  return `
    <div style="margin: 0; padding: 0; background-color: #fff9f0; font-family: Inter, Arial, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff9f0; padding: 24px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width: 100%; max-width: 600px; margin: 0 auto; padding: 0 12px;">
              ${getBrandLogoBarHtml({ background: '#fff9f0' })}
              <tr>
                <td align="center" style="padding: 16px 0 20px;">
                  <div style="font-size: 34px; line-height: 34px;">🏦</div>
                  <h1 style="margin: 8px 0 0; color: #0f172a; font-size: 22px; font-weight: 700;">Bank change pending</h1>
                  <p style="margin: 8px 0 0; color: #9a3412; font-size: 14px;">Orderbook security update · needs admin approval</p>
                </td>
              </tr>

              <tr>
                <td style="background-color: #ffffff; border-radius: 14px; padding: 28px 24px; box-shadow: 0 8px 24px rgba(124, 45, 18, 0.08); border: 1px solid #ffedd5;">
                  <p style="margin: 0 0 22px; color: #475569; font-size: 15px; line-height: 1.55;">
                    A user requested to change the bank account linked to an orderbook. Please review and approve or reject in the admin panel.
                  </p>

                  <div style="background-color: #fff7ed; border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; border: 1px solid #fed7aa;">
                    <span style="color: #9a3412; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.06em;">Orderbook ID</span>
                    <div style="color: #0f172a; font-family: ui-monospace, monospace; font-size: 20px; font-weight: 800; margin-top: 4px;">${payload.orderbookId}</div>
                  </div>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                    <tr>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px; width: 42%;">Requested by</td>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 14px; font-weight: 600;">
                        ${payload.requestedByUsername}
                        <span style="display: block; font-size: 12px; color: #94a3b8; font-weight: 500;">User ID ${payload.requestedByUserId}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px;">Email</td>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #c2410c; font-size: 14px;">${payload.requestedByEmail}</td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px;">New bank (user)</td>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 14px; font-weight: 600;">
                        <span style="background-color: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 700;">NEW</span>
                        <span style="margin-left: 8px;">Bank user ID ${payload.targetBankUserId}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 0; color: #64748b; font-size: 14px;">Requested at</td>
                      <td style="padding: 12px 0; color: #0f172a; font-size: 13px;">${requested}</td>
                    </tr>
                  </table>

                  <div style="text-align: center; margin-top: 28px;">
                    <a href="${reviewUrl}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%); color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 15px; font-weight: 700;">
                      Open admin
                    </a>
                  </div>

                  <p style="margin: 18px 0 0; color: #94a3b8; font-size: 12px; text-align: center;">
                    Security notification · internal use
                  </p>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding: 20px 6px 6px; color: #78716c; font-size: 12px; line-height: 1.7;">
                  <div>If the button does not work, open your admin app and review pending orderbook bank changes.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}
