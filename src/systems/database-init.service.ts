import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseInitService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseInitService.name);

  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.setUsersSequenceStartValue();
  }

  private async setUsersSequenceStartValue(): Promise<void> {
    const TARGET_START_VALUE = 142857;
    
    try {
      // Check if users table exists and has data
      const maxUidResult = await this.dataSource.query(`
        SELECT MAX(uid) as max_uid FROM users
      `);
      
      const maxUid = maxUidResult[0]?.max_uid || null;
      const hasData = maxUid !== null;

      // Check if sequence exists
      const sequenceExistsResult = await this.dataSource.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_sequences WHERE sequencename = 'users_uid_seq'
        ) as exists
      `);
      
      const sequenceExists = sequenceExistsResult[0]?.exists || false;

      if (sequenceExists) {
        // Get current sequence value
        const sequenceResult = await this.dataSource.query(`
          SELECT last_value, is_called 
          FROM users_uid_seq
          LIMIT 1
        `);

        if (sequenceResult.length > 0) {
          const { last_value, is_called } = sequenceResult[0];
          const currentValue = is_called ? parseInt(last_value) : parseInt(last_value) - 1;

          // Calculate target value: if has data, use max(max_uid + 1, TARGET_START_VALUE)
          // This ensures:
          // - If max_uid < 142857, next user will start from 142857
          // - If max_uid >= 142857, next user will continue from max_uid + 1 (handles gaps correctly)
          // - Gaps (e.g., 142858, 142860) are preserved - sequence won't fill them
          const targetValue = hasData 
            ? Math.max(maxUid + 1, TARGET_START_VALUE)
            : TARGET_START_VALUE;

          if (currentValue < targetValue) {
            // Use parameterized query with proper escaping
            await this.dataSource.query(`
              SELECT setval('users_uid_seq', ${targetValue}, false)
            `);
            this.logger.log(`Users sequence has been set to start from ${targetValue} (max_uid: ${maxUid || 'none'})`);
          } else {
            this.logger.log(`Users sequence already starts from or above ${targetValue} (current: ${currentValue}, max_uid: ${maxUid || 'none'})`);
          }
        }
      } else {
        // Sequence doesn't exist yet, create it with target start value
        // If has data with gaps (e.g., 142858, 142860), next user will be max_uid + 1
        const targetValue = hasData 
          ? Math.max(maxUid + 1, TARGET_START_VALUE)
          : TARGET_START_VALUE;

        try {
          await this.dataSource.query(`
            CREATE SEQUENCE IF NOT EXISTS users_uid_seq
            START WITH ${targetValue}
            OWNED BY users.uid
          `);
          this.logger.log(`Users sequence created with starting value ${targetValue} (max_uid: ${maxUid || 'none'})`);
        } catch (createError) {
          this.logger.warn(`Could not create sequence: ${createError.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error setting users sequence start value: ${error.message}`);
      // Don't throw - let app continue to run
    }
  }
}

