import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Network } from './entities/network.entity';
import { Coin } from './entities/coin.entity';
import { CoinNetwork } from './entities/coin-network.entity';
import {
  AdminSetting,
  AdminSettingStatus,
  AdminSettingType,
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

  private async upsertSetting(
    name: string,
    type: AdminSettingType,
    value: string | number | boolean | object | null,
    status: AdminSettingStatus = AdminSettingStatus.ACTIVE,
  ): Promise<void> {
    const rawValue =
      value == null
        ? null
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    const existing = await this.adminSettingRepository.findOne({
      where: { setting_name: name },
    });
    if (!existing) {
      await this.adminSettingRepository.save(
        this.adminSettingRepository.create({
          setting_name: name,
          setting_type: type,
          setting_value: rawValue,
          status,
        }),
      );
      return;
    }
    existing.setting_type = type;
    existing.setting_value = rawValue;
    existing.status = status;
    await this.adminSettingRepository.save(existing);
  }

  private async getActiveSettingsMap(): Promise<Map<string, AdminSetting>> {
    const rows = await this.adminSettingRepository.find({
      where: { status: AdminSettingStatus.ACTIVE },
    });
    return new Map(rows.map((r) => [r.setting_name, r]));
  }

  private getNumberSetting(
    map: Map<string, AdminSetting>,
    name: string,
    fallback: number,
  ): number {
    const raw = map.get(name)?.setting_value;
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  private inferAdminSettingType(
    value: string | number | boolean | Record<string, unknown> | null,
  ): AdminSettingType {
    if (value === null) return AdminSettingType.STRING;
    if (typeof value === 'number') return AdminSettingType.NUMBER;
    if (typeof value === 'boolean') return AdminSettingType.BOOLEAN;
    if (typeof value === 'object') return AdminSettingType.JSON;
    return AdminSettingType.STRING;
  }

  async getAllAdminSettings(): Promise<{
    statusCode: number;
    data: Array<{
      id: number;
      key: string;
      type: AdminSettingType;
      value: string | null;
      status: AdminSettingStatus;
    }>;
  }> {
    const rows = await this.adminSettingRepository.find({
      order: { as_id: 'DESC' },
    });

    return {
      statusCode: 200,
      data: rows.map((row) => ({
        id: row.as_id,
        key: row.setting_name,
        type: row.setting_type,
        value: row.setting_value,
        status: row.status,
      })),
    };
  }

  async updateAdminSettingByKeyValue(
    key: string,
    value: string | number | boolean | Record<string, unknown> | null,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      key: string;
      type: AdminSettingType;
      value: string | null;
      status: AdminSettingStatus;
    };
  }> {
    const normalizedKey = key.trim();
    const inferredType = this.inferAdminSettingType(value);
    await this.upsertSetting(
      normalizedKey,
      inferredType,
      value,
      AdminSettingStatus.ACTIVE,
    );

    const updated = await this.adminSettingRepository.findOne({
      where: { setting_name: normalizedKey },
    });

    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SETTINGS,
      log_description: `Admin updated setting ${normalizedKey}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: updated?.as_id ?? null,
      log_target_type: 'admin_setting',
      log_new_data: {
        key: normalizedKey,
        type: inferredType,
        value,
      },
    });

    return {
      statusCode: 200,
      message: 'Admin setting updated successfully',
      data: {
        key: normalizedKey,
        type: updated?.setting_type ?? inferredType,
        value: updated?.setting_value ?? null,
        status: updated?.status ?? AdminSettingStatus.ACTIVE,
      },
    };
  }

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
    if (videoSettingsDto.turnDefault && videoSettingsDto.turnDefault > 0) {
      await this.upsertSetting(
        'video.turn_watch_default',
        AdminSettingType.NUMBER,
        videoSettingsDto.turnDefault,
      );
    }
    if (
      videoSettingsDto.devicesDefault &&
      videoSettingsDto.devicesDefault > 0
    ) {
      await this.upsertSetting(
        'video.devices_default',
        AdminSettingType.NUMBER,
        videoSettingsDto.devicesDefault,
      );
    }
    if (videoSettingsDto.timeGap && videoSettingsDto.timeGap > 0) {
      await this.upsertSetting(
        'video.time_gap',
        AdminSettingType.NUMBER,
        videoSettingsDto.timeGap,
      );
    }

    const map = await this.getActiveSettingsMap();
    const turnWatchDefault = this.getNumberSetting(
      map,
      'video.turn_watch_default',
      10,
    );
    const devicesDefault = this.getNumberSetting(
      map,
      'video.devices_default',
      20,
    );
    const timeGap = this.getNumberSetting(map, 'video.time_gap', 15);

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
        turn_watch_default: turnWatchDefault,
        devices_default: devicesDefault,
        time_gap: timeGap,
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
    if (withdrawSettingsDto.turnFree && withdrawSettingsDto.turnFree > 0) {
      await this.upsertSetting(
        'withdraw.turn_free',
        AdminSettingType.NUMBER,
        withdrawSettingsDto.turnFree,
      );
    }

    const map = await this.getActiveSettingsMap();
    const turnWithdrawFree = this.getNumberSetting(
      map,
      'withdraw.turn_free',
      5,
    );

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
        turn_withdraw_free: turnWithdrawFree,
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
      percentage: Record<number, number>;
      reward_milestone: Array<{
        milestone: number;
        reward: number;
      }>;
    };
  }> {
    const settingMap = await this.getActiveSettingsMap();

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

    const turn_watch_default = this.getNumberSetting(
      settingMap,
      'video.turn_watch_default',
      10,
    );
    const devices_default = this.getNumberSetting(
      settingMap,
      'video.devices_default',
      20,
    );
    const time_gap = this.getNumberSetting(settingMap, 'video.time_gap', 15);
    const percent_day = this.getNumberSetting(
      settingMap,
      'reward.percent_day',
      0.2,
    );
    const percent_week = this.getNumberSetting(
      settingMap,
      'reward.percent_week',
      2.5,
    );
    const percent_month = this.getNumberSetting(
      settingMap,
      'reward.percent_month',
      20,
    );
    const turn_free = this.getNumberSetting(
      settingMap,
      'withdraw.turn_free',
      5,
    );
    const max_level = this.getNumberSetting(
      settingMap,
      'ref.smart_ref_level',
      0,
    );
    const percentage: Record<number, number> = {};

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
        percentage,
        reward_milestone,
      },
    };
  }
}
