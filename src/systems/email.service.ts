import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { join } from 'path';
import { getNewDepositNotificationEmailHtml } from '../email/new-deposit-notification.template';
import { getNewWithdrawNotificationEmailHtml } from '../email/new-withdraw-notification.template';
import { getTransactionExecutedNotificationEmailHtml } from '../email/transaction-executed-notification.template';
import { getTransactionPaymentConfirmedNotificationEmailHtml } from '../email/transaction-payment-confirmed-notification.template';
import { getNewKycNotificationAdminEmailHtml } from '../email/new-kyc-notification-admin.template';
import { getOrderbookBankChangePendingAdminEmailHtml } from '../email/orderbook-bank-change-pending-admin.template';
import { getPasswordResetEmailHtml } from '../email/password-reset.template';
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

  /** First URL from `ADMIN_FRONTEND_URLS` (comma-separated), for deep links in admin emails. */
  private getPrimaryAdminFrontendUrl(): string {
    const raw = this.configService.get<string>('ADMIN_FRONTEND_URLS') || '';
    const first = raw.split(',')[0].trim();
    return first || 'http://localhost:3001';
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
      html: getPasswordResetEmailHtml(resetLink, 3),
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
    const adminBase = this.getPrimaryAdminFrontendUrl().replace(/\/$/, '');
    const reviewUrl = `${adminBase}/kyc`;

    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: `New KYC submission #${payload.verificationId}`,
      html: getNewKycNotificationAdminEmailHtml(payload, { reviewUrl }),
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
    const adminBase = this.getPrimaryAdminFrontendUrl().replace(/\/$/, '');
    const reviewUrl = `${adminBase}/orderbooks/${payload.orderbookId}`;

    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: `Orderbook #${payload.orderbookId} bank change pending approval`,
      html: getOrderbookBankChangePendingAdminEmailHtml(payload, {
        reviewUrl,
      }),
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
