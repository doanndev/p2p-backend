import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { getDepositSuccessEmailHtml } from '../email/deposit-usdt-success.template';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

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
    const mailOptions = {
      from: this.configService.get<string>('SMTP_FROM') || this.configService.get<string>('SMTP_USER'),
      to,
      subject: 'Email Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Email Verification</h2>
          <p>Your email verification code is:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; border-radius: 5px; margin: 20px 0;">
            <h1 style="color: #007bff; font-size: 32px; margin: 0; letter-spacing: 5px;">${code}</h1>
          </div>
          <p>This code will expire in 3 minutes.</p>
          <p style="color: #666; font-size: 12px;">If you did not request this code, please ignore this email.</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }

  async sendPasswordResetLink(to: string, token: string): Promise<void> {
    const resetUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const resetLink = `${resetUrl}/change-password?token=${token}`;

    const mailOptions = {
      from: this.configService.get<string>('SMTP_FROM') || this.configService.get<string>('SMTP_USER'),
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

  /**
   * Gửi email thông báo nạp USDT thành công
   */
  async sendDepositNotification(to: string, amount: number): Promise<void> {
    const mailOptions = {
      from:
        this.configService.get<string>('SMTP_FROM') ||
        this.configService.get<string>('SMTP_USER'),
      to,
      subject: 'USDT Deposit Successful',
      html: getDepositSuccessEmailHtml(amount),
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending deposit notification email:', error);
      throw error;
    }
  }
}

