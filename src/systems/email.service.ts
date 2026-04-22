import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { join } from 'path';
import { getNewDepositNotificationEmailHtml } from '../email/new-deposit-notification.template';
import { getNewWithdrawNotificationEmailHtml } from '../email/new-withdraw-notification.template';
import { getTransactionExecutedNotificationEmailHtml } from '../email/transaction-executed-notification.template';
import { getTransactionPaymentConfirmedNotificationEmailHtml } from '../email/transaction-payment-confirmed-notification.template';
import { getVerifyEmailCodeHtml } from '../email/verify-email-code.template';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly emailAssetAttachments = [
    {
      filename: 'OptIn_Hero.png',
      path: join(process.cwd(), 'src/email/assets/OptIn_Hero.png'),
      cid: 'OptIn_Hero',
    },
    {
      filename: 'Grey_BG_01.png',
      path: join(process.cwd(), 'src/email/assets/Grey_BG_01.png'),
      cid: 'Grey_BG_01',
    },
  ];

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com',
      port: this.configService.get<number>('SMTP_PORT') || 587,
      secure: false,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
      // Add timeout configurations to prevent delays
      connectionTimeout: 5000, // 5 seconds for initial connection
      greetingTimeout: 5000, // 5 seconds for SMTP greeting
      socketTimeout: 10000, // 10 seconds for socket operations
    });
  }

  async sendEmailVerificationCode(to: string, code: string): Promise<void> {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const verifyUrl = `${frontendUrl}/verify-email`;

    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: 'Email Verification Code',
      html: getVerifyEmailCodeHtml(code, 3, verifyUrl),
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }

  async sendPasswordResetLink(to: string, token: string): Promise<void> {
    const resetUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const resetLink = `${resetUrl}/change-password?token=${token}`;

    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p>You have requested to reset your password. Click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #007bff; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
          </div>
          <p>Or copy and paste this link into your browser:</p>
          <p style="color: #007bff; word-break: break-all;">${resetLink}</p>
          <p>This link will expire in 3 minutes.</p>
          <p style="color: #666; font-size: 12px;">If you did not request a password reset, please ignore this email.</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw error;
    }
  }

  async sendDepositNotification(
    to: string,
    payload: {
      amount: number;
      asset?: string;
      network?: string;
      txHash?: string;
      walletAddress?: string;
      createdAt?: Date | string;
    },
  ): Promise<void> {
    const asset = payload.asset || 'USDT';
    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: `New ${asset} Deposit`,
      html: getNewDepositNotificationEmailHtml(payload),
      attachments: this.emailAssetAttachments,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending deposit notification email:', error);
      throw error;
    }
  }

  async sendWithdrawNotification(
    to: string,
    payload: {
      amount: number;
      asset?: string;
      network?: string;
      txHash?: string;
      destinationAddress?: string;
      createdAt?: Date | string;
      status?: 'pending' | 'processing' | 'completed' | 'failed' | string;
    },
  ): Promise<void> {
    const asset = payload.asset || 'USDT';
    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: `New ${asset} Withdrawal`,
      html: getNewWithdrawNotificationEmailHtml(payload),
      attachments: this.emailAssetAttachments,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending deposit notification email:', error);
      throw error;
    }
  }

  async sendTransactionPaymentConfirmedNotification(
    to: string,
    payload: {
      referenceCode: string;
      amount: number | string;
      coinSymbol: string;
      totalPrice: number | string;
      nationalSymbol: string;
      createdAt?: Date | string;
    },
  ): Promise<void> {
    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: `Buyer has paid for transaction ${payload.referenceCode}`,
      html: getTransactionPaymentConfirmedNotificationEmailHtml(payload),
      attachments: this.emailAssetAttachments,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error(
        'Error sending transaction payment confirmed notification:',
        error,
      );
      throw error;
    }
  }

  async sendTransactionExecutedNotification(
    to: string,
    payload: {
      referenceCode: string;
      amount: number | string;
      coinSymbol: string;
      totalPrice: number | string;
      nationalSymbol: string;
      createdAt?: Date | string;
    },
  ): Promise<void> {
    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: `Transaction ${payload.referenceCode} completed successfully`,
      html: getTransactionExecutedNotificationEmailHtml(payload),
      attachments: this.emailAssetAttachments,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending transaction executed notification:', error);
      throw error;
    }
  }

  async sendNewKycNotificationToAdmin(
    to: string,
    payload: {
      userId: number;
      userName: string;
      userEmail: string;
      fullName: string;
      verificationId: number;
      submittedAt?: Date | string;
    },
  ): Promise<void> {
    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: `New KYC submission #${payload.verificationId}`,
      html: `
        <div style="background-color: #f4f7f9; padding: 40px 20px; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e1e8ed;">
    
    <div style="background-color: #0066ff; padding: 30px; text-align: center;">
      <h2 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 0.5px;">New KYC Submission</h2>
      <p style="color: #e0eaff; margin: 10px 0 0 0; font-size: 14px;">A new identity verification request is pending review.</p>
    </div>

    <div style="padding: 30px;">
      <table style="width: 100%; border-spacing: 0; border-collapse: collapse;">
        <tr>
          <td colspan="2" style="padding-bottom: 20px;">
            <div style="background-color: #f8f9fa; border-left: 4px solid #0066ff; padding: 15px;">
              <span style="color: #666; font-size: 12px; text-transform: uppercase; font-weight: bold; display: block; margin-bottom: 4px;">Verification ID</span>
              <span style="color: #333; font-family: monospace; font-size: 16px; font-weight: bold;">${payload.verificationId}</span>
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px; width: 140px;">User ID</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #333; font-size: 14px; font-weight: 500;">${payload.userId}</td>
        </tr>
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Username</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #333; font-size: 14px; font-weight: 500;">@${payload.userName}</td>
        </tr>
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Full Name</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #333; font-size: 14px; font-weight: 600;">${payload.fullName}</td>
        </tr>
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #777; font-size: 14px;">Email</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #0066ff; font-size: 14px;">${payload.userEmail}</td>
        </tr>
        <tr>
          <td style="padding: 12px 0; color: #777; font-size: 14px;">Submitted at</td>
          <td style="padding: 12px 0; color: #333; font-size: 13px;">${payload.submittedAt || new Date().toLocaleString()}</td>
        </tr>
      </table>

      <div style="margin-top: 35px; text-align: center;">
        <a href="#" style="background-color: #0066ff; color: #ffffff; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block; transition: background 0.3s;">
          Review Submission
        </a>
      </div>
    </div>

    <div style="background-color: #fdfdfd; padding: 20px; text-align: center; border-top: 1px solid #eee;">
      <p style="color: #999; font-size: 12px; margin: 0;">This is an automated system notification.</p>
    </div>
  </div>
</div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending new KYC notification email:', error);
      throw error;
    }
  }

  async sendOrderbookBankChangePendingToAdmin(
    to: string,
    payload: {
      orderbookId: number;
      requestedByUserId: number;
      requestedByUsername: string;
      requestedByEmail: string;
      targetBankUserId: number;
      requestedAt?: Date | string;
    },
  ): Promise<void> {
    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: `Orderbook #${payload.orderbookId} bank change pending approval`,
      html: `
        <div style="background-color: #fff9f0; padding: 40px 20px; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 24px rgba(184, 115, 51, 0.15); border: 1px solid #ffe8cc;">
    
    <div style="background: linear-gradient(135deg, #ff9800 0%, #ed6c02 100%); padding: 30px; text-align: center;">
      <div style="background-color: rgba(255,255,255,0.2); width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center;">
        <span style="font-size: 30px;">🏦</span>
      </div>
      <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700;">Bank Change Request</h2>
      <p style="color: #fff3e0; margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Action required: Orderbook Security Update</p>
    </div>

    <div style="padding: 30px;">
      <p style="color: #666; font-size: 15px; line-height: 1.5; margin-top: 0;">A request to change the bank information for Orderbook has been submitted and is awaiting administrator approval.</p>
      
      <div style="margin: 25px 0;">
        <table style="width: 100%; border-collapse: separate; border-spacing: 0 10px;">
          <tr>
            <td style="background-color: #fff5e6; padding: 12px 15px; border-radius: 8px 0 0 8px; border-left: 4px solid #ff9800; color: #8a5e3b; font-size: 13px; font-weight: bold; width: 40%;">ORDERBOOK ID</td>
            <td style="background-color: #fff5e6; padding: 12px 15px; border-radius: 0 8px 8px 0; color: #333; font-family: 'Courier New', Courier, monospace; font-weight: bold;">${payload.orderbookId}</td>
          </tr>
          
          <tr>
            <td style="padding: 10px 15px; color: #888; font-size: 13px;">Requested by User</td>
            <td style="padding: 10px 15px; color: #333; font-size: 14px; font-weight: 500;">
              <span style="display: block; font-weight: 600;">${payload.requestedByUsername}</span>
              <span style="display: block; font-size: 12px; color: #999;">ID: ${payload.requestedByUserId}</span>
            </td>
          </tr>
          
          <tr>
            <td style="padding: 10px 15px; color: #888; font-size: 13px;">Email Address</td>
            <td style="padding: 10px 15px; color: #ed6c02; font-size: 14px;">${payload.requestedByEmail}</td>
          </tr>

          <tr>
            <td style="padding: 10px 15px; color: #888; font-size: 13px;">Target Bank Account</td>
            <td style="padding: 10px 15px; color: #333; font-size: 14px; font-weight: 600;">
               <span style="background-color: #e8f5e9; color: #2e7d32; padding: 2px 8px; border-radius: 4px; font-size: 12px;">NEW</span> ID: ${payload.targetBankUserId}
            </td>
          </tr>

          <tr>
            <td style="padding: 10px 15px; color: #888; font-size: 13px;">Time Requested</td>
            <td style="padding: 10px 15px; color: #666; font-size: 13px;">${payload.requestedAt || new Date().toLocaleString()}</td>
          </tr>
        </table>
      </div>
    </div>

    <div style="background-color: #fafafa; padding: 20px; text-align: center; border-top: 1px dotted #eee;">
      <p style="color: #bbb; font-size: 11px; margin: 0; text-transform: uppercase; letter-spacing: 1px;">Security Notification &bull; Internal Use Only</p>
    </div>
  </div>
</div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error(
        'Error sending orderbook bank change pending email:',
        error,
      );
      throw error;
    }
  }
}
