import { getBrandLogoBarHtml } from './brand-logo.partial';
import { formatDecimalDisplay } from './format-decimal-display';

type TransactionExecutedNotificationPayload = {
  referenceCode: string;
  amount: number | string;
  coinSymbol?: string;
  totalPrice?: number | string;
  nationalSymbol?: string;
  createdAt?: Date | string;
  supportUrl?: string;
  heroImageUrl?: string;
  backgroundImageUrl?: string;
};

function formatTime(createdAt?: Date | string): string {
  if (!createdAt) return 'Just now';
  const date = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toUTCString();
}

export function getTransactionExecutedNotificationEmailHtml(
  payload: TransactionExecutedNotificationPayload,
): string {
  const {
    referenceCode,
    amount,
    coinSymbol = 'USDT',
    totalPrice,
    nationalSymbol = 'VND',
    createdAt,
    supportUrl = '#',
    heroImageUrl = 'cid:OptIn_Hero',
    backgroundImageUrl = 'cid:Grey_BG_01',
  } = payload;

  const detailsRows = [
    ['Type', 'P2P Transaction'],
    ['Status', 'Executed'],
    ['Reference code', referenceCode],
    ['Amount', `${formatDecimalDisplay(amount)} ${coinSymbol}`],
    totalPrice !== undefined
      ? ['Total', `${formatDecimalDisplay(totalPrice)} ${nationalSymbol}`]
      : null,
    ['Updated at', formatTime(createdAt)],
  ]
    .filter(Boolean)
    .map(
      (item) => `
        <tr>
          <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 13px; width: 150px;">${item![0]}</td>
          <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 13px; font-weight: 600; word-break: break-all;">${item![1]}</td>
        </tr>
      `,
    )
    .join('');

  return `
    <div style="margin: 0; padding: 0; background-color: #ffffff; font-family: Inter, Arial, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding: 18px 0; background-color: #ffffff;">
        <tr>
          <td align="center">
            <table role="presentation" width="700" cellspacing="0" cellpadding="0" style="width: 100%; max-width: 700px; margin: 0 auto; padding: 0 10px;">
              ${getBrandLogoBarHtml()}
              <tr>
                <td style="background-color: #f9f9fb; border-radius: 8px; text-align: center; color: #040b22; font-size: 14px; padding: 12px;">
                  Transaction executed successfully
                </td>
              </tr>
              <tr><td style="height: 8px;"></td></tr>
              <tr>
                <td style="background: #050019 url('${heroImageUrl}') no-repeat center top / cover; border-radius: 8px; text-align: center; padding: 64px 16px;">
                  <div style="color: #ffffff; font-size: 34px; font-weight: 700; letter-spacing: -0.5px;">
                    Trade completed
                  </div>
                </td>
              </tr>
              <tr>
                <td style="background: #f5f5f7 url('${backgroundImageUrl}') no-repeat center / cover; padding: 28px 22px; border-radius: 8px;">
                  <p style="margin: 0 0 14px; color: #4a4f5f; font-size: 16px; line-height: 1.55;">
                    Your transaction has been executed successfully.
                  </p>
                  <p style="margin: 0 0 18px; color: #4a4f5f; font-size: 16px; line-height: 1.55;">
                    You can review the completed transaction details below.
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; background: #ffffff; border-radius: 10px; overflow: hidden;">
                    ${detailsRows}
                  </table>
                  <div style="padding-top: 18px;">
                    <a href="${supportUrl}" style="display: inline-block; text-decoration: none; color: #ffffff; background-color: #1e40ff; border-radius: 28px; padding: 10px 24px; font-size: 15px; font-weight: 600;">
                      Contact support
                    </a>
                  </div>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding: 14px 10px 4px; color: #64748b; font-size: 12px; line-height: 1.7;">
                  <div>This is an automated email from <strong>noreply</strong>. Please do not reply to this message.</div>
                  <div>If you need help, please use the Contact support button above.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}
