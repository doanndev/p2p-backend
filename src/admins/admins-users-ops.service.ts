import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserSex, UserStatus } from '../users/entities/user.entity';
import { BankUser } from '../users/entities/bank-user.entity';
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
import {
  Transaction,
  TransactionStatus,
} from '../orderbook/entities/transaction.entity';
import { OrderbookService } from '../orderbook/orderbook.service';
import { TransactionService } from '../orderbook/transaction.service';
import {
  WalletHistory,
  WalletHistoryOption,
  WalletHistoryStatus,
} from '../wallets/entities/wallet-history.entity';

@Injectable()
export class AdminsUsersOpsService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(BankUser)
    private bankUserRepository: Repository<BankUser>,
    @InjectRepository(KolRegister)
    private kolRegisterRepository: Repository<KolRegister>,
    @InjectRepository(KolArticle)
    private kolArticleRepository: Repository<KolArticle>,
    @InjectRepository(AdminLog)
    private adminLogRepository: Repository<AdminLog>,
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    @InjectRepository(WalletHistory)
    private walletHistoryRepository: Repository<WalletHistory>,
    private readonly transactionService: TransactionService,
    private readonly orderbookService: OrderbookService,
  ) {}

  async getUsersPaginated(
    page = 1,
    limit = 30,
    sortBy:
      | 'created_at'
      | 'total_transactions'
      | 'total_transaction_amount'
      | 'executed_transactions'
      | 'total_deposit'
      | 'total_withdraw' = 'created_at',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
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
      transaction_stats: {
        total_transaction_amount: number;
        executed_transactions: number;
      };
      wallet_stats: {
        total_deposit: number;
        total_withdraw: number;
      };
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
    const orderDirection = sortOrder === 'ASC' ? 'ASC' : 'DESC';
    const sortableColumns = {
      created_at: 'u.created_at',
      total_transactions: 'total_transaction_amount',
      total_transaction_amount: 'total_transaction_amount',
      executed_transactions: 'executed_transactions',
      total_deposit: 'total_deposit',
      total_withdraw: 'total_withdraw',
    } as const;
    const orderColumn = sortableColumns[sortBy] ?? sortableColumns.created_at;

    const [rawItems, total] = await Promise.all([
      this.userRepository
        .createQueryBuilder('u')
        .select('u.uid', 'uid')
        .addSelect('u.uname', 'uname')
        .addSelect('u.uemail', 'uemail')
        .addSelect('u.uphone', 'uphone')
        .addSelect('u.uavatar', 'uavatar')
        .addSelect('u.ufulllname', 'ufulllname')
        .addSelect('u.ubirthday', 'ubirthday')
        .addSelect('u.usex', 'usex')
        .addSelect('u.ulevel', 'ulevel')
        .addSelect('u.ustatus', 'ustatus')
        .addSelect('u.utelegram', 'utelegram')
        .addSelect('u.uref', 'uref')
        .addSelect('u.u_active_email', 'u_active_email')
        .addSelect('u.uverify', 'uverify')
        .addSelect('u.ukol', 'ukol')
        .addSelect('u.created_at', 'created_at')
        .addSelect(
          'COALESCE(tx_stats.total_transaction_amount, 0)',
          'total_transaction_amount',
        )
        .addSelect(
          'COALESCE(tx_stats.executed_transactions, 0)',
          'executed_transactions',
        )
        .addSelect('COALESCE(wallet_stats.total_deposit, 0)', 'total_deposit')
        .addSelect('COALESCE(wallet_stats.total_withdraw, 0)', 'total_withdraw')
        .leftJoin(
          (qb) =>
            qb
              .from(Transaction, 't')
              .select('tx_u.uid', 'user_id')
              .addSelect('SUM(t.trans_amount)', 'total_transaction_amount')
              .addSelect(
                'SUM(CASE WHEN t.trans_status = :executedStatus THEN 1 ELSE 0 END)',
                'executed_transactions',
              )
              .innerJoin(
                User,
                'tx_u',
                '(tx_u.uid = t.trans_user_buy OR tx_u.uid = t.trans_user_sell)',
              )
              .groupBy('tx_u.uid'),
          'tx_stats',
          'tx_stats.user_id = u.uid',
        )
        .leftJoin(
          (qb) =>
            qb
              .from(WalletHistory, 'wh')
              .select('wh.wh_user', 'user_id')
              .addSelect(
                'SUM(CASE WHEN wh.wh_option = :depositOpt THEN wh.wh_amount ELSE 0 END)',
                'total_deposit',
              )
              .addSelect(
                'SUM(CASE WHEN wh.wh_option = :withdrawOpt THEN wh.wh_amount ELSE 0 END)',
                'total_withdraw',
              )
              .where('wh.wh_status = :successStatus')
              .groupBy('wh.wh_user'),
          'wallet_stats',
          'wallet_stats.user_id = u.uid',
        )
        .setParameters({
          executedStatus: TransactionStatus.EXECUTED,
          depositOpt: WalletHistoryOption.DEPOSIT,
          withdrawOpt: WalletHistoryOption.WITHDRAW,
          successStatus: WalletHistoryStatus.SUCCESS,
        })
        .orderBy(orderColumn, orderDirection)
        .addOrderBy('u.created_at', 'DESC')
        .offset(skip)
        .limit(safeLimit)
        .getRawMany<{
          uid: string;
          uname: string;
          uemail: string;
          uphone: string | null;
          uavatar: string | null;
          ufulllname: string;
          ubirthday: Date | null;
          usex: UserSex;
          ulevel: string;
          ustatus: UserStatus;
          utelegram: string | null;
          uref: string;
          u_active_email: boolean | string;
          uverify: boolean | string;
          ukol: boolean | string;
          created_at: Date;
          total_transaction_amount: string | null;
          executed_transactions: string;
          total_deposit: string | null;
          total_withdraw: string | null;
        }>(),
      this.userRepository.count(),
    ]);

    const mapped = rawItems.map((u) => ({
      uid: Number(u.uid),
      uname: u.uname,
      email: u.uemail,
      phone: u.uphone,
      avatar: u.uavatar,
      display_name: u.ufulllname,
      birthday: u.ubirthday,
      sex: u.usex,
      level: Number(u.ulevel),
      status: u.ustatus,
      telegram: u.utelegram,
      ref: u.uref,
      active_email: u.u_active_email === true || u.u_active_email === 'true',
      verify: u.uverify === true || u.uverify === 'true',
      kol: u.ukol === true || u.ukol === 'true',
      transaction_stats: {
        total_transaction_amount: Number(u.total_transaction_amount ?? 0),
        executed_transactions: Number(u.executed_transactions) || 0,
      },
      wallet_stats: {
        total_deposit: Number(u.total_deposit ?? 0),
        total_withdraw: Number(u.total_withdraw ?? 0),
      },
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
      transaction_stats: {
        total_transactions: number;
        executed_transactions: number;
      };
      wallet_stats: {
        total_deposit: number;
        total_withdraw: number;
      };
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
      transaction_stats: {
        total_transactions: 0,
        executed_transactions: 0,
      },
      wallet_stats: {
        total_deposit: 0,
        total_withdraw: 0,
      },
      created_at: user.created_at,
    };

    const [txStatsRaw, walletStatsRaw] = await Promise.all([
      this.transactionRepository
        .createQueryBuilder('t')
        .select('COUNT(t.trans_id)', 'totalTransactions')
        .addSelect(
          `SUM(CASE WHEN t.trans_status = :executed THEN 1 ELSE 0 END)`,
          'executedTransactions',
        )
        .where('(t.trans_user_buy = :uid OR t.trans_user_sell = :uid)', { uid })
        .setParameter('executed', TransactionStatus.EXECUTED)
        .getRawOne<{
          totalTransactions: string | null;
          executedTransactions: string | null;
        }>(),
      this.walletHistoryRepository
        .createQueryBuilder('wh')
        .select(
          `SUM(CASE WHEN wh.wh_option = :depositOpt THEN wh.wh_amount ELSE 0 END)`,
          'totalDeposit',
        )
        .addSelect(
          `SUM(CASE WHEN wh.wh_option = :withdrawOpt THEN wh.wh_amount ELSE 0 END)`,
          'totalWithdraw',
        )
        .where('wh.wh_user = :uid', { uid })
        .andWhere('wh.wh_status = :successStatus', {
          successStatus: WalletHistoryStatus.SUCCESS,
        })
        .setParameters({
          depositOpt: WalletHistoryOption.DEPOSIT,
          withdrawOpt: WalletHistoryOption.WITHDRAW,
        })
        .getRawOne<{
          totalDeposit: string | null;
          totalWithdraw: string | null;
        }>(),
    ]);

    mapped.transaction_stats = {
      total_transactions: Number(txStatsRaw?.totalTransactions ?? 0),
      executed_transactions: Number(txStatsRaw?.executedTransactions ?? 0),
    };
    mapped.wallet_stats = {
      total_deposit: Number(walletStatsRaw?.totalDeposit ?? 0),
      total_withdraw: Number(walletStatsRaw?.totalWithdraw ?? 0),
    };

    return {
      statusCode: 200,
      data: mapped,
    };
  }

  async getUsersNeedLevelUp(): Promise<{
    statusCode: number;
    data: Array<{
      uid: number;
      uname: string;
      email: string;
      display_name: string;
      level: number;
      need_levelup: boolean;
      current_cycle_active_days: number;
      last_actived_day: Date | null;
      created_at: Date;
    }>;
  }> {
    const users = await this.userRepository.find({
      select: [
        'uid',
        'uname',
        'uemail',
        'ufulllname',
        'ulevel',
        'need_levelup',
        'current_cycle_active_days',
        'last_actived_day',
        'created_at',
      ],
      where: { need_levelup: true },
      order: { created_at: 'DESC' },
    });

    return {
      statusCode: 200,
      data: users.map((u) => ({
        uid: u.uid,
        uname: u.uname,
        email: u.uemail,
        display_name: u.ufulllname,
        level: u.ulevel,
        need_levelup: u.need_levelup,
        current_cycle_active_days: u.current_cycle_active_days,
        last_actived_day: u.last_actived_day,
        created_at: u.created_at,
      })),
    };
  }

  async reviewUserLevelUp(
    uid: number,
    action: 'approve' | 'reject',
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      uid: number;
      level: number;
      need_levelup: boolean;
      action: 'approve' | 'reject';
    };
  }> {
    if (!uid || Number.isNaN(uid)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userRepository.findOne({
      select: ['uid', 'ulevel', 'need_levelup'],
      where: { uid },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.need_levelup) {
      throw new BadRequestException(
        'User does not have pending level-up request',
      );
    }

    const previousLevel = user.ulevel;
    if (action === 'approve') {
      user.ulevel = Math.min(4, user.ulevel + 1);
    }
    user.need_levelup = false;
    user.current_cycle_active_days = 0;
    await this.userRepository.save(user);

    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action:
        action === 'approve' ? AdminLogAction.APPROVE : AdminLogAction.REJECT,
      log_module: AdminLogModule.USERS,
      log_description: `Admin ${action} user level-up: user_id=${uid}, old_level=${previousLevel}, new_level=${user.ulevel}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: uid,
      log_target_type: 'user',
      log_old_data: { level: previousLevel, need_levelup: true },
      log_new_data: { level: user.ulevel, need_levelup: user.need_levelup },
    });

    return {
      statusCode: 200,
      message:
        action === 'approve'
          ? 'User level-up approved successfully'
          : 'User level-up rejected successfully',
      data: {
        uid: user.uid,
        level: user.ulevel,
        need_levelup: user.need_levelup,
        action,
      },
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

    if (
      status === UserStatus.BLOCK_TRADE &&
      oldStatus !== UserStatus.BLOCK_TRADE
    ) {
      await this.transactionService.cancelAllPendingTransactionsForUser(uid);
      await this.orderbookService.failPendingOrderBooksForTradeBlockedUser(uid);
    }

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

  async getBankUsersPaginated(
    page = 1,
    limit = 20,
    sortBy: 'created_at' | 'username' | 'bank_name' = 'created_at',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    userName?: string,
    bankName?: string,
    bankAccountNumber?: string,
    bankAccountName?: string,
  ): Promise<{
    statusCode: number;
    data: Array<{
      uid: number;
      uname: string;
      email: string;
      phone: string | null;
      display_name: string;
      bu_id: number;
      bu_bank_name: string;
      bu_bank_branch: string | null;
      bu_bank_account_name: string;
      bu_bank_account_number: string;
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
    const orderDirection = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const sortableColumns = {
      created_at: 'bu.bu_id',
      username: 'u.uname',
      bank_name: 'bu.bu_bank_name',
    } as const;
    const orderColumn = sortableColumns[sortBy] ?? sortableColumns.created_at;

    // Build query
    let query = this.bankUserRepository
      .createQueryBuilder('bu')
      .innerJoin(User, 'u', 'u.uid = bu.bu_user_id')
      .select('u.uid', 'uid')
      .addSelect('u.uname', 'uname')
      .addSelect('u.uemail', 'uemail')
      .addSelect('u.uphone', 'uphone')
      .addSelect('u.ufulllname', 'ufulllname')
      .addSelect('bu.bu_id', 'bu_id')
      .addSelect('bu.bu_bank_name', 'bu_bank_name')
      .addSelect('bu.bu_bank_branch', 'bu_bank_branch')
      .addSelect('bu.bu_bank_account_name', 'bu_bank_account_name')
      .addSelect('bu.bu_bank_account_number', 'bu_bank_account_number');

    // Apply filters
    if (userName) {
      query = query.andWhere(
        '(LOWER(u.uname) ILIKE LOWER(:userName) OR LOWER(u.ufulllname) ILIKE LOWER(:userName))',
        { userName: `%${userName}%` },
      );
    }

    if (bankName) {
      query = query.andWhere('LOWER(bu.bu_bank_name) ILIKE LOWER(:bankName)', {
        bankName: `%${bankName}%`,
      });
    }

    if (bankAccountNumber) {
      query = query.andWhere(
        'LOWER(bu.bu_bank_account_number) ILIKE LOWER(:accountNumber)',
        { accountNumber: `%${bankAccountNumber}%` },
      );
    }

    if (bankAccountName) {
      query = query.andWhere(
        'LOWER(bu.bu_bank_account_name) ILIKE LOWER(:accountName)',
        { accountName: `%${bankAccountName}%` },
      );
    }

    const [rawItems, total] = await Promise.all([
      query
        .orderBy(orderColumn, orderDirection)
        .addOrderBy('bu.bu_id', 'DESC')
        .offset(skip)
        .limit(safeLimit)
        .getRawMany<{
          uid: string;
          uname: string;
          uemail: string;
          uphone: string | null;
          ufulllname: string;
          bu_id: string;
          bu_bank_name: string;
          bu_bank_branch: string | null;
          bu_bank_account_name: string;
          bu_bank_account_number: string;
        }>(),
      query.getCount(),
    ]);

    const mapped = rawItems.map((item) => ({
      uid: Number(item.uid),
      uname: item.uname,
      email: item.uemail,
      phone: item.uphone,
      display_name: item.ufulllname,
      bu_id: Number(item.bu_id),
      bu_bank_name: item.bu_bank_name,
      bu_bank_branch: item.bu_bank_branch,
      bu_bank_account_name: item.bu_bank_account_name,
      bu_bank_account_number: item.bu_bank_account_number,
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
}
