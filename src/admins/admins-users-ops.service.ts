import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User, UserSex, UserStatus } from '../users/entities/user.entity';
import {
  KolRegister,
  KolRegisterStatus,
} from '../users/entities/kol-register.entity';
import {
  KolArticle,
  KolArticleStatus,
} from '../users/entities/kol-article.entity';
import {
  AdminLog,
  AdminLogAction,
  AdminLogModule,
} from './entities/admin-log.entity';

@Injectable()
export class AdminsUsersOpsService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(KolRegister)
    private kolRegisterRepository: Repository<KolRegister>,
    @InjectRepository(KolArticle)
    private kolArticleRepository: Repository<KolArticle>,
    @InjectRepository(AdminLog)
    private adminLogRepository: Repository<AdminLog>,
  ) {}

  async getUsersPaginated(
    page = 1,
    limit = 30,
  ): Promise<{
    statusCode: number;
    data: Array<{
      uid: number;
      uname: string;
      email: string;
      phone: string | null;
      avatar: string | null;
      display_name: string;
      birthday: Date | null;
      sex: UserSex;
      level: number;
      status: UserStatus;
      telegram: string | null;
      ref: string;
      active_email: boolean;
      verify: boolean;
      kol: boolean;
      created_at: Date;
    }>;
    meta: {
      page: number;
      limit: number;
      total: number;
      total_pages: number;
    };
  }> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const currentPage = Math.max(page, 1);
    const skip = (currentPage - 1) * safeLimit;

    const [items, total] = await this.userRepository.findAndCount({
      select: [
        'uid',
        'uname',
        'uemail',
        'uphone',
        'uavatar',
        'ufulllname',
        'ubirthday',
        'usex',
        'ulevel',
        'ustatus',
        'utelegram',
        'uref',
        'u_active_email',
        'uverify',
        'ukol',
        'created_at',
      ],
      order: { created_at: 'DESC' },
      skip,
      take: safeLimit,
    });

    const mapped = items.map((u) => ({
      uid: u.uid,
      uname: u.uname,
      email: u.uemail,
      phone: u.uphone,
      avatar: u.uavatar,
      display_name: u.ufulllname,
      birthday: u.ubirthday,
      sex: u.usex,
      level: u.ulevel,
      status: u.ustatus,
      telegram: u.utelegram,
      ref: u.uref,
      active_email: u.u_active_email,
      verify: u.uverify,
      kol: u.ukol,
      created_at: u.created_at,
    }));

    return {
      statusCode: 200,
      data: mapped,
      meta: {
        page: currentPage,
        limit: safeLimit,
        total,
        total_pages: Math.ceil(total / safeLimit) || 1,
      },
    };
  }

  async getUserById(uid: number): Promise<{
    statusCode: number;
    data: {
      uid: number;
      uname: string;
      email: string;
      phone: string | null;
      avatar: string | null;
      display_name: string;
      birthday: Date | null;
      sex: UserSex;
      level: number;
      status: UserStatus;
      telegram: string | null;
      ref: string;
      active_email: boolean;
      verify: boolean;
      kol: boolean;
      created_at: Date;
    };
  }> {
    if (!uid || Number.isNaN(uid)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userRepository.findOne({
      select: [
        'uid',
        'uname',
        'uemail',
        'uphone',
        'uavatar',
        'ufulllname',
        'ubirthday',
        'usex',
        'ulevel',
        'ustatus',
        'utelegram',
        'uref',
        'u_active_email',
        'uverify',
        'ukol',
        'created_at',
      ],
      where: { uid },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const mapped = {
      uid: user.uid,
      uname: user.uname,
      email: user.uemail,
      phone: user.uphone,
      avatar: user.uavatar,
      display_name: user.ufulllname,
      birthday: user.ubirthday,
      sex: user.usex,
      level: user.ulevel,
      status: user.ustatus,
      telegram: user.utelegram,
      ref: user.uref,
      active_email: user.u_active_email,
      verify: user.uverify,
      kol: user.ukol,
      created_at: user.created_at,
    };

    return {
      statusCode: 200,
      data: mapped,
    };
  }

  async toggleUserKol(
    uid: number,
    status?: 'success' | 'fail',
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      uid: number;
      kol: boolean;
    };
  }> {
    if (!uid || Number.isNaN(uid)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userRepository.findOne({
      select: ['uid', 'ukol'],
      where: { uid },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Determine new kol value
    let newKol: boolean;
    if (status !== undefined) {
      // If status is provided, set ukol based on status
      // success -> true, fail -> false
      newKol = status === 'success';
    } else {
      // If status is not provided, toggle (xen kẽ)
      newKol = !user.ukol;
    }

    // If status is provided, always update kol_registers based on status
    if (status !== undefined) {
      if (status === 'fail' && newKol === false) {
        // Update all kol_registers with status = success to fail
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.SUCCESS,
          },
          {
            kr_status: KolRegisterStatus.FAIL,
          },
        );

        // Update all kol_registers with status = pending to fail
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.PENDING,
          },
          {
            kr_status: KolRegisterStatus.FAIL,
          },
        );
      } else if (status === 'success' && newKol === true) {
        // Update all kol_registers with status = pending to success
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.PENDING,
          },
          {
            kr_status: KolRegisterStatus.SUCCESS,
          },
        );
      }
    } else {
      // If status is not provided (toggle mode), update kol_registers only when value changes
      // If changing from true to false, update kol_registers
      if (user.ukol === true && newKol === false) {
        // Update all kol_registers with status = success to fail
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.SUCCESS,
          },
          {
            kr_status: KolRegisterStatus.FAIL,
          },
        );

        // Update all kol_registers with status = pending to fail
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.PENDING,
          },
          {
            kr_status: KolRegisterStatus.FAIL,
          },
        );
      }

      // If changing from false to true, update kol_registers
      if (user.ukol === false && newKol === true) {
        // Update all kol_registers with status = pending to success
        await this.kolRegisterRepository.update(
          {
            kr_user_id: uid,
            kr_status: KolRegisterStatus.PENDING,
          },
          {
            kr_status: KolRegisterStatus.SUCCESS,
          },
        );
      }
    }

    await this.userRepository.update({ uid }, { ukol: newKol });

    return {
      statusCode: 200,
      message: 'User kol flag updated successfully',
      data: {
        uid: user.uid,
        kol: newKol,
      },
    };
  }

  async getKolRegisters(status?: string): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      kr_id: number;
      kr_user_id: number;
      kr_name: string;
      kr_facebook_url: string | null;
      kr_x_url: string | null;
      kr_gruop_telegram_url: string | null;
      kr_youtube_url: string | null;
      kr_website_url: string | null;
      kr_status: KolRegisterStatus;
      user: {
        uid: number;
        uname: string;
        ufulllname: string;
        uemail: string;
        uphone: string | null;
        uavatar: string | null;
      };
    }>;
  }> {
    // Build query with status filter (default to pending if not provided)
    const queryBuilder = this.kolRegisterRepository
      .createQueryBuilder('kr')
      .leftJoinAndSelect('kr.user', 'user')
      .select([
        'kr.kr_id',
        'kr.kr_user_id',
        'kr.kr_name',
        'kr.kr_facebook_url',
        'kr.kr_x_url',
        'kr.kr_gruop_telegram_url',
        'kr.kr_youtube_url',
        'kr.kr_website_url',
        'kr.kr_status',
        'user.uid',
        'user.uname',
        'user.ufulllname',
        'user.uemail',
        'user.uphone',
        'user.uavatar',
      ])
      .orderBy('kr.kr_id', 'DESC');

    // Filter by status (default to pending if not provided)
    const filterStatus = status || KolRegisterStatus.PENDING;

    // Validate status
    const validStatuses = [
      KolRegisterStatus.PENDING,
      KolRegisterStatus.SUCCESS,
      KolRegisterStatus.FAIL,
    ];

    // Check if status matches enum (case-insensitive)
    const normalizedStatus = filterStatus.toLowerCase();
    let matchedStatus: KolRegisterStatus | null = null;

    for (const validStatus of validStatuses) {
      if (validStatus.toLowerCase() === normalizedStatus) {
        matchedStatus = validStatus;
        break;
      }
    }

    // If status is provided but doesn't match, default to pending
    const finalStatus = matchedStatus || KolRegisterStatus.PENDING;
    queryBuilder.where('kr.kr_status = :status', { status: finalStatus });

    const kolRegisters = await queryBuilder.getMany();

    // Format response
    const formattedData = kolRegisters.map((kr) => ({
      kr_id: kr.kr_id,
      kr_user_id: kr.kr_user_id,
      kr_name: kr.kr_name,
      kr_facebook_url: kr.kr_facebook_url,
      kr_x_url: kr.kr_x_url,
      kr_gruop_telegram_url: kr.kr_gruop_telegram_url,
      kr_youtube_url: kr.kr_youtube_url,
      kr_website_url: kr.kr_website_url,
      kr_status: kr.kr_status,
      user: {
        uid: kr.user.uid,
        uname: kr.user.uname,
        ufulllname: kr.user.ufulllname,
        uemail: kr.user.uemail,
        uphone: kr.user.uphone,
        uavatar: kr.user.uavatar,
      },
    }));

    return {
      statusCode: 200,
      message: 'KOL registers retrieved successfully',
      data: formattedData,
    };
  }

  async updateUserStatus(
    uid: number,
    status: UserStatus,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      uid: number;
      status: UserStatus;
    };
  }> {
    if (!uid || Number.isNaN(uid)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userRepository.findOne({
      select: ['uid', 'ustatus'],
      where: { uid },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const oldStatus = user.ustatus;
    await this.userRepository.update({ uid }, { ustatus: status });

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.USERS,
      log_description: `Admin updated user status: user_id=${uid}, old_status=${oldStatus}, new_status=${status}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: uid,
      log_target_type: 'user',
      log_old_data: { status: oldStatus },
      log_new_data: { status },
    });

    return {
      statusCode: 200,
      message: 'User status updated successfully',
      data: {
        uid: user.uid,
        status,
      },
    };
  }
  async getKolArticles(
    status?: string,
    userId?: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      ka_id: number;
      ka_user_id: number;
      ka_article_url: string;
      ka_status: KolArticleStatus;
      created_at: Date;
      user: {
        uid: number;
        uname: string;
        ufulllname: string;
        uemail: string;
        uphone: string | null;
        uavatar: string | null;
      };
    }>;
  }> {
    const queryBuilder = this.kolArticleRepository
      .createQueryBuilder('ka')
      .leftJoinAndSelect('ka.user', 'user')
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

      const finalStatus = matchedStatus || KolArticleStatus.PENDING;
      queryBuilder.andWhere('ka.ka_status = :status', { status: finalStatus });
    }

    // Filter theo user_id
    if (userId && !Number.isNaN(userId)) {
      queryBuilder.andWhere('ka.ka_user_id = :userId', { userId });
    }

    const kolArticles = await queryBuilder.getMany();

    const formattedData = kolArticles.map((ka) => ({
      ka_id: ka.ka_id,
      ka_user_id: ka.ka_user_id,
      ka_article_url: ka.ka_article_url,
      ka_status: ka.ka_status,
      created_at: ka.created_at,
      user: {
        uid: ka.user.uid,
        uname: ka.user.uname,
        ufulllname: ka.user.ufulllname,
        uemail: ka.user.uemail,
        uphone: ka.user.uphone,
        uavatar: ka.user.uavatar,
      },
    }));

    return {
      statusCode: 200,
      message: 'KOL articles retrieved successfully',
      data: formattedData,
    };
  }

  /**
   * Cập nhật status của KOL article
   * @param articleId - ID của article
   * @param status - Status mới
   * @param adminId - ID của admin thực hiện
   * @returns KOL article đã được cập nhật
   */
  async updateKolArticleStatus(
    articleId: number,
    status: KolArticleStatus,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      ka_id: number;
      ka_user_id: number;
      ka_article_url: string;
      ka_status: KolArticleStatus;
      created_at: Date;
    };
  }> {
    if (!articleId || Number.isNaN(articleId)) {
      throw new BadRequestException('Invalid article id');
    }

    const kolArticle = await this.kolArticleRepository.findOne({
      where: { ka_id: articleId },
    });

    if (!kolArticle) {
      throw new NotFoundException('KOL article not found');
    }

    const oldStatus = kolArticle.ka_status;
    kolArticle.ka_status = status;
    await this.kolArticleRepository.save(kolArticle);

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.USERS,
      log_description: `Admin updated KOL article status: article_id=${articleId}, old_status=${oldStatus}, new_status=${status}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: articleId,
      log_target_type: 'kol_article',
      log_old_data: { status: oldStatus },
      log_new_data: { status },
    });

    return {
      statusCode: 200,
      message: 'KOL article status updated successfully',
      data: {
        ka_id: kolArticle.ka_id,
        ka_user_id: kolArticle.ka_user_id,
        ka_article_url: kolArticle.ka_article_url,
        ka_status: kolArticle.ka_status,
        created_at: kolArticle.created_at,
      },
    };
  }

}
