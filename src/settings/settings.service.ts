import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Network } from './entities/network.entity';
import { Coin } from './entities/coin.entity';
import { CoinNetwork } from './entities/coin-network.entity';
import {
  AdminSetting,
  FundType,
  Difficulty,
} from './entities/admin-setting.entity';
import { AdminSettingTurn } from './entities/admin-setting-turn.entity';
import { VideoSettingsDto } from './dto/video-settings.dto';
import { WithdrawSettingsDto } from './dto/withdraw-settings.dto';
import {
  AdminLog,
  AdminLogAction,
  AdminLogModule,
} from '../admins/entities/admin-log.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Network)
    private networkRepository: Repository<Network>,
    @InjectRepository(Coin)
    private coinRepository: Repository<Coin>,
    @InjectRepository(CoinNetwork)
    private coinNetworkRepository: Repository<CoinNetwork>,
    @InjectRepository(AdminSetting)
    private adminSettingRepository: Repository<AdminSetting>,
    @InjectRepository(AdminSettingTurn)
    private adminSettingTurnRepository: Repository<AdminSettingTurn>,
    @InjectRepository(AdminLog)
    private adminLogRepository: Repository<AdminLog>,
  ) {}

  async updateVideoSettings(
    videoSettingsDto: VideoSettingsDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    settings: {
      turn_watch_default: number;
      devices_default: number;
      time_gap: number;
    };
  }> {
    let adminSetting = await this.adminSettingRepository.findOne({
      where: {},
      order: { as_id: 'ASC' },
    });

    if (!adminSetting) {
      adminSetting = this.adminSettingRepository.create({
        as_turn_watch_default: 10,
        as_devices_default: 20,
        as_time_gap: 15,
        as_time_lock_gift_balance: null,
        as_percent_day: 0,
        as_percent_week: 0,
        as_percent_month: 0,
        as_fund_type: FundType.GAIN_LOSS,
        as_fund_amount: 0,
        as_turn_withdraw_free: 5,
        as_difficulty: Difficulty.DEFAULT,
        as_smart_ref_level: 2,
      });

      if (videoSettingsDto.turnDefault && videoSettingsDto.turnDefault > 0) {
        adminSetting.as_turn_watch_default = videoSettingsDto.turnDefault;
      }
      if (
        videoSettingsDto.devicesDefault &&
        videoSettingsDto.devicesDefault > 0
      ) {
        adminSetting.as_devices_default = videoSettingsDto.devicesDefault;
      }
      if (videoSettingsDto.timeGap && videoSettingsDto.timeGap > 0) {
        adminSetting.as_time_gap = videoSettingsDto.timeGap;
      }

      await this.adminSettingRepository.save(adminSetting);
    } else {
      if (videoSettingsDto.turnDefault && videoSettingsDto.turnDefault > 0) {
        adminSetting.as_turn_watch_default = videoSettingsDto.turnDefault;
      }
      if (
        videoSettingsDto.devicesDefault &&
        videoSettingsDto.devicesDefault > 0
      ) {
        adminSetting.as_devices_default = videoSettingsDto.devicesDefault;
      }
      if (videoSettingsDto.timeGap && videoSettingsDto.timeGap > 0) {
        adminSetting.as_time_gap = videoSettingsDto.timeGap;
      }

      await this.adminSettingRepository.save(adminSetting);
    }

    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SETTINGS,
      log_description: `Admin updated video settings: turnDefault=${videoSettingsDto.turnDefault || 'unchanged'}, devicesDefault=${videoSettingsDto.devicesDefault || 'unchanged'}, timeGap=${videoSettingsDto.timeGap || 'unchanged'}`,
      log_ip_address: null,
      log_user_agent: null,
    });

    return {
      statusCode: 200,
      message: 'Video settings updated successfully',
      settings: {
        turn_watch_default: adminSetting.as_turn_watch_default,
        devices_default: adminSetting.as_devices_default,
        time_gap: adminSetting.as_time_gap,
      },
    };
  }

  async updateWithdrawSettings(
    withdrawSettingsDto: WithdrawSettingsDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    settings: {
      turn_withdraw_free: number;
    };
  }> {
    let adminSetting = await this.adminSettingRepository.findOne({
      where: {},
      order: { as_id: 'ASC' },
    });

    if (!adminSetting) {
      adminSetting = this.adminSettingRepository.create({
        as_turn_watch_default: 10,
        as_devices_default: 20,
        as_time_gap: 15,
        as_time_lock_gift_balance: null,
        as_percent_day: 0.2,
        as_percent_week: 2.5,
        as_percent_month: 20,
        as_fund_type: FundType.GAIN_LOSS,
        as_fund_amount: 0,
        as_turn_withdraw_free: 5,
        as_difficulty: Difficulty.DEFAULT,
        as_smart_ref_level: 2,
      });

      if (withdrawSettingsDto.turnFree && withdrawSettingsDto.turnFree > 0) {
        adminSetting.as_turn_withdraw_free = withdrawSettingsDto.turnFree;
      }

      await this.adminSettingRepository.save(adminSetting);
    } else {
      if (withdrawSettingsDto.turnFree && withdrawSettingsDto.turnFree > 0) {
        adminSetting.as_turn_withdraw_free = withdrawSettingsDto.turnFree;
      }

      await this.adminSettingRepository.save(adminSetting);
    }

    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SETTINGS,
      log_description: `Admin updated withdraw settings: turnFree=${withdrawSettingsDto.turnFree || 'unchanged'}`,
      log_ip_address: null,
      log_user_agent: null,
    });

    return {
      statusCode: 200,
      message: 'Withdraw settings updated successfully',
      settings: {
        turn_withdraw_free: adminSetting.as_turn_withdraw_free,
      },
    };
  }

  async getAdminSettingsSummary(): Promise<{
    statusCode: number;
    settings: {
      turn_watch_default: number;
      devices_default: number;
      time_gap: number;
      percent_day: number;
      percent_week: number;
      percent_month: number;
      turn_free: number;
      max_level: number;
      parcentage: Record<number, number>;
      reward_milestone: Array<{
        milestone: number;
        reward: number;
      }>;
    };
  }> {
    const adminSetting = await this.adminSettingRepository.findOne({
      where: {},
      order: { as_id: 'ASC' },
    });

    const milestones = [5, 10, 20, 35, 50, 75, 100];
    const milestoneRewards: { [key: number]: number } = {
      5: 20,
      10: 30,
      20: 60,
      35: 200,
      50: 300,
      75: 400,
      100: 500,
    };

    const reward_milestone: Array<{
      milestone: number;
      reward: number;
    }> = milestones.map((milestone) => ({
      milestone,
      reward: milestoneRewards[milestone],
    }));

    if (!adminSetting) {
      return {
        statusCode: 200,
        settings: {
          turn_watch_default: 10,
          devices_default: 20,
          time_gap: 15,
          percent_day: 0.2,
          percent_week: 2.5,
          percent_month: 20,
          turn_free: 5,
          max_level: 0,
          parcentage: {},
          reward_milestone,
        },
      };
    }

    const turn_watch_default = adminSetting.as_turn_watch_default ?? 10;
    const devices_default = adminSetting.as_devices_default ?? 20;
    const time_gap = adminSetting.as_time_gap ?? 15;
    const percent_day =
      typeof adminSetting.as_percent_day === 'number'
        ? Number(adminSetting.as_percent_day)
        : 0.2;
    const percent_week =
      typeof adminSetting.as_percent_week === 'number'
        ? Number(adminSetting.as_percent_week)
        : 2.5;
    const percent_month =
      typeof adminSetting.as_percent_month === 'number'
        ? Number(adminSetting.as_percent_month)
        : 20;
    const turn_free = adminSetting.as_turn_withdraw_free ?? 5;
    const max_level = adminSetting.as_smart_ref_level ?? 0;
    const parcentage: Record<number, number> = {};

    return {
      statusCode: 200,
      settings: {
        turn_watch_default,
        devices_default,
        time_gap,
        percent_day,
        percent_week,
        percent_month,
        turn_free,
        max_level,
        parcentage,
        reward_milestone,
      },
    };
  }
}
