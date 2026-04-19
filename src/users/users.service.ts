/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserSex, UserStatus } from './entities/user.entity';
import {
  UserCode,
  UserCodeType,
  UserCodePlace,
} from './entities/user-code.entity';
import { UserVerify } from './entities/user-verify.entity';
import { VerifyLog } from './entities/verify-log.entity';
import { KolRegister, KolRegisterStatus } from './entities/kol-register.entity';
import { KolArticle, KolArticleStatus } from './entities/kol-article.entity';
import { Notification } from './entities/notification.entity';
import { UserLog, UserLogType, UserLogLevel } from './entities/user-log.entity';
import { randomBytes, randomInt } from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { GoogleAuthService } from './google-auth.service';
import { KycDto } from './dto/kyc.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetNewPasswordDto } from './dto/set-new-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { requireTotpIfEnabled } from '../common/helpers/two-factor.helper';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RegisterKolDto } from './dto/register-kol.dto';
import { SubmitKolArticleDto } from './dto/submit-kol-article.dto';
import { EmailService } from '../systems/email.service';
import { CacheService } from '../systems/cache.service';
import { StorageService } from './storage.service';
import { UserVerifyStatus } from './entities/user-verify.entity';
import { UserWallet, WalletType } from '../wallets/entities/user-wallet.entity';
import { Coin } from '../settings/entities/coin.entity';
import { SmartRefService } from '../smart-ref/smart-ref.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserCode)
    private userCodeRepository: Repository<UserCode>,
    @InjectRepository(UserVerify)
    private userVerifyRepository: Repository<UserVerify>,
    @InjectRepository(VerifyLog)
    private verifyLogRepository: Repository<VerifyLog>,
    @InjectRepository(KolRegister)
    private kolRegisterRepository: Repository<KolRegister>,
    @InjectRepository(KolArticle)
    private kolArticleRepository: Repository<KolArticle>,
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    @InjectRepository(UserLog)
    private userLogRepository: Repository<UserLog>,
    @InjectRepository(UserWallet)
    private userWalletRepository: Repository<UserWallet>,
    @InjectRepository(Coin)
    private coinRepository: Repository<Coin>,
    private jwtService: JwtService,
    private emailService: EmailService,
    private cacheService: CacheService,
    private storageService: StorageService,
    private configService: ConfigService,
    private googleAuthService: GoogleAuthService,
    private smartRefService: SmartRefService,
  ) {}

  /**
   * Get cookie options based on environment
   */
  private getCookieOptions(): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'none' | 'lax' | 'strict';
    path: string;
    domain?: string;
  } {
    const frontendUrlsRaw =
      this.configService.get<string>('FRONTEND_URLS') ||
      'http://localhost:3000';
    const frontendUrl = frontendUrlsRaw.split(',')[0];
    const isHttps = frontendUrl.startsWith('https://');
    const isProduction = process.env.NODE_ENV === 'production' || isHttps;

    let domain: string | undefined;
    // TẠM THỜI: Không set domain để test xem có phải do domain gây vấn đề không
    // Nếu không set domain, browser sẽ tự xử lý và có thể parse cả 2 cookies đúng cách
    // if (isProduction && frontendUrl) {
    //   try {
    //     const url = new URL(frontendUrl);
    //     let hostname = url.hostname.split(':')[0];
    //     if (hostname && !hostname.startsWith('.')) {
    //       domain = `.${hostname}`;
    //     } else {
    //       domain = hostname;
    //     }
    //   } catch (e) {
    //     // Invalid URL, ignore
    //   }
    // }

    const sameSite: 'none' | 'lax' | 'strict' =
      isProduction && isHttps ? 'none' : 'lax';
    const secure = isProduction && isHttps;

    return {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
      ...(domain && { domain }),
    };
  }

  async register(registerDto: RegisterDto): Promise<User> {
    // ref_code is optional: only validate when client sends it
    const normalizedRefCode = registerDto.refCode?.trim();
    let directReferrerUid: number | null = null;
    if (normalizedRefCode) {
      const referrerUser = await this.userRepository.findOne({
        where: { uref: normalizedRefCode },
      });

      if (!referrerUser) {
        throw new BadRequestException(
          'Invalid referral code. Referral code does not exist',
        );
      }
      directReferrerUid = referrerUser.uid;
    }

    // Generate unique uref (8 characters: uppercase letters and numbers)
    let newUref = this.generateUref();
    // Ensure the new uref doesn't conflict with existing ones
    let existingUrefUser = await this.userRepository.findOne({
      where: { uref: newUref },
    });
    while (existingUrefUser) {
      newUref = this.generateUref();
      existingUrefUser = await this.userRepository.findOne({
        where: { uref: newUref },
      });
    }

    // Check each unique field separately to return detailed conflict errors
    const errors: { uname?: string; email?: string; phone?: string } = {};

    const existingByUname = await this.userRepository.findOne({
      where: { uname: registerDto.uname },
    });
    if (existingByUname) errors.uname = 'Username already exists';

    const existingByEmail = await this.userRepository.findOne({
      where: { uemail: registerDto.email },
    });
    if (existingByEmail) errors.email = 'Email already registered';

    if (registerDto.phone?.trim()) {
      const existingByPhone = await this.userRepository.findOne({
        where: { uphone: registerDto.phone.trim() },
      });
      if (existingByPhone) errors.phone = 'Phone number already registered';
    }

    if (Object.keys(errors).length > 0) {
      throw new ConflictException({
        message: 'User already exists with this information',
        errors,
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Create user entity
    const user = this.userRepository.create({
      uname: registerDto.uname,
      uemail: registerDto.email,
      uphone: registerDto.phone || null,
      utelegram: null,
      uggauth: null,
      ugoogle_sub: null,
      upassword: hashedPassword,
      uref: newUref,
      ufulllname: registerDto.displayName,
      ubirthday: null,
      usex: UserSex.OTHER,
      u_active_email: false,
      u_active_ggauth: false,
      uverify: false,
      ulevel: 1,
      ukol: false,
      ustatus: UserStatus.ACTIVE,
    });

    const savedUser = await this.userRepository.save(user);

    if (directReferrerUid != null) {
      await this.smartRefService.recordInviteeReferralChain(
        savedUser.uid,
        directReferrerUid,
      );
    }

    return savedUser;
  }

  async registerAndGenerateTokens(registerDto: RegisterDto): Promise<{
    user: User;
    tokens: { access_token: string; refresh_token: string };
    response: {
      statusCode: number;
      message: string;
      user: {
        id: number;
        name: string;
        email: string;
        display_name: string;
      };
    };
    cookieOptions: {
      access_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none' | 'lax' | 'strict';
        path: string;
        domain?: string;
      };
      refresh_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none' | 'lax' | 'strict';
        path: string;
        domain?: string;
      };
    };
  }> {
    // Register user
    const user = await this.register(registerDto);

    // Generate and send email verification code.
    // If SMTP is not configured/available in local env, do not fail registration.
    try {
      await this.generateAndSendEmailVerificationCode(user);
    } catch (error) {
      this.logger.warn(
        `Register success but failed to send verification email for user ${user.uid}: ${error?.message || error}`,
      );
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Prepare cookie options
    const accessTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    const refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Get cookie options with domain
    const baseCookieOptions = this.getCookieOptions();

    const cookieOptions = {
      access_token: {
        value: tokens.access_token,
        expires: accessTokenExpires,
        httpOnly: baseCookieOptions.httpOnly,
        secure: baseCookieOptions.secure,
        sameSite: baseCookieOptions.sameSite,
        path: baseCookieOptions.path,
        ...(baseCookieOptions.domain && { domain: baseCookieOptions.domain }),
      },
      refresh_token: {
        value: tokens.refresh_token,
        expires: refreshTokenExpires,
        httpOnly: baseCookieOptions.httpOnly,
        secure: baseCookieOptions.secure,
        sameSite: baseCookieOptions.sameSite,
        path: baseCookieOptions.path,
        ...(baseCookieOptions.domain && { domain: baseCookieOptions.domain }),
      },
    };

    // Prepare response data
    const response = {
      statusCode: 201,
      message: 'User registered successfully',
      user: {
        id: user.uid,
        name: user.uname,
        email: user.uemail,
        display_name: user.ufulllname,
      },
    };

    return {
      user,
      tokens,
      response,
      cookieOptions,
    };
  }

  async login(loginDto: LoginDto): Promise<{
    user: User;
    tokens: { access_token: string; refresh_token: string };
    response: {
      statusCode: number;
      message: string;
      user: {
        id: number;
        name: string;
        email: string;
        display_name: string;
      };
    };
    cookieOptions: {
      access_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none' | 'lax' | 'strict';
        path: string;
        domain?: string;
      };
      refresh_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none' | 'lax' | 'strict';
        path: string;
        domain?: string;
      };
    };
  }> {
    // Find user by email (can be uname or uemail)
    const user = await this.userRepository.findOne({
      where: [{ uname: loginDto.email }, { uemail: loginDto.email }],
    });

    if (!user) {
      throw new BadRequestException('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.upassword,
    );
    if (!isPasswordValid) {
      throw new BadRequestException('Invalid email or password');
    }

    // Check if user is blocked
    if (user.ustatus === UserStatus.BLOCK) {
      throw new BadRequestException(
        'Your account has been blocked. Please contact support for assistance.',
      );
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Prepare cookie options
    const accessTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    const refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Get cookie options with domain
    const baseCookieOptions = this.getCookieOptions();

    const cookieOptions = {
      access_token: {
        value: tokens.access_token,
        expires: accessTokenExpires,
        httpOnly: baseCookieOptions.httpOnly,
        secure: baseCookieOptions.secure,
        sameSite: baseCookieOptions.sameSite,
        path: baseCookieOptions.path,
        ...(baseCookieOptions.domain && { domain: baseCookieOptions.domain }),
      },
      refresh_token: {
        value: tokens.refresh_token,
        expires: refreshTokenExpires,
        httpOnly: baseCookieOptions.httpOnly,
        secure: baseCookieOptions.secure,
        sameSite: baseCookieOptions.sameSite,
        path: baseCookieOptions.path,
        ...(baseCookieOptions.domain && { domain: baseCookieOptions.domain }),
      },
    };

    // Prepare response data
    const response = {
      statusCode: 200,
      message: 'Login successful',
      user: {
        id: user.uid,
        name: user.uname,
        email: user.uemail,
        display_name: user.ufulllname,
      },
    };

    return {
      user,
      tokens,
      response,
      cookieOptions,
    };
  }

  async loginWithGoogle(googleLoginDto: GoogleLoginDto): Promise<{
    user: User;
    tokens: { access_token: string; refresh_token: string };
    response: {
      statusCode: number;
      message: string;
      user: {
        id: number;
        name: string;
        email: string;
        display_name: string;
      };
    };
    cookieOptions: {
      access_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none' | 'lax' | 'strict';
        path: string;
        domain?: string;
      };
      refresh_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none' | 'lax' | 'strict';
        path: string;
        domain?: string;
      };
    };
  }> {
    const path = googleLoginDto.path?.trim() || 'google-login';
    const tokenResponse = await this.googleAuthService.exchangeCodeForToken(
      googleLoginDto.code,
      path,
    );
    const googleUser = await this.googleAuthService.verifyIdToken(
      tokenResponse.id_token,
    );

    const sub = googleUser.sub as string;
    const email = googleUser.email as string;
    const displayName =
      googleUser.name?.trim() || email.split('@')[0] || 'User';
    const picture = googleUser.picture?.trim() || null;

    let user = await this.userRepository.findOne({
      where: { ugoogle_sub: sub },
    });

    if (user) {
      user.u_active_email = true;
      user.ufulllname = displayName;
      if (picture) user.uavatar = picture;
      await this.userRepository.save(user);
    } else {
      user = await this.userRepository.findOne({
        where: { uemail: email },
      });

      if (user) {
        if (user.ugoogle_sub && user.ugoogle_sub !== sub) {
          throw new ConflictException(
            'This email is already linked to another Google account',
          );
        }
        user.ugoogle_sub = sub;
        user.u_active_email = true;
        user.ufulllname = displayName;
        if (picture) user.uavatar = picture;
        await this.userRepository.save(user);
      } else {
        let newUref = this.generateUref();
        let existingUrefUser = await this.userRepository.findOne({
          where: { uref: newUref },
        });
        while (existingUrefUser) {
          newUref = this.generateUref();
          existingUrefUser = await this.userRepository.findOne({
            where: { uref: newUref },
          });
        }

        const hashedRandomPassword = await bcrypt.hash(
          randomBytes(32).toString('hex'),
          10,
        );
        const tempUname = `__g_${randomBytes(8).toString('hex')}`;

        const newUser = this.userRepository.create({
          uname: tempUname,
          uemail: email,
          uphone: null,
          utelegram: null,
          uggauth: null,
          ugoogle_sub: sub,
          upassword: hashedRandomPassword,
          uref: newUref,
          ufulllname: displayName,
          uavatar: picture,
          ubirthday: null,
          usex: UserSex.OTHER,
          u_active_email: true,
          u_active_ggauth: false,
          uverify: false,
          ulevel: 1,
          ukol: false,
          ustatus: UserStatus.ACTIVE,
        });

        user = await this.userRepository.save(newUser);

        let finalUname = `User_${user.uid}`;
        const unameTaken = await this.userRepository.findOne({
          where: { uname: finalUname },
        });
        if (unameTaken && unameTaken.uid !== user.uid) {
          finalUname = `User_${user.uid}_${randomBytes(4).toString('hex')}`;
        }
        user.uname = finalUname;
        await this.userRepository.save(user);
      }
    }

    if (user.ustatus === UserStatus.BLOCK) {
      throw new BadRequestException(
        'Your account has been blocked. Please contact support for assistance.',
      );
    }

    const tokens = await this.generateTokens(user);

    const accessTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
    const refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const baseCookieOptions = this.getCookieOptions();

    const cookieOptions = {
      access_token: {
        value: tokens.access_token,
        expires: accessTokenExpires,
        httpOnly: baseCookieOptions.httpOnly,
        secure: baseCookieOptions.secure,
        sameSite: baseCookieOptions.sameSite,
        path: baseCookieOptions.path,
        ...(baseCookieOptions.domain && { domain: baseCookieOptions.domain }),
      },
      refresh_token: {
        value: tokens.refresh_token,
        expires: refreshTokenExpires,
        httpOnly: baseCookieOptions.httpOnly,
        secure: baseCookieOptions.secure,
        sameSite: baseCookieOptions.sameSite,
        path: baseCookieOptions.path,
        ...(baseCookieOptions.domain && { domain: baseCookieOptions.domain }),
      },
    };

    const response = {
      statusCode: 200,
      message: 'Login with Google successful',
      user: {
        id: user.uid,
        name: user.uname,
        email: user.uemail,
        display_name: user.ufulllname,
      },
    };

    return {
      user,
      tokens,
      response,
      cookieOptions,
    };
  }

  async generateTokens(
    user: User,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const payload = {
      sub: user.uid,
      uname: user.uname,
      uemail: user.uemail,
    };

    const access_token = await this.jwtService.signAsync(payload, {
      expiresIn: '15m',
    });

    const refresh_token = await this.jwtService.signAsync(payload, {
      expiresIn: '7d',
    });

    return {
      access_token,
      refresh_token,
    };
  }

  async refreshToken(refreshToken: string): Promise<{
    user: User;
    tokens: { access_token: string; refresh_token: string };
    response: {
      statusCode: number;
      message: string;
      user: {
        id: number;
        name: string;
        email: string;
        display_name: string;
      };
    };
    cookieOptions: {
      access_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none' | 'lax' | 'strict';
        path: string;
        domain?: string;
      };
      refresh_token: {
        value: string;
        expires: Date;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'none' | 'lax' | 'strict';
        path: string;
        domain?: string;
      };
    };
  }> {
    if (!refreshToken || refreshToken.trim() === '') {
      throw new HttpException('Refresh token is required', 419);
    }

    try {
      // Verify refresh token
      const payload = await this.jwtService.verifyAsync(refreshToken);
      const userId = payload.sub;

      // Get user from database
      const user = await this.userRepository.findOne({
        where: { uid: userId },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Check if user is blocked
      if (user.ustatus === UserStatus.BLOCK) {
        throw new BadRequestException(
          'Your account has been blocked. Please contact support for assistance.',
        );
      }

      // Generate new tokens
      const tokens = await this.generateTokens(user);

      // Prepare cookie options
      const accessTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      const refreshTokenExpires = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ); // 7 days

      // Get cookie options with domain
      const baseCookieOptions = this.getCookieOptions();

      const cookieOptions = {
        access_token: {
          value: tokens.access_token,
          expires: accessTokenExpires,
          httpOnly: baseCookieOptions.httpOnly,
          secure: baseCookieOptions.secure,
          sameSite: baseCookieOptions.sameSite,
          path: baseCookieOptions.path,
          ...(baseCookieOptions.domain && { domain: baseCookieOptions.domain }),
        },
        refresh_token: {
          value: tokens.refresh_token,
          expires: refreshTokenExpires,
          httpOnly: baseCookieOptions.httpOnly,
          secure: baseCookieOptions.secure,
          sameSite: baseCookieOptions.sameSite,
          path: baseCookieOptions.path,
          ...(baseCookieOptions.domain && { domain: baseCookieOptions.domain }),
        },
      };

      // Prepare response data
      const response = {
        statusCode: 200,
        message: 'Token refreshed successfully',
        user: {
          id: user.uid,
          name: user.uname,
          email: user.uemail,
          display_name: user.ufulllname,
        },
      };

      return {
        user,
        tokens,
        response,
        cookieOptions,
      };
    } catch (error) {
      // Handle JWT verification errors
      if (error.name === 'TokenExpiredError') {
        throw new BadRequestException(
          'Refresh token has expired. Please login again.',
        );
      }
      if (error.name === 'JsonWebTokenError') {
        throw new BadRequestException('Invalid refresh token');
      }
      // Re-throw other errors (BadRequestException, etc.)
      throw error;
    }
  }

  async generateAndSendEmailVerificationCode(user: User): Promise<UserCode> {
    // Generate 6-character code (uppercase letters and numbers)
    const code = this.generateEmailCode();

    // Set expiration time: current time + 3 minutes
    const codeTime = new Date(Date.now() + 3 * 60 * 1000);

    // Create user code entity
    const userCode = this.userCodeRepository.create({
      uc_value: code,
      uc_type: UserCodeType.ACTIVE_EMAIL,
      uc_place: UserCodePlace.EMAIL,
      uc_code_time: codeTime,
      uc_life: true,
      uc_user_id: user.uid,
    });

    // Save user code to database
    const savedUserCode = await this.userCodeRepository.save(userCode);

    // Send email with verification code
    await this.emailService.sendEmailVerificationCode(user.uemail, code);

    return savedUserCode;
  }

  async generateCodeVerifyEmail(
    userId: number,
  ): Promise<{ message: string; code?: UserCode }> {
    // Get user and check if email is not activated
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Only process if email is not activated yet
    if (user.u_active_email) {
      throw new BadRequestException('Email is already activated');
    }

    const now = new Date();
    const cacheKey = `email_verify_code_sent_${userId}`;

    // Check if there's a valid active code
    const existingCode = await this.userCodeRepository.findOne({
      where: {
        uc_user_id: userId,
        uc_type: UserCodeType.ACTIVE_EMAIL,
        uc_life: true,
      },
      order: {
        created_at: 'DESC',
      },
    });

    // If code exists and is still valid (not expired)
    if (existingCode && existingCode.uc_code_time > now) {
      // Check cache for rate limiting
      const cachedTime = await this.cacheService.get(cacheKey);
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

      let canResend = false;

      if (cachedTime) {
        // If cache exists, check if more than 1 minute has passed
        const cachedDate = new Date(cachedTime);
        if (cachedDate < oneMinuteAgo) {
          canResend = true;
        }
      } else {
        // If no cache, check created_at of the code (first time check)
        if (existingCode.created_at < oneMinuteAgo) {
          canResend = true;
        }
      }

      if (canResend) {
        // Resend email with existing code
        await this.emailService.sendEmailVerificationCode(
          user.uemail,
          existingCode.uc_value,
        );

        // Update cache with current time (set to expire after 1 minute)
        await this.cacheService.set(cacheKey, now.toISOString(), 60);

        return {
          message: 'Verification code has been resent to your email',
          code: existingCode,
        };
      } else {
        return {
          message:
            'A valid verification code already exists. Please check your email. You can request a new code after 1 minute.',
          code: existingCode,
        };
      }
    }

    // If no valid code exists, generate and send new code
    const newCode = await this.generateAndSendEmailVerificationCode(user);

    // Set cache after sending new code
    await this.cacheService.set(cacheKey, now.toISOString(), 60);

    return {
      message: 'Verification code has been sent to your email',
      code: newCode,
    };
  }

  async verifyEmail(userId: number, code: string): Promise<User> {
    // Get user first and check if email is already activated
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Only process if email is not activated yet
    if (user.u_active_email) {
      throw new BadRequestException('Email is already activated');
    }

    // Find the user code
    const userCode = await this.userCodeRepository.findOne({
      where: {
        uc_user_id: userId,
        uc_value: code,
        uc_type: UserCodeType.ACTIVE_EMAIL,
        uc_life: true,
      },
    });

    if (!userCode) {
      throw new BadRequestException('Invalid verification code');
    }

    // Check if code is still valid (not expired)
    const now = new Date();
    if (userCode.uc_code_time < now) {
      // Mark code as expired
      userCode.uc_life = false;
      await this.userCodeRepository.save(userCode);
      throw new BadRequestException(
        'Verification code has expired. Please request a new one.',
      );
    }

    // Activate email and mark code as used
    user.u_active_email = true;
    userCode.uc_life = false;

    await this.userRepository.save(user);
    await this.userCodeRepository.save(userCode);

    // Create default user wallet with gift balance when email is activated
    await this.createDefaultUserWallet(userId);

    return user;
  }

  private generateEmailCode(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    return result;
  }

  async getCurrentUser(userId: number): Promise<{
    id: number;
    name: string;
    email: string;
    phone: string | null;
    telegram: string | null;
    ref: string;
    display_name: string;
    avatar: string | null;
    birthday: Date | null;
    sex: UserSex;
    active_email: boolean;
    active_ggauth: boolean;
    verify: boolean;
    level: number;
    kol: boolean;
    status: UserStatus;
    created_at: Date;
  }> {
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Return user info without sensitive data (no password, no uggauth)
    // Remove 'u' prefix from field names
    return {
      id: user.uid,
      name: user.uname,
      email: user.uemail,
      phone: user.uphone,
      telegram: user.utelegram,
      ref: user.uref,
      display_name: user.ufulllname,
      avatar: user.uavatar,
      birthday: user.ubirthday,
      sex: user.usex,
      active_email: user.u_active_email,
      active_ggauth: user.u_active_ggauth,
      verify: user.uverify,
      level: user.ulevel,
      kol: user.ukol,
      status: user.ustatus,
      created_at: user.created_at,
    };
  }

  private generateKycChallengeCode(): string {
    return String(randomInt(100_000, 100_000_000));
  }

  private getKycChallengeExpiresAt(): Date {
    const raw = this.configService.get<string>('KYC_CHALLENGE_TTL_MINUTES');
    const minutes = Math.max(1, parseInt(raw ?? '1440', 10) || 1440);
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  async getKycStatus(userId: number): Promise<{
    status:
      | 'verify'
      | 'retry'
      | 'pending'
      | 'not-verified'
      | 'awaiting_paper'
      | 'challenge_expired';
    notes?: Array<{ id: number; message: string | null }>;
    challenge_code?: string;
    challenge_expires_at?: Date;
  }> {
    // First, check uverify field of the user
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new InternalServerErrorException('User not found');
    }

    // If uverify = true, return verify immediately
    if (user.uverify === true) {
      return { status: 'verify' };
    }

    // If uverify = false, continue with existing logic
    // Get all KYC verifications for this user
    const verifications = await this.userVerifyRepository.find({
      where: {
        uv_user_id: userId,
      },
    });

    // Check in priority order:
    // 1. If at least one record has uv_status = "verify" → status = "verify"
    const hasVerify = verifications.some(
      (v) => v.uv_status === UserVerifyStatus.VERIFY,
    );

    if (hasVerify) {
      // Update uverify to true if at least one verification is verified
      user.uverify = true;
      await this.userRepository.save(user);
      return { status: 'verify' };
    }

    // 2. If no verify, check if at least one record has uv_status = "retry" → status = "retry"
    const hasRetry = verifications.some(
      (v) => v.uv_status === UserVerifyStatus.RETRY,
    );

    if (hasRetry) {
      // Get all retry verifications' uv_id
      const retryVerifications = verifications.filter(
        (v) => v.uv_status === UserVerifyStatus.RETRY,
      );
      const retryVerifyIds = retryVerifications.map((v) => v.uv_id);

      // Get all verify_logs for these uv_ids
      const verifyLogs = await this.verifyLogRepository.find({
        where: {
          vl_verify_id: In(retryVerifyIds),
        },
      });

      // Format notes with id (vl_id) and message (vl_note)
      const notes = verifyLogs.map((log) => ({
        id: log.vl_id,
        message: log.vl_note,
      }));

      return { status: 'retry', notes };
    }

    // 3. Awaiting paper proof (challenge step)
    const challengeRecords = verifications.filter(
      (v) => v.uv_status === UserVerifyStatus.CHALLENGE_PENDING,
    );
    if (challengeRecords.length > 0) {
      const challenge = challengeRecords.sort((a, b) => b.uv_id - a.uv_id)[0];
      const now = new Date();
      if (
        challenge.uv_challenge_expires_at &&
        now > challenge.uv_challenge_expires_at
      ) {
        return { status: 'challenge_expired' };
      }
      return {
        status: 'awaiting_paper',
        challenge_code: challenge.uv_challenge_code ?? undefined,
        challenge_expires_at: challenge.uv_challenge_expires_at ?? undefined,
      };
    }

    // 4. If no verify and retry, check if at least one record has uv_status = "pending" → status = "pending"
    const hasPending = verifications.some(
      (v) => v.uv_status === UserVerifyStatus.PENDING,
    );

    if (hasPending) {
      return { status: 'pending' };
    }

    // 5. If no verify, retry and pending → status = "not-verified"
    return { status: 'not-verified' };
  }

  async registerKol(
    userId: number,
    registerKolDto: RegisterKolDto,
  ): Promise<{
    kolRegister: KolRegister;
    response: {
      statusCode: number;
      message: string;
      kol_register: {
        id: number;
        name: string;
        facebook_url: string | null;
        x_url: string | null;
        group_telegram_url: string | null;
        youtube_url: string | null;
        website_url: string | null;
        status: KolRegisterStatus;
      };
    };
  }> {
    // Validate name (required)
    if (!registerKolDto.name || registerKolDto.name.trim() === '') {
      throw new BadRequestException('Name is required');
    }

    // Validate at least one URL is provided and not just whitespace
    const urls = [
      registerKolDto.facebookUrl,
      registerKolDto.xUrl,
      registerKolDto.groupTelegramUrl,
      registerKolDto.youtubeUrl,
      registerKolDto.websiteUrl,
    ];

    const validUrls = urls.filter((url) => url && url.trim() !== '');
    if (validUrls.length === 0) {
      throw new BadRequestException(
        'At least one URL (facebook_url, x_url, group_telegram_url, youtube_url, or website_url) must be provided and cannot be empty',
      );
    }

    // Get user from database
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new InternalServerErrorException(
        'User not found. This should not happen. Please contact support.',
      );
    }

    // Check if user already has ukol = true
    if (user.ukol === true) {
      throw new ConflictException('User is already a KOL');
    }

    // Get all KOL register records for this user
    const kolRegisters = await this.kolRegisterRepository.find({
      where: {
        kr_user_id: userId,
      },
    });

    // Check if there's a record with kr_status = success
    const successRecord = kolRegisters.find(
      (kr) => kr.kr_status === KolRegisterStatus.SUCCESS,
    );

    if (successRecord) {
      // Update ukol = true for user
      user.ukol = true;
      await this.userRepository.save(user);

      // Return existing success record
      return {
        kolRegister: successRecord,
        response: {
          statusCode: 200,
          message: 'User is already registered as KOL (status: success)',
          kol_register: {
            id: successRecord.kr_id,
            name: successRecord.kr_name,
            facebook_url: successRecord.kr_facebook_url,
            x_url: successRecord.kr_x_url,
            group_telegram_url: successRecord.kr_gruop_telegram_url,
            youtube_url: successRecord.kr_youtube_url,
            website_url: successRecord.kr_website_url,
            status: successRecord.kr_status,
          },
        },
      };
    }

    // Check if there's a record with kr_status = pending
    const pendingRecord = kolRegisters.find(
      (kr) => kr.kr_status === KolRegisterStatus.PENDING,
    );

    if (pendingRecord) {
      throw new ConflictException(
        'KOL registration request has already been submitted and is pending review',
      );
    }

    // If no success or pending record exists, create new record with status = pending
    const newKolRegister = this.kolRegisterRepository.create({
      kr_user_id: userId,
      kr_name: registerKolDto.name.trim(),
      kr_facebook_url: registerKolDto.facebookUrl?.trim() || null,
      kr_x_url: registerKolDto.xUrl?.trim() || null,
      kr_gruop_telegram_url: registerKolDto.groupTelegramUrl?.trim() || null,
      kr_youtube_url: registerKolDto.youtubeUrl?.trim() || null,
      kr_website_url: registerKolDto.websiteUrl?.trim() || null,
      kr_status: KolRegisterStatus.PENDING,
    });

    const savedKolRegister =
      await this.kolRegisterRepository.save(newKolRegister);

    return {
      kolRegister: savedKolRegister,
      response: {
        statusCode: 201,
        message: 'KOL registration request submitted successfully',
        kol_register: {
          id: savedKolRegister.kr_id,
          name: savedKolRegister.kr_name,
          facebook_url: savedKolRegister.kr_facebook_url,
          x_url: savedKolRegister.kr_x_url,
          group_telegram_url: savedKolRegister.kr_gruop_telegram_url,
          youtube_url: savedKolRegister.kr_youtube_url,
          website_url: savedKolRegister.kr_website_url,
          status: savedKolRegister.kr_status,
        },
      },
    };
  }

  async checkRegisterKol(userId: number): Promise<{
    status: 'success' | 'pending' | 'not-register';
  }> {
    // Get user from database
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new InternalServerErrorException(
        'User not found. This should not happen. Please contact support.',
      );
    }

    // First check: if ukol = true, return success
    if (user.ukol === true) {
      return { status: 'success' };
    }

    // If ukol = false, check kol_register table
    const pendingRecord = await this.kolRegisterRepository.findOne({
      where: {
        kr_user_id: userId,
        kr_status: KolRegisterStatus.PENDING,
      },
    });

    if (pendingRecord) {
      return { status: 'pending' };
    }

    // If no pending record found, return not-register
    return { status: 'not-register' };
  }

  async submitKyc(
    userId: number,
    kycDto: KycDto,
  ): Promise<{
    verification: UserVerify;
    response: {
      statusCode: number;
      message: string;
      challenge_code: string;
      challenge_expires_at: string;
      verification: {
        id: number;
        id_card_number: string;
        front_image: string;
        backside_image: string | null;
        status: UserVerifyStatus;
      };
    };
  }> {
    // Validate id_card_number
    if (!kycDto.idCardNumber || kycDto.idCardNumber.trim() === '') {
      throw new BadRequestException('ID card number is required');
    }

    if (!kycDto.frontImageUrl || !kycDto.backsideImageUrl) {
      throw new BadRequestException(
        'frontImageUrl and backsideImageUrl are required',
      );
    }

    // Check if user already has a KYC record
    const existingVerify = await this.userVerifyRepository.findOne({
      where: { uv_user_id: userId },
    });

    if (existingVerify) {
      throw new ConflictException(
        'KYC verification already exists for this user. Cannot submit again.',
      );
    }

    const challengeCode = this.generateKycChallengeCode();
    const challengeExpiresAt = this.getKycChallengeExpiresAt();

    // Create user verify record (step 1: documents only; user must upload paper photo next)
    let savedVerify: UserVerify;
    try {
      const userVerify = this.userVerifyRepository.create({
        uv_user_id: userId,
        uv_id_card_number: kycDto.idCardNumber.trim(),
        uv_front_image: kycDto.frontImageUrl.trim(),
        uv_backside_image: kycDto.backsideImageUrl.trim(),
        uv_status: UserVerifyStatus.CHALLENGE_PENDING,
        uv_challenge_code: challengeCode,
        uv_challenge_expires_at: challengeExpiresAt,
        uv_paper_image: null,
      });

      savedVerify = await this.userVerifyRepository.save(userVerify);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to save KYC verification record: ${error.message || 'Unknown error'}`,
      );
    }

    const response = {
      statusCode: 201,
      message:
        'CCCD đã nhận. Viết mã dưới đây lên giấy, cầm giấy chụp ảnh và gửi qua POST /users/kyc-paper.',
      challenge_code: savedVerify.uv_challenge_code!,
      challenge_expires_at: savedVerify.uv_challenge_expires_at!.toISOString(),
      verification: {
        id: savedVerify.uv_id,
        id_card_number: savedVerify.uv_id_card_number,
        front_image: savedVerify.uv_front_image,
        backside_image: savedVerify.uv_backside_image,
        status: savedVerify.uv_status,
      },
    };

    return {
      verification: savedVerify,
      response,
    };
  }

  async retryKyc(
    userId: number,
    kycDto: KycDto,
  ): Promise<{
    verification: UserVerify;
    response: {
      statusCode: number;
      message: string;
      challenge_code: string;
      challenge_expires_at: string;
      verification: {
        id: number;
        id_card_number: string;
        front_image: string;
        backside_image: string | null;
        status: UserVerifyStatus;
      };
    };
  }> {
    // Validate id_card_number
    if (!kycDto.idCardNumber || kycDto.idCardNumber.trim() === '') {
      throw new BadRequestException('ID card number is required');
    }

    if (!kycDto.frontImageUrl || !kycDto.backsideImageUrl) {
      throw new BadRequestException(
        'frontImageUrl and backsideImageUrl are required',
      );
    }

    // Check if user has a KYC record with status = 'retry'
    const existingVerify = await this.userVerifyRepository.findOne({
      where: {
        uv_user_id: userId,
        uv_status: UserVerifyStatus.RETRY,
      },
    });

    if (!existingVerify) {
      throw new BadRequestException(
        'No KYC verification with retry status found for this user',
      );
    }

    const challengeCode = this.generateKycChallengeCode();
    const challengeExpiresAt = this.getKycChallengeExpiresAt();

    let savedVerify: UserVerify;
    try {
      existingVerify.uv_id_card_number = kycDto.idCardNumber.trim();
      existingVerify.uv_front_image = kycDto.frontImageUrl.trim();
      existingVerify.uv_backside_image = kycDto.backsideImageUrl.trim();
      existingVerify.uv_status = UserVerifyStatus.CHALLENGE_PENDING;
      existingVerify.uv_challenge_code = challengeCode;
      existingVerify.uv_challenge_expires_at = challengeExpiresAt;
      existingVerify.uv_paper_image = null;

      savedVerify = await this.userVerifyRepository.save(existingVerify);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to update KYC verification record: ${error.message || 'Unknown error'}`,
      );
    }

    const response = {
      statusCode: 200,
      message:
        'ID card has been updated. Please write the code below on a piece of paper, hold it up, take a photo, and submit.',
      challenge_code: savedVerify.uv_challenge_code!,
      challenge_expires_at: savedVerify.uv_challenge_expires_at!.toISOString(),
      verification: {
        id: savedVerify.uv_id,
        id_card_number: savedVerify.uv_id_card_number,
        front_image: savedVerify.uv_front_image,
        backside_image: savedVerify.uv_backside_image,
        status: savedVerify.uv_status,
      },
    };

    return {
      verification: savedVerify,
      response,
    };
  }

  async submitKycPaper(
    userId: number,
    paperImageUrl: string,
  ): Promise<{
    verification: UserVerify;
    response: {
      statusCode: number;
      message: string;
      verification: {
        id: number;
        id_card_number: string;
        front_image: string;
        backside_image: string | null;
        paper_image: string | null;
        status: UserVerifyStatus;
      };
    };
  }> {
    if (!paperImageUrl || !paperImageUrl.trim()) {
      throw new BadRequestException('paperImageUrl is required');
    }

    const existingVerify = await this.userVerifyRepository.findOne({
      where: {
        uv_user_id: userId,
        uv_status: UserVerifyStatus.CHALLENGE_PENDING,
      },
    });

    if (!existingVerify) {
      throw new BadRequestException(
        'No active KYC challenge. Submit CCCD images first (POST /users/kyc or /users/kyc-retry).',
      );
    }

    const now = new Date();
    if (
      !existingVerify.uv_challenge_expires_at ||
      now > existingVerify.uv_challenge_expires_at
    ) {
      throw new BadRequestException(
        'Challenge code has expired. Call POST /users/kyc-renew-challenge to get a new code or contact support.',
      );
    }

    try {
      existingVerify.uv_paper_image = paperImageUrl.trim();
      existingVerify.uv_status = UserVerifyStatus.PENDING;
      const savedVerify = await this.userVerifyRepository.save(existingVerify);

      const response = {
        statusCode: 200,
        message: 'Paper proof received. Your KYC is pending admin review.',
        verification: {
          id: savedVerify.uv_id,
          id_card_number: savedVerify.uv_id_card_number,
          front_image: savedVerify.uv_front_image,
          backside_image: savedVerify.uv_backside_image,
          paper_image: savedVerify.uv_paper_image,
          status: savedVerify.uv_status,
        },
      };

      return { verification: savedVerify, response };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to save KYC paper proof: ${error.message || 'Unknown error'}`,
      );
    }
  }

  async renewKycChallenge(userId: number): Promise<{
    response: {
      statusCode: number;
      message: string;
      challenge_code: string;
      challenge_expires_at: string;
    };
  }> {
    const existingVerify = await this.userVerifyRepository.findOne({
      where: {
        uv_user_id: userId,
        uv_status: UserVerifyStatus.CHALLENGE_PENDING,
      },
    });

    if (!existingVerify) {
      throw new BadRequestException(
        'No KYC challenge in progress. Submit CCCD images first.',
      );
    }

    const now = new Date();
    if (
      existingVerify.uv_challenge_expires_at &&
      now <= existingVerify.uv_challenge_expires_at
    ) {
      throw new BadRequestException(
        'Challenge is still valid. Use the existing code or wait until it expires.',
      );
    }

    existingVerify.uv_challenge_code = this.generateKycChallengeCode();
    existingVerify.uv_challenge_expires_at = this.getKycChallengeExpiresAt();
    await this.userVerifyRepository.save(existingVerify);

    return {
      response: {
        statusCode: 200,
        message: 'New challenge code issued.',
        challenge_code: existingVerify.uv_challenge_code,
        challenge_expires_at:
          existingVerify.uv_challenge_expires_at!.toISOString(),
      },
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{
    statusCode: number;
    message: string;
  }> {
    // Validate email
    if (!resetPasswordDto.email || resetPasswordDto.email.trim() === '') {
      throw new BadRequestException('Email is required');
    }

    // Find user by email
    const user = await this.userRepository.findOne({
      where: { uemail: resetPasswordDto.email.trim() },
    });

    // Always return success message to prevent email enumeration
    // But only create token and send email if user exists
    if (!user) {
      return {
        statusCode: 200,
        message: 'If the email exists, a password reset link has been sent',
      };
    }

    const now = new Date();

    // Check if there's an existing valid reset password token
    const existingToken = await this.userCodeRepository.findOne({
      where: {
        uc_user_id: user.uid,
        uc_type: UserCodeType.RESET_PASSWORD,
        uc_life: true,
      },
      order: {
        created_at: 'DESC',
      },
    });

    // If token exists and is still valid (not expired)
    if (existingToken && existingToken.uc_code_time > now) {
      throw new BadRequestException(
        'A password reset token already exists and is still valid. Please check your email or wait until the token expires.',
      );
    }

    // Generate reset password token (128 characters: uppercase letters and numbers)
    const token = this.generateResetPasswordToken();

    // Set expiration time: current time + 3 minutes
    const tokenTime = new Date(Date.now() + 3 * 60 * 1000);

    // Create user code entity for reset password
    const userCode = this.userCodeRepository.create({
      uc_value: token,
      uc_type: UserCodeType.RESET_PASSWORD,
      uc_place: UserCodePlace.EMAIL,
      uc_code_time: tokenTime,
      uc_life: true,
      uc_user_id: user.uid,
    });

    // Save token to database
    await this.userCodeRepository.save(userCode);

    // Send password reset email with link
    await this.emailService.sendPasswordResetLink(user.uemail, token);

    return {
      statusCode: 200,
      message: 'If the email exists, a password reset link has been sent',
    };
  }

  async checkCode(
    userId: number,
    code: string,
  ): Promise<{
    statusCode: number;
    message: string;
    code: {
      id: number;
      value: string;
      type: UserCodeType;
      place: UserCodePlace | null;
      code_time: Date;
      life: boolean;
      created_at: Date;
      updated_at: Date;
    };
  }> {
    // Validate code
    if (!code || code.trim() === '') {
      throw new BadRequestException('Code is required');
    }

    // Find user code with matching user_id and code value
    const userCode = await this.userCodeRepository.findOne({
      where: {
        uc_user_id: userId,
        uc_value: code.trim(),
      },
    });

    if (!userCode) {
      throw new BadRequestException(
        'Invalid code. Code not found or does not belong to this user',
      );
    }

    // Prepare response (remove 'uc' prefix from field names)
    const response = {
      statusCode: 200,
      message: 'Code is valid',
      code: {
        id: userCode.uc_id,
        value: userCode.uc_value,
        type: userCode.uc_type,
        place: userCode.uc_place,
        code_time: userCode.uc_code_time,
        life: userCode.uc_life,
        created_at: userCode.created_at,
        updated_at: userCode.update_at,
      },
    };

    return response;
  }

  async setNewPassword(setNewPasswordDto: SetNewPasswordDto): Promise<{
    statusCode: number;
    message: string;
  }> {
    // Validate code
    if (!setNewPasswordDto.code || setNewPasswordDto.code.trim() === '') {
      throw new BadRequestException('Code is required');
    }

    // Validate password
    if (
      !setNewPasswordDto.password ||
      setNewPasswordDto.password.trim() === ''
    ) {
      throw new BadRequestException('Password is required');
    }

    // Check password minimum length (6 characters)
    if (setNewPasswordDto.password.length < 6) {
      throw new BadRequestException(
        'Password must be at least 6 characters long',
      );
    }

    const now = new Date();

    // Find user code with matching code value, type, and life status
    // Note: We find the code first, then get the user from the code
    const userCode = await this.userCodeRepository.findOne({
      where: {
        uc_value: setNewPasswordDto.code.trim(),
        uc_type: UserCodeType.RESET_PASSWORD,
        uc_life: true,
      },
    });

    if (!userCode) {
      throw new BadRequestException(
        'Invalid code. Code not found, is not a reset-password code, or has already been used',
      );
    }

    // Check if code is still valid (not expired)
    if (userCode.uc_code_time < now) {
      // Mark code as expired
      userCode.uc_life = false;
      await this.userCodeRepository.save(userCode);
      throw new BadRequestException(
        'Reset password code has expired. Please request a new password reset.',
      );
    }

    // Get user from the code's user_id
    const user = await this.userRepository.findOne({
      where: { uid: userCode.uc_user_id },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(setNewPasswordDto.password, 10);

    // Update user password
    user.upassword = hashedPassword;
    await this.userRepository.save(user);

    // Mark code as used (set uc_life to false)
    userCode.uc_life = false;
    await this.userCodeRepository.save(userCode);

    return {
      statusCode: 200,
      message: 'Password has been reset successfully',
    };
  }

  async changePassword(
    userId: number,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{
    statusCode: number;
    message: string;
  }> {
    // Validate current_password
    if (
      !changePasswordDto.currentPassword ||
      changePasswordDto.currentPassword.trim() === ''
    ) {
      throw new BadRequestException('Current password is required');
    }

    // Validate new_password
    if (
      !changePasswordDto.newPassword ||
      changePasswordDto.newPassword.trim() === ''
    ) {
      throw new BadRequestException('New password is required');
    }

    // Check new password minimum length (6 characters)
    if (changePasswordDto.newPassword.length < 6) {
      throw new BadRequestException(
        'New password must be at least 6 characters long',
      );
    }

    // Get user
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.upassword,
    );

    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    requireTotpIfEnabled(user, changePasswordDto.twoFactorCode);

    // Hash new password
    const hashedPassword = await bcrypt.hash(changePasswordDto.newPassword, 10);

    // Update user password
    user.upassword = hashedPassword;
    await this.userRepository.save(user);

    return {
      statusCode: 200,
      message: 'Password has been changed successfully',
    };
  }

  async updateProfile(
    userId: number,
    updateProfileDto: UpdateProfileDto,
  ): Promise<{
    statusCode: number;
    message: string;
    user: {
      id: number;
      display_name: string;
      birthday: Date | null;
      sex: UserSex;
    };
  }> {
    // Get user (user should exist as JWT strategy already validated)
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    // This should not happen as JWT strategy already validated user exists
    // But keep check for safety (race condition case)
    if (!user) {
      throw new InternalServerErrorException(
        'User not found. This should not happen. Please contact support.',
      );
    }

    // Update display_name (ufulllname) if provided
    if (updateProfileDto.displayName !== undefined) {
      const trimmedDisplayName = updateProfileDto.displayName.trim();
      if (trimmedDisplayName === '') {
        throw new BadRequestException('Display name cannot be empty');
      }
      user.ufulllname = trimmedDisplayName;
    }

    // Update birthday if provided
    if (updateProfileDto.birthday !== undefined) {
      if (
        updateProfileDto.birthday &&
        updateProfileDto.birthday.trim() !== ''
      ) {
        user.ubirthday = new Date(updateProfileDto.birthday);
      } else {
        user.ubirthday = null;
      }
    }

    // Update sex if provided
    if (updateProfileDto.sex !== undefined) {
      user.usex = updateProfileDto.sex as UserSex;
    }

    // Save updated user
    const updatedUser = await this.userRepository.save(user);

    return {
      statusCode: 200,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.uid,
        display_name: updatedUser.ufulllname,
        birthday: updatedUser.ubirthday,
        sex: updatedUser.usex,
      },
    };
  }

  async logout(
    userId: number | null,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    statusCode: number;
    message: string;
  }> {
    // If user is authenticated, log the logout action
    if (userId) {
      try {
        const user = await this.userRepository.findOne({
          where: { uid: userId },
        });

        if (user) {
          // Create logout log
          const logoutLog = this.userLogRepository.create({
            log_user_id: userId,
            log_type: UserLogType.LOGOUT,
            log_level: UserLogLevel.INFO,
            log_title: 'User Logout',
            log_message: `User ${user.uname} (${user.uemail}) logged out successfully`,
            log_data: null,
            log_ip_address: ipAddress || null,
            log_user_agent: userAgent || null,
          });

          await this.userLogRepository.save(logoutLog);
        }
      } catch (error) {
        // Log error but don't fail the logout process
        console.error('Error creating logout log:', error);
      }
    }

    return {
      statusCode: 200,
      message: 'Logged out successfully',
    };
  }

  /**
   * Create user wallets for all coins when email is activated
   * Creates a wallet for each coin in the database with uw_wallet_type = 'crypto'
   * Checks for existing wallets to avoid duplicates
   * @param userId - The user's ID
   */
  private async createDefaultUserWallet(userId: number): Promise<void> {
    // Get all coins from database
    const coins = await this.coinRepository.find({
      order: {
        coin_id: 'ASC',
      },
    });

    if (coins.length === 0) {
      // No coins in database, skip wallet creation
      return;
    }

    // Get all existing wallets for this user to avoid duplicates
    const existingWallets = await this.userWalletRepository.find({
      where: {
        uw_user_id: userId,
      },
    });

    // Create a set of existing coin IDs for quick lookup
    const existingCoinIds = new Set(
      existingWallets
        .map((w) => w.uw_wallet_coins)
        .filter((coinId): coinId is number => coinId !== null),
    );

    // Create wallets for each coin that doesn't exist yet
    const walletsToCreate: UserWallet[] = [];

    for (const coin of coins) {
      // Skip if wallet for this coin already exists
      if (existingCoinIds.has(coin.coin_id)) {
        continue;
      }

      // Create wallet for this coin
      const wallet = this.userWalletRepository.create({
        uw_user_id: userId,
        uw_wallet_type: WalletType.CRYPTO,
        uw_wallet_coins: coin.coin_id,
        uw_balance: 0,
      });

      walletsToCreate.push(wallet);
    }

    // Save all wallets in batch
    if (walletsToCreate.length > 0) {
      await this.userWalletRepository.save(walletsToCreate);
    }
  }

  private generateResetPasswordToken(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 128; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    return result;
  }

  private generateUref(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    return result;
  }

  /**
   * Submit KOL article (link bài viết) sau khi user đã trở thành KOL
   * Dữ liệu được lưu vào bảng kol_articles
   * @param userId - ID của user
   * @param submitKolArticleDto - DTO chứa article_url
   * @returns KolArticle entity đã được tạo
   */
  async submitKolArticle(
    userId: number,
    submitKolArticleDto: SubmitKolArticleDto,
  ): Promise<{
    kolArticle: KolArticle;
    response: {
      statusCode: number;
      message: string;
      kol_article: {
        id: number;
        user_id: number;
        article_url: string;
        status: KolArticleStatus;
        created_at: Date;
      };
    };
  }> {
    // 1. Kiểm tra user có tồn tại và là KOL không
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      select: ['uid', 'ukol'],
    });

    if (!user) {
      throw new InternalServerErrorException(
        'User not found. This should not happen. Please contact support.',
      );
    }

    // 2. Kiểm tra user có phải là KOL không
    if (!user.ukol) {
      throw new BadRequestException(
        'User is not a KOL. Please register as KOL first.',
      );
    }

    // 3. Validate article_url
    if (
      !submitKolArticleDto.articleUrl ||
      submitKolArticleDto.articleUrl.trim() === ''
    ) {
      throw new BadRequestException('Article URL is required');
    }

    // 4. Tạo record mới trong kol_articles với status = pending
    const kolArticle = this.kolArticleRepository.create({
      ka_user_id: userId,
      ka_article_url: submitKolArticleDto.articleUrl.trim(),
      ka_status: KolArticleStatus.PENDING,
    });

    const savedKolArticle = await this.kolArticleRepository.save(kolArticle);

    return {
      kolArticle: savedKolArticle,
      response: {
        statusCode: 201,
        message: 'KOL article submitted successfully',
        kol_article: {
          id: savedKolArticle.ka_id,
          user_id: savedKolArticle.ka_user_id,
          article_url: savedKolArticle.ka_article_url,
          status: savedKolArticle.ka_status,
          created_at: savedKolArticle.created_at,
        },
      },
    };
  }

  /**
   * Lấy tổng số lượng users (API public)
   * @returns Tổng số users trong hệ thống
   */
  async getTotalUsers(): Promise<number> {
    return await this.userRepository.count();
  }

  /**
   * Lấy danh sách KOL articles của user hiện tại
   * @param userId - ID của user
   * @param status - Filter theo status (optional)
   * @returns Danh sách KOL articles của user
   */
  async getUserKolArticles(
    userId: number,
    status?: string,
  ): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      id: number;
      article_url: string;
      status: KolArticleStatus;
      created_at: Date;
    }>;
  }> {
    const queryBuilder = this.kolArticleRepository
      .createQueryBuilder('ka')
      .where('ka.ka_user_id = :userId', { userId })
      .orderBy('ka.created_at', 'DESC');

    // Filter theo status
    if (status) {
      const validStatuses = [
        KolArticleStatus.PENDING,
        KolArticleStatus.APPROVED,
        KolArticleStatus.REJECTED,
      ];

      let matchedStatus: KolArticleStatus | null = null;
      for (const validStatus of validStatuses) {
        if (validStatus.toLowerCase() === status.toLowerCase()) {
          matchedStatus = validStatus;
          break;
        }
      }

      if (matchedStatus) {
        queryBuilder.andWhere('ka.ka_status = :status', {
          status: matchedStatus,
        });
      }
    }

    const kolArticles = await queryBuilder.getMany();

    return {
      statusCode: 200,
      message: 'Get KOL articles successfully',
      data: kolArticles.map((ka) => ({
        id: ka.ka_id,
        article_url: ka.ka_article_url,
        status: ka.ka_status,
        created_at: ka.created_at,
      })),
    };
  }
}
