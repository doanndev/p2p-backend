import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UserLevelUpWorker {
  constructor(private readonly dataSource: DataSource) {}

  async handleTransactionSuccess(userId: number): Promise<void> {
    if (!Number.isFinite(userId) || userId <= 0) return;
    await this.applyLevelUpLogic(userId);
  }

  private async applyLevelUpLogic(userId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // 1) If it's a new day for this user, increment active days and set last_actived_day = CURRENT_DATE
      await manager
        .createQueryBuilder()
        .update(User)
        .set({
          current_cycle_active_days: () => '"current_cycle_active_days" + 1',
          last_actived_day: () => 'CURRENT_DATE',
        })
        .where('"uid" = :uid', { uid: userId })
        .andWhere(
          '("last_actived_day" IS NULL OR "last_actived_day" < CURRENT_DATE)',
        )
        .execute();

      // 2) If reached 10 active days in current cycle, level up and reset cycle days
      await manager
        .createQueryBuilder()
        .update(User)
        .set({
          ulevel: () => '"ulevel" + 1',
          current_cycle_active_days: 0,
        })
        .where('"uid" = :uid', { uid: userId })
        .andWhere('"current_cycle_active_days" = 10')
        .execute();
    });
  }
}
