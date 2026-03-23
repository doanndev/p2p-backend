export function getDepositSuccessEmailHtml(amount: number): string {
  const formattedAmount = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });

  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px 16px; background-color: #000000;">
      <div style="background: radial-gradient(circle at top, #111827 0, #020617 45%, #000000 100%); border-radius: 16px; padding: 24px 24px 28px; box-shadow: 0 18px 45px rgba(0, 0, 0, 0.85); border: 1px solid rgba(148, 163, 184, 0.18);">
        <h2 style="margin: 0 0 16px; color: #f9fafb; font-size: 22px; font-weight: 700; text-align: left;">
          USDT Deposit Successful
        </h2>
        <p style="margin: 0 0 18px; color: #e5e7eb; font-size: 14px; line-height: 1.7;">
          Your deposit has been successfully credited to your account.
        </p>
        <div style="margin: 20px 0 18px; padding: 16px 20px; background: linear-gradient(90deg, #ff6a3d, #ff4fb8, #c158ff); border-radius: 999px; color: #ffffff; box-shadow: 0 12px 30px rgba(248, 113, 113, 0.35);">
          <div style="font-size: 12px; opacity: 0.92; text-transform: uppercase; letter-spacing: 0.16em;">
            Amount deposited
          </div>
          <div style="margin-top: 4px; font-size: 24px; font-weight: 700; letter-spacing: 0.06em;">
            ${formattedAmount} USDT
          </div>
        </div>
        <p style="margin: 0 0 10px; color: #d1d5db; font-size: 13px; line-height: 1.7;">
          You can now use this balance for staking, withdrawals or other activities inside the platform.
        </p>
        <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.7;">
          If you did not perform this deposit, please contact our support team immediately.
        </p>
      </div>
      <p style="margin: 16px 0 0; color: #6b7280; font-size: 11px; text-align: center;">
        This is an automated message, please do not reply to this email.
      </p>
    </div>
  `;
}

