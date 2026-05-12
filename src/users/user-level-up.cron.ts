import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserLevelUpWorker } from './user-level-up.worker';

@Injectable()
export class UserLevelUpCronService {
  private readonly logger = new Logger(UserLevelUpCronService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly userLevelUpWorker: UserLevelUpWorker,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDailyP2pLevelUpScan(): Promise<void> {
    this.logger.log('P2P level-up daily scan started');
    const rows = await this.userRepository
      .createQueryBuilder('u')
      .select('u.uid', 'uid')
      .where('u.uverify = :v', { v: true })
      .andWhere('u.ulevel < :maxLevel', { maxLevel: 5 })
      .getRawMany<{ uid: string }>();

    let failed = 0;
    for (const row of rows) {
      const uid = Number(row.uid);
      if (!Number.isFinite(uid) || uid <= 0) continue;
      try {
        await this.userLevelUpWorker.evaluateLevelUpForUser(uid);
      } catch (err) {
        failed++;
        this.logger.warn(
          `evaluateLevelUpForUser failed uid=${uid}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log(
      `P2P level-up daily scan finished (candidates=${rows.length}, failed=${failed})`,
    );
  }
}
