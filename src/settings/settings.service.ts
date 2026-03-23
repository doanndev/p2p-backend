import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Network } from './entities/network.entity';
import { Coin } from './entities/coin.entity';
import { CoinNetwork } from './entities/coin-network.entity';
import { AdminSetting } from './entities/admin-setting.entity';
import { AdminSettingTurn } from './entities/admin-setting-turn.entity';

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
  ) {}
}
