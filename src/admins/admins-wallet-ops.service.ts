import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, In } from 'typeorm';
import * as bip39 from 'bip39';
import * as bip32 from 'bip32';
import * as tinysecp from 'tiny-secp256k1';
import { derivePath } from 'ed25519-hd-key';
import {
  Keypair,
  PublicKey,
  Connection,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  getMint,
  getAccount,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  HDNodeWallet,
  Wallet,
  parseUnits,
  Contract,
  Interface,
  getAddress,
} from 'ethers';
import { TronWeb } from 'tronweb';
import { createEvmJsonRpcProvider } from '../common/evm-json-rpc-provider.factory';
import { Admin, AdminStatus } from './entities/admin.entity';
import {
  AdminLog,
  AdminLogAction,
  AdminLogModule,
} from './entities/admin-log.entity';
import { User } from '../users/entities/user.entity';
import {
  WalletHistory,
  WalletHistoryType,
  WalletHistoryOption,
  WalletHistoryStatus,
} from '../wallets/entities/wallet-history.entity';
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import {
  WalletTransfer,
  WalletTransferFrom,
  WalletTransferTo,
  WalletTransferStatus,
} from '../wallets/entities/wallet-transfer.entity';
import { Coin, CoinStatus } from '../settings/entities/coin.entity';
import { Network, NetStatus } from '../settings/entities/network.entity';
import { UserWalletNetwork } from '../wallets/entities/user-wallet-network.entity';
import { ActiveWalletTracker } from '../wallets/entities/active-wallet-tracker.entity';
import { WalletDepositTracker } from '../wallets/entities/wallet-deposit-tracker.entity';
import {
  CoinNetwork,
  CoinNetworkStatus,
} from '../settings/entities/coin-network.entity';
import { AddCoinDto } from './dto/add-coin.dto';
import { UpdateCoinDto } from './dto/update-coin.dto';
import { AddNetworkDto } from './dto/add-network.dto';
import { UpdateNetworkDto } from './dto/update-network.dto';
import { RpcRateLimitService } from '../common/rpc-rate-limit.service';
import { AdminSettingsConfigService } from '../settings/admin-settings-config.service';

/** Ví TRX derive HD: private key hex 64 ký tự (không prefix 0x), dùng với TronWeb.address.fromPrivateKey */
type TronHdWallet = { privateKeyHex: string };

/** Thời gian tối đa còn lại đến lần chạy tự động (ms) để API main-withdraw được phép gọi. */
const MAIN_WITHDRAW_API_MAX_WAIT_MS = 3 * 60 * 1000; // 3 phút
/** Khoảng thời gian (ms) reset lịch tự động sau mỗi lần chạy (cron hoặc API thành công). */
const MAIN_WITHDRAW_AUTO_INTERVAL_MS = 10 * 60 * 1000; // 10 phút

@Injectable()
export class AdminsWalletOpsService implements OnModuleInit {
  private isMainWithdrawProcessing = false;
  // Ghi nhớ các network mà ví trợ phí đã hết tiền để không thử lại cho các ví sau
  private feeSupportDepletedNetworks = new Set<string>();
  // Thời điểm (timestamp) lần chạy tự động tiếp theo; dùng để kiểm tra khi gọi API
  private nextAutoMainWithdrawAt = 0;

  constructor(
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
    @InjectRepository(AdminLog)
    private adminLogRepository: Repository<AdminLog>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(WalletHistory)
    private walletHistoryRepository: Repository<WalletHistory>,
    @InjectRepository(UserWallet)
    private userWalletRepository: Repository<UserWallet>,
    @InjectRepository(WalletTransfer)
    private walletTransferRepository: Repository<WalletTransfer>,
    @InjectRepository(Coin)
    private coinRepository: Repository<Coin>,
    @InjectRepository(Network)
    private networkRepository: Repository<Network>,
    @InjectRepository(UserWalletNetwork)
    private useWalletNetworkRepository: Repository<UserWalletNetwork>,
    @InjectRepository(ActiveWalletTracker)
    private activeWalletTrackerRepository: Repository<ActiveWalletTracker>,
    @InjectRepository(WalletDepositTracker)
    private walletDepositTrackerRepository: Repository<WalletDepositTracker>,
    @InjectRepository(CoinNetwork)
    private coinNetworkRepository: Repository<CoinNetwork>,
    private configService: ConfigService,
    private rpcRateLimitService: RpcRateLimitService,
    private adminSettingsConfigService: AdminSettingsConfigService,
  ) {}

  private isTronNetwork(networkSymbol: string): boolean {
    const s = networkSymbol.trim().toUpperCase();
    return s === 'TRX' || s === 'TRON';
  }

  private deriveTronAtPath(mnemonic: string, path: string): TronHdWallet {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const bip32Factory = bip32.BIP32Factory(tinysecp);
    const root = bip32Factory.fromSeed(seed);
    const derivedNode = root.derivePath(path);
    if (!derivedNode.privateKey) {
      throw new BadRequestException('Failed to derive Tron private key');
    }
    return {
      privateKeyHex: Buffer.from(derivedNode.privateKey).toString('hex'),
    };
  }

  private tronAddressFromPrivateKeyHex(privateKeyHex: string): string {
    const addr = TronWeb.address.fromPrivateKey(privateKeyHex);
    if (!addr || typeof addr !== 'string') {
      throw new BadRequestException('Failed to derive Tron address');
    }
    return addr;
  }

  /**
   * Generate exchange wallet (ví sàn) with fixed path
   * Path: m/44'/60'/0'/0'/0'/382' (ETH/BSC), m/44'/501'/0'/0'/0'/382' (SOL),
   *       m/44'/195'/0'/0'/0'/382' (TRX — BIP44 coin type 195)
   */
  private getExchangeWallet(
    mnemonic: string,
    networkSymbol: string,
  ): HDNodeWallet | Keypair | TronHdWallet {
    if (networkSymbol === 'SOL') {
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const derivedSeed = derivePath(
        `m/44'/501'/0'/0'/0'/382'`,
        seed.toString('hex'),
      );
      return Keypair.fromSeed(derivedSeed.key);
    }
    if (this.isTronNetwork(networkSymbol)) {
      return this.deriveTronAtPath(mnemonic, `m/44'/195'/0'/0'/0'/382'`);
    }
    // ETH/BSC và các mạng EVM khác
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const bip32Factory = bip32.BIP32Factory(tinysecp);
    const root = bip32Factory.fromSeed(seed);

    // Derive path: m/44'/60'/0'/0'/0'/382'
    const derivedNode = root.derivePath(`m/44'/60'/0'/0'/0'/382'`);

    // Chuyển đổi private key từ bip32 sang Wallet
    const privateKeyBuffer = derivedNode.privateKey;
    const privateKey = `0x${Buffer.from(privateKeyBuffer).toString('hex')}`;
    const wallet = new Wallet(privateKey);

    return wallet as any as HDNodeWallet;
  }

  /**
   * Get public key from exchange wallet
   */
  private getExchangeWalletPublicKey(
    wallet: HDNodeWallet | Keypair | TronHdWallet,
    networkSymbol: string,
  ): string {
    if (networkSymbol === 'SOL') {
      const keypair = wallet as Keypair;
      return keypair.publicKey.toBase58();
    }
    if (this.isTronNetwork(networkSymbol)) {
      return this.tronAddressFromPrivateKeyHex(
        (wallet as TronHdWallet).privateKeyHex,
      );
    }
    const hdWallet = wallet as HDNodeWallet;
    return hdWallet.address;
  }

  async getMainWallets(): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      public_key: string;
      network: {
        net_id: number;
        net_name: string;
        net_symbol: string;
        net_logo: string;
        net_scan: string;
        net_status: string;
      };
    }>;
  }> {
    // Get mnemonic from config
    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic) {
      throw new BadRequestException('Wallet seed not configured');
    }

    if (!bip39.validateMnemonic(mnemonic)) {
      throw new BadRequestException('Invalid wallet seed');
    }

    // Get all active networks
    const networks = await this.networkRepository.find({
      where: { net_status: NetStatus.ACTIVE },
      order: { net_id: 'ASC' },
    });

    // Generate exchange wallet for each network
    const mainWallets = networks.map((network) => {
      const exchangeWallet = this.getExchangeWallet(
        mnemonic,
        network.net_symbol,
      );
      const publicKey = this.getExchangeWalletPublicKey(
        exchangeWallet,
        network.net_symbol,
      );

      return {
        public_key: publicKey,
        network: {
          net_id: network.net_id,
          net_name: network.net_name,
          net_symbol: network.net_symbol,
          net_logo: network.net_logo,
          net_scan: network.net_scan,
          net_status: network.net_status,
        },
      };
    });

    return {
      statusCode: 200,
      message: 'Main wallets retrieved successfully',
      data: mainWallets,
    };
  }

  /**
   * Lấy danh sách ví trợ phí (fee subsidy wallets) – path 369
   * Trả về cấu trúc giống ví main, chỉ khác public_key là từ ví trợ phí
   */
  async getFeeSubsidyWallets(): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      public_key: string;
      network: {
        net_id: number;
        net_name: string;
        net_symbol: string;
        net_logo: string;
        net_scan: string;
        net_status: string;
      };
    }>;
  }> {
    // Get mnemonic from config
    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic) {
      throw new BadRequestException('Wallet seed not configured');
    }

    if (!bip39.validateMnemonic(mnemonic)) {
      throw new BadRequestException('Invalid wallet seed');
    }

    // Get all active networks
    const networks = await this.networkRepository.find({
      where: { net_status: NetStatus.ACTIVE },
      order: { net_id: 'ASC' },
    });

    // Generate fee subsidy wallet (path 369) cho mỗi network
    const feeWallets = networks.map((network) => {
      const feeWallet = this.getFeeSupportWallet(mnemonic, network.net_symbol);
      const publicKey = this.getExchangeWalletPublicKey(
        feeWallet,
        network.net_symbol,
      );

      return {
        public_key: publicKey,
        network: {
          net_id: network.net_id,
          net_name: network.net_name,
          net_symbol: network.net_symbol,
          net_logo: network.net_logo,
          net_scan: network.net_scan,
          net_status: network.net_status,
        },
      };
    });

    return {
      statusCode: 200,
      message: 'Fee subsidy wallets retrieved successfully',
      data: feeWallets,
    };
  }

  async getListCoins(): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      coin_id: number;
      coin_name: string;
      coin_symbol: string;
      coin_logo: string;
      coin_website: string | null;
      coin_status: string;
    }>;
  }> {
    const coins = await this.coinRepository.find({
      order: { coin_id: 'ASC' },
    });

    const mapped = coins.map((coin) => ({
      coin_id: coin.coin_id,
      coin_name: coin.coin_name,
      coin_symbol: coin.coin_symbol,
      coin_logo: coin.coin_logo,
      coin_website: coin.coin_website,
      coin_status: coin.coin_status,
    }));

    return {
      statusCode: 200,
      message: 'List of coins retrieved successfully',
      data: mapped,
    };
  }

  async addCoin(
    addCoinDto: AddCoinDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      coin_id: number;
      coin_name: string;
      coin_symbol: string;
      coin_logo: string;
      coin_website: string | null;
      coin_status: string;
    };
  }> {
    // Check if coin_name already exists
    const existingCoinByName = await this.coinRepository.findOne({
      where: { coin_name: addCoinDto.name },
    });

    if (existingCoinByName) {
      throw new BadRequestException(
        `Coin with name "${addCoinDto.name}" already exists`,
      );
    }

    // Check if coin_symbol already exists
    const existingCoinBySymbol = await this.coinRepository.findOne({
      where: { coin_symbol: addCoinDto.symbol.toUpperCase() },
    });

    if (existingCoinBySymbol) {
      throw new BadRequestException(
        `Coin with symbol "${addCoinDto.symbol.toUpperCase()}" already exists`,
      );
    }

    // Create new coin
    const newCoin = this.coinRepository.create({
      coin_name: addCoinDto.name,
      coin_symbol: addCoinDto.symbol.toUpperCase(),
      coin_logo: addCoinDto.logo,
      coin_website: addCoinDto.website || null,
      coin_status: CoinStatus.ACTIVE,
    });

    const savedCoin = await this.coinRepository.save(newCoin);

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.CREATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Admin created new coin: name=${addCoinDto.name}, symbol=${addCoinDto.symbol.toUpperCase()}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: savedCoin.coin_id,
      log_target_type: 'coin',
      log_old_data: null,
      log_new_data: {
        coin_name: savedCoin.coin_name,
        coin_symbol: savedCoin.coin_symbol,
        coin_logo: savedCoin.coin_logo,
        coin_website: savedCoin.coin_website,
        coin_status: savedCoin.coin_status,
      },
    });

    return {
      statusCode: 201,
      message: 'Coin created successfully',
      data: {
        coin_id: savedCoin.coin_id,
        coin_name: savedCoin.coin_name,
        coin_symbol: savedCoin.coin_symbol,
        coin_logo: savedCoin.coin_logo,
        coin_website: savedCoin.coin_website,
        coin_status: savedCoin.coin_status,
      },
    };
  }

  async updateCoin(
    coinId: number,
    updateCoinDto: UpdateCoinDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      coin_id: number;
      coin_name: string;
      coin_symbol: string;
      coin_logo: string;
      coin_website: string | null;
      coin_status: string;
    };
  }> {
    if (!coinId || Number.isNaN(coinId)) {
      throw new BadRequestException('Invalid coin id');
    }

    // Check if coin exists
    const coin = await this.coinRepository.findOne({
      where: { coin_id: coinId },
    });

    if (!coin) {
      throw new NotFoundException('Coin not found');
    }

    // Store old data for logging
    const oldData = {
      coin_name: coin.coin_name,
      coin_logo: coin.coin_logo,
      coin_website: coin.coin_website,
    };

    // Check unique for name if provided
    if (updateCoinDto.name && updateCoinDto.name !== coin.coin_name) {
      const existingCoinByName = await this.coinRepository.findOne({
        where: { coin_name: updateCoinDto.name },
      });

      if (existingCoinByName && existingCoinByName.coin_id !== coinId) {
        throw new BadRequestException(
          `Coin with name "${updateCoinDto.name}" already exists`,
        );
      }
    }

    // Update fields if provided
    if (updateCoinDto.name !== undefined) {
      coin.coin_name = updateCoinDto.name;
    }
    if (updateCoinDto.logo !== undefined) {
      coin.coin_logo = updateCoinDto.logo;
    }
    if (updateCoinDto.website !== undefined) {
      coin.coin_website = updateCoinDto.website || null;
    }

    const updatedCoin = await this.coinRepository.save(coin);

    // Prepare new data for logging
    const newData = {
      coin_name: updatedCoin.coin_name,
      coin_logo: updatedCoin.coin_logo,
      coin_website: updatedCoin.coin_website,
    };

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Admin updated coin: coin_id=${coinId}, changes=${JSON.stringify(updateCoinDto)}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: coinId,
      log_target_type: 'coin',
      log_old_data: oldData,
      log_new_data: newData,
    });

    return {
      statusCode: 200,
      message: 'Coin updated successfully',
      data: {
        coin_id: updatedCoin.coin_id,
        coin_name: updatedCoin.coin_name,
        coin_symbol: updatedCoin.coin_symbol,
        coin_logo: updatedCoin.coin_logo,
        coin_website: updatedCoin.coin_website,
        coin_status: updatedCoin.coin_status,
      },
    };
  }

  async getListNetworks(): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      net_id: number;
      net_name: string;
      net_symbol: string;
      net_logo: string;
      net_scan: string;
      net_status: string;
    }>;
  }> {
    const networks = await this.networkRepository.find({
      order: { net_id: 'ASC' },
    });

    const mapped = networks.map((network) => ({
      net_id: network.net_id,
      net_name: network.net_name,
      net_symbol: network.net_symbol,
      net_logo: network.net_logo,
      net_scan: network.net_scan,
      net_status: network.net_status,
    }));

    return {
      statusCode: 200,
      message: 'List of networks retrieved successfully',
      data: mapped,
    };
  }

  async addNetwork(
    addNetworkDto: AddNetworkDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      net_id: number;
      net_name: string;
      net_symbol: string;
      net_logo: string;
      net_scan: string;
      net_status: string;
    };
  }> {
    // Check if net_name already exists
    const existingNetworkByName = await this.networkRepository.findOne({
      where: { net_name: addNetworkDto.name },
    });

    if (existingNetworkByName) {
      throw new BadRequestException(
        `Network with name "${addNetworkDto.name}" already exists`,
      );
    }

    // Check if net_symbol already exists
    const existingNetworkBySymbol = await this.networkRepository.findOne({
      where: { net_symbol: addNetworkDto.symbol.toUpperCase() },
    });

    if (existingNetworkBySymbol) {
      throw new BadRequestException(
        `Network with symbol "${addNetworkDto.symbol.toUpperCase()}" already exists`,
      );
    }

    // Check if net_scan already exists
    const existingNetworkByScan = await this.networkRepository.findOne({
      where: { net_scan: addNetworkDto.scan },
    });

    if (existingNetworkByScan) {
      throw new BadRequestException(
        `Network with scan "${addNetworkDto.scan}" already exists`,
      );
    }

    // Create new network
    const newNetwork = this.networkRepository.create({
      net_name: addNetworkDto.name,
      net_symbol: addNetworkDto.symbol.toUpperCase(),
      net_logo: addNetworkDto.logo,
      net_scan: addNetworkDto.scan,
      net_status: NetStatus.ACTIVE,
    });

    const savedNetwork = await this.networkRepository.save(newNetwork);

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.CREATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Admin created new network: name=${addNetworkDto.name}, symbol=${addNetworkDto.symbol.toUpperCase()}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: savedNetwork.net_id,
      log_target_type: 'network',
      log_old_data: null,
      log_new_data: {
        net_name: savedNetwork.net_name,
        net_symbol: savedNetwork.net_symbol,
        net_logo: savedNetwork.net_logo,
        net_scan: savedNetwork.net_scan,
        net_status: savedNetwork.net_status,
      },
    });

    return {
      statusCode: 201,
      message: 'Network created successfully',
      data: {
        net_id: savedNetwork.net_id,
        net_name: savedNetwork.net_name,
        net_symbol: savedNetwork.net_symbol,
        net_logo: savedNetwork.net_logo,
        net_scan: savedNetwork.net_scan,
        net_status: savedNetwork.net_status,
      },
    };
  }

  async updateNetwork(
    networkId: number,
    updateNetworkDto: UpdateNetworkDto,
    adminId: number,
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      net_id: number;
      net_name: string;
      net_symbol: string;
      net_logo: string;
      net_scan: string;
      net_status: string;
    };
  }> {
    if (!networkId || Number.isNaN(networkId)) {
      throw new BadRequestException('Invalid network id');
    }

    // Check if network exists
    const network = await this.networkRepository.findOne({
      where: { net_id: networkId },
    });

    if (!network) {
      throw new NotFoundException('Network not found');
    }

    // Store old data for logging
    const oldData = {
      net_name: network.net_name,
      net_logo: network.net_logo,
      net_scan: network.net_scan,
    };

    // Check unique for name if provided
    if (updateNetworkDto.name && updateNetworkDto.name !== network.net_name) {
      const existingNetworkByName = await this.networkRepository.findOne({
        where: { net_name: updateNetworkDto.name },
      });

      if (existingNetworkByName && existingNetworkByName.net_id !== networkId) {
        throw new BadRequestException(
          `Network with name "${updateNetworkDto.name}" already exists`,
        );
      }
    }

    // Check unique for scan if provided
    if (updateNetworkDto.scan && updateNetworkDto.scan !== network.net_scan) {
      const existingNetworkByScan = await this.networkRepository.findOne({
        where: { net_scan: updateNetworkDto.scan },
      });

      if (existingNetworkByScan && existingNetworkByScan.net_id !== networkId) {
        throw new BadRequestException(
          `Network with scan "${updateNetworkDto.scan}" already exists`,
        );
      }
    }

    // Update fields if provided
    if (updateNetworkDto.name !== undefined) {
      network.net_name = updateNetworkDto.name;
    }
    if (updateNetworkDto.logo !== undefined) {
      network.net_logo = updateNetworkDto.logo;
    }
    if (updateNetworkDto.scan !== undefined) {
      network.net_scan = updateNetworkDto.scan;
    }

    const updatedNetwork = await this.networkRepository.save(network);

    // Prepare new data for logging
    const newData = {
      net_name: updatedNetwork.net_name,
      net_logo: updatedNetwork.net_logo,
      net_scan: updatedNetwork.net_scan,
    };

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Admin updated network: network_id=${networkId}, changes=${JSON.stringify(updateNetworkDto)}`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_id: networkId,
      log_target_type: 'network',
      log_old_data: oldData,
      log_new_data: newData,
    });

    return {
      statusCode: 200,
      message: 'Network updated successfully',
      data: {
        net_id: updatedNetwork.net_id,
        net_name: updatedNetwork.net_name,
        net_symbol: updatedNetwork.net_symbol,
        net_logo: updatedNetwork.net_logo,
        net_scan: updatedNetwork.net_scan,
        net_status: updatedNetwork.net_status,
      },
    };
  }

  async getUserWallets(uid: number): Promise<{
    statusCode: number;
    message: string;
    data: {
      user: {
        uid: number;
        uname: string;
        email: string;
      };
      balances: Array<{
        coin_id: number | null;
        coin_name: string | null;
        coin_symbol: string | null;
        balance: number;
      }>;
      wallet_networks: Array<{
        uwn_id: number;
        network_id: number;
        network_name: string;
        network_symbol: string;
        public_key: string;
        created_at: Date;
      }>;
    };
  }> {
    if (!uid || Number.isNaN(uid)) {
      throw new BadRequestException('Invalid user id');
    }

    // Check if user exists
    const user = await this.userRepository.findOne({
      select: ['uid', 'uname', 'uemail'],
      where: { uid },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get all user wallets (balances)
    const userWallets = await this.userWalletRepository.find({
      where: { uw_user_id: uid },
      relations: [],
    });

    // Get coin information for each wallet
    const balances = await Promise.all(
      userWallets.map(async (wallet) => {
        let coinName: string | null = null;
        let coinSymbol: string | null = null;

        if (wallet.uw_wallet_coins) {
          const coin = await this.coinRepository.findOne({
            where: { coin_id: wallet.uw_wallet_coins },
            select: ['coin_name', 'coin_symbol'],
          });
          if (coin) {
            coinName = coin.coin_name;
            coinSymbol = coin.coin_symbol;
          }
        }

        return {
          coin_id: wallet.uw_wallet_coins,
          coin_name: coinName,
          coin_symbol: coinSymbol,
          balance: parseFloat(wallet.uw_balance?.toString() || '0'),
        };
      }),
    );

    // Get all user wallet networks
    const walletNetworks = await this.useWalletNetworkRepository.find({
      where: { uwn_user_id: uid },
      relations: [],
    });

    // Get network information for each wallet network
    const walletNetworksWithInfo = await Promise.all(
      walletNetworks.map(async (wn) => {
        const network = await this.networkRepository.findOne({
          where: { net_id: wn.uwn_network_id },
          select: ['net_name', 'net_symbol'],
        });

        return {
          uwn_id: wn.uwn_id,
          network_id: wn.uwn_network_id,
          network_name: network?.net_name || null,
          network_symbol: network?.net_symbol || null,
          public_key: wn.uwn_public_key,
          created_at: wn.created_at,
        };
      }),
    );

    return {
      statusCode: 200,
      message: 'User wallets retrieved successfully',
      data: {
        user: {
          uid: user.uid,
          uname: user.uname,
          email: user.uemail,
        },
        balances,
        wallet_networks: walletNetworksWithInfo,
      },
    };
  }

  async getUserWalletHistories(
    userId: number,
    option?: string,
  ): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      wh_id: number;
      wh_wallet_netword_id: number | null;
      wh_type: string;
      wh_option: string;
      wh_coins: number | null;
      wh_amount: number;
      wh_hash: string | null;
      wh_status: string;
      wh_node: string | null;
      wh_user: number | null;
      created_at: Date;
      updated_at: Date;
      coin_name: string | null;
      coin_symbol: string | null;
      network_name: string | null;
      network_symbol: string | null;
    }>;
  }> {
    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    // Check if user exists
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      select: ['uid'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Determine which options to filter
    let options: WalletHistoryOption[] = [];
    if (option === 'deposit') {
      options = [
        WalletHistoryOption.DEPOSIT,
        WalletHistoryOption.ADMIN_DEPOSIT,
      ];
    } else if (option === 'withdraw') {
      options = [WalletHistoryOption.WITHDRAW];
    } else {
      // Default: get both deposit and withdraw
      options = [
        WalletHistoryOption.DEPOSIT,
        WalletHistoryOption.ADMIN_DEPOSIT,
        WalletHistoryOption.WITHDRAW,
      ];
    }

    // Get wallet histories for this user
    const histories = await this.walletHistoryRepository.find({
      where: {
        wh_user: userId,
        wh_option: In(options),
      },
      order: { created_at: 'DESC' },
    });

    // Enrich with coin and network information
    const enrichedHistories = await Promise.all(
      histories.map(async (history) => {
        let coinName: string | null = null;
        let coinSymbol: string | null = null;

        if (history.wh_coins) {
          const coin = await this.coinRepository.findOne({
            where: { coin_id: history.wh_coins },
            select: ['coin_name', 'coin_symbol'],
          });
          if (coin) {
            coinName = coin.coin_name;
            coinSymbol = coin.coin_symbol;
          }
        }

        let networkName: string | null = null;
        let networkSymbol: string | null = null;

        if (history.wh_wallet_netword_id) {
          const walletNetwork = await this.useWalletNetworkRepository.findOne({
            where: { uwn_id: history.wh_wallet_netword_id },
            select: ['uwn_network_id'],
          });

          if (walletNetwork) {
            const network = await this.networkRepository.findOne({
              where: { net_id: walletNetwork.uwn_network_id },
              select: ['net_name', 'net_symbol'],
            });
            if (network) {
              networkName = network.net_name;
              networkSymbol = network.net_symbol;
            }
          }
        }

        return {
          wh_id: history.wh_id,
          wh_wallet_netword_id: history.wh_wallet_netword_id,
          wh_type: history.wh_type,
          wh_option: history.wh_option,
          wh_coins: history.wh_coins,
          wh_amount: parseFloat(history.wh_amount?.toString() || '0'),
          wh_hash: history.wh_hash,
          wh_status: history.wh_status,
          wh_node: history.wh_node,
          wh_user: history.wh_user,
          created_at: history.created_at,
          updated_at: history.updated_at,
          coin_name: coinName,
          coin_symbol: coinSymbol,
          network_name: networkName,
          network_symbol: networkSymbol,
        };
      }),
    );

    return {
      statusCode: 200,
      message: 'User wallet histories retrieved successfully',
      data: enrichedHistories,
    };
  }

  async searchWallet(query: string): Promise<{
    statusCode: number;
    message: string;
    data: Array<{
      wallet_network: {
        uwn_id: number;
        public_key: string;
        created_at: Date;
      };
      user: {
        uid: number;
        uname: string;
        email: string;
        logo: string | null;
      };
      network: {
        net_id: number;
        net_name: string;
        net_symbol: string;
        net_logo: string;
        net_scan: string;
      } | null;
    }>;
  }> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Search query is required');
    }

    // Search for wallet networks with public key matching query (LIKE)
    const walletNetworks = await this.useWalletNetworkRepository
      .createQueryBuilder('uwn')
      .where('uwn.uwn_public_key ILIKE :query', { query: `%${query}%` })
      .getMany();

    if (walletNetworks.length === 0) {
      return {
        statusCode: 200,
        message: 'No wallets found',
        data: [],
      };
    }

    // Get user and network information for each wallet network
    const results = await Promise.all(
      walletNetworks.map(async (wn) => {
        // Get user information
        const user = await this.userRepository.findOne({
          select: ['uid', 'uname', 'uemail', 'uavatar'],
          where: { uid: wn.uwn_user_id },
        });

        // Get network information
        const network = await this.networkRepository.findOne({
          where: { net_id: wn.uwn_network_id },
          select: ['net_id', 'net_name', 'net_symbol', 'net_logo', 'net_scan'],
        });

        return {
          wallet_network: {
            uwn_id: wn.uwn_id,
            public_key: wn.uwn_public_key,
            created_at: wn.created_at,
          },
          user: user
            ? {
                uid: user.uid,
                uname: user.uname,
                email: user.uemail,
                logo: user.uavatar,
              }
            : null,
          network: network
            ? {
                net_id: network.net_id,
                net_name: network.net_name,
                net_symbol: network.net_symbol,
                net_logo: network.net_logo,
                net_scan: network.net_scan,
              }
            : null,
        };
      }),
    );

    // Filter out results where user is null (shouldn't happen, but just in case)
    const validResults = results.filter(
      (
        r,
      ): r is {
        wallet_network: {
          uwn_id: number;
          public_key: string;
          created_at: Date;
        };
        user: {
          uid: number;
          uname: string;
          email: string;
          logo: string | null;
        };
        network: {
          net_id: number;
          net_name: string;
          net_symbol: string;
          net_logo: string;
          net_scan: string;
        } | null;
      } => r.user !== null,
    );

    return {
      statusCode: 200,
      message: 'Wallets found successfully',
      data: validResults,
    };
  }

  /**
   * Calculate path components from user ID
   */
  private calculatePathComponents(userId: number): {
    a: number;
    b: number;
    c: number;
  } {
    const a = Math.floor(userId / 100000) % 100;
    const b = Math.floor(userId / 1000) % 100;
    const c = userId % 1000;
    return { a, b, c };
  }

  /**
   * Lấy địa chỉ (string) từ ví derive – dùng để check balance và rút đúng ví sẽ ký giao dịch.
   */
  private getDerivedWalletAddressString(
    wallet: HDNodeWallet | Keypair | TronHdWallet,
    networkSymbol: string,
  ): string {
    if (networkSymbol === 'SOL') {
      return (wallet as Keypair).publicKey.toBase58();
    }
    if (this.isTronNetwork(networkSymbol)) {
      return this.tronAddressFromPrivateKeyHex(
        (wallet as TronHdWallet).privateKeyHex,
      );
    }
    return (wallet as HDNodeWallet).address;
  }

  /**
   * Generate user wallet from mnemonic and path components
   */
  private generateUserWallet(
    mnemonic: string,
    userId: number,
    endPath: number | null,
    networkSymbol: string,
  ): HDNodeWallet | Keypair | TronHdWallet {
    const { a, b, c } = this.calculatePathComponents(userId);
    const d = endPath || 0;

    if (networkSymbol === 'SOL') {
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const path = `m/44'/501'/0'/${a}'/${b}'/${c}'/${d}'`;
      const derivedSeed = derivePath(path, seed.toString('hex'));
      return Keypair.fromSeed(derivedSeed.key);
    }
    if (this.isTronNetwork(networkSymbol)) {
      return this.deriveTronAtPath(
        mnemonic,
        `m/44'/195'/0'/${a}'/${b}'/${c}'/${d}'`,
      );
    }
    // EVM
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const bip32Factory = bip32.BIP32Factory(tinysecp);
    const root = bip32Factory.fromSeed(seed);
    const path = `m/44'/60'/0'/${a}'/${b}'/${c}'/${d}'`;
    const derivedNode = root.derivePath(path);

    if (!derivedNode.privateKey) {
      throw new BadRequestException('Failed to derive private key');
    }

    const privateKeyBuffer = derivedNode.privateKey;
    const privateKey = `0x${Buffer.from(privateKeyBuffer).toString('hex')}`;
    const wallet = new Wallet(privateKey);
    return wallet as any as HDNodeWallet;
  }

  /**
   * Lấy ví trợ phí (fee support wallet) từ HD Wallet
   * Path cố định:
   * - ETH / BSC (EVM): m/44'/60'/0'/0'/0'/369'
   * - SOL:            m/44'/501'/0'/0'/0'/369'
   * - TRX:            m/44'/195'/0'/0'/0'/369'
   */
  private getFeeSupportWallet(
    mnemonic: string,
    networkSymbol: string,
  ): HDNodeWallet | Keypair | TronHdWallet {
    if (networkSymbol === 'SOL') {
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const derivedSeed = derivePath(
        `m/44'/501'/0'/0'/0'/369'`,
        seed.toString('hex'),
      );
      return Keypair.fromSeed(derivedSeed.key);
    }
    if (this.isTronNetwork(networkSymbol)) {
      return this.deriveTronAtPath(mnemonic, `m/44'/195'/0'/0'/0'/369'`);
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const bip32Factory = bip32.BIP32Factory(tinysecp);
    const root = bip32Factory.fromSeed(seed);
    const derivedNode = root.derivePath(`m/44'/60'/0'/0'/0'/369'`);

    if (!derivedNode.privateKey) {
      throw new BadRequestException('Failed to derive fee support wallet');
    }

    const privateKeyBuffer = derivedNode.privateKey;
    const privateKey = `0x${Buffer.from(privateKeyBuffer).toString('hex')}`;
    const wallet = new Wallet(privateKey);
    return wallet as any as HDNodeWallet;
  }

  /**
   * Chỉ kiểm tra và tạo ATA USDT trên SOL cho ví CEO (hoặc main path 382).
   * Ví trợ phí (path 369) không cần ATA và không bao giờ được dùng làm đích; nếu target trùng ví trợ phí thì dùng main 382.
   */
  private async ensureTargetHasSolUsdtAta(
    network: Network,
    usdtCoin: Coin,
    coinNetwork: CoinNetwork,
    targetWalletAddress: string,
    mainWalletAddress: string,
    mnemonic: string,
  ): Promise<void> {
    if (network.net_symbol !== 'SOL') return;

    const mintAddress = this.getCoinNetworkMint(coinNetwork);
    if (!mintAddress) {
      console.warn(
        'SOL: cn_coin_mint missing in DB for USDT, skip ensureTargetHasSolUsdtAta',
      );
      return;
    }

    const solUrls = await this.adminSettingsConfigService.getRpcSolUrlsToTry();
    if (solUrls.length === 0) return;

    const wssUrl = this.configService.get<string>('SOLANA_WSS_URL');
    await this.runWithSolRpcUrl(async (rpcUrl) => {
      const connection = new Connection(rpcUrl, {
        commitment: 'confirmed',
        wsEndpoint: wssUrl || undefined,
      });

      // Đảm bảo đích là ví CEO/main, không bao giờ là ví trợ phí (path 369)
      const feeSupportWallet = this.getFeeSupportWallet(
        mnemonic,
        'SOL',
      ) as Keypair;
      const feeSupportAddress = feeSupportWallet.publicKey.toBase58();
      let effectiveTarget = targetWalletAddress;
      if (effectiveTarget === feeSupportAddress) {
        effectiveTarget = mainWalletAddress;
      }

      const mintPublicKey = new PublicKey(mintAddress);
      const targetPublicKey = new PublicKey(effectiveTarget);
      const toTokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        targetPublicKey,
      );

      try {
        await this.rpcRateLimitService.withRpcLimit(() =>
          getAccount(connection, toTokenAccount),
        );
        return; // ATA đã tồn tại
      } catch {
        // ATA chưa có, tạo bằng ví trợ phí (path 369)
      }

      if (this.feeSupportDepletedNetworks.has('SOL')) {
        return;
      }

      const supportBalance = await this.rpcRateLimitService.withRpcLimit(() =>
        connection.getBalance(feeSupportWallet.publicKey),
      );
      const rentExempt = 2039280; // ~min rent for ATA
      if (supportBalance < rentExempt) {
        return;
      }

      try {
        // Payer = ví trợ phí (369); owner của ATA = ví CEO/main (effectiveTarget)
        const transaction = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            feeSupportWallet.publicKey,
            toTokenAccount,
            targetPublicKey,
            mintPublicKey,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
        const { blockhash } = await this.rpcRateLimitService.withRpcLimit(() =>
          connection.getLatestBlockhash('confirmed'),
        );
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = feeSupportWallet.publicKey;

        const signature = await this.rpcRateLimitService.withRpcLimit(() =>
          connection.sendTransaction(transaction, [feeSupportWallet]),
        );
        await this.rpcRateLimitService.withRpcLimit(() =>
          connection.confirmTransaction(signature, 'confirmed'),
        );
      } catch (err: any) {
        if (
          err?.message?.includes('insufficient') ||
          err?.message?.includes('balance')
        ) {
          this.feeSupportDepletedNetworks.add('SOL');
        }
      }
    });
  }

  /**
   * Gửi native fee từ ví trợ phí tới ví user để đủ gas rút USDT
   */
  private async sendGasFromSupportWallet(
    network: Network,
    nativeCoin: Coin | null,
    nativeCoinNetwork: CoinNetwork | null,
    mnemonic: string,
    toAddress: string,
    amount: number,
  ): Promise<string | null> {
    // Nếu đã biết ví trợ phí trên network này hết tiền thì bỏ qua luôn
    if (this.feeSupportDepletedNetworks.has(network.net_symbol)) {
      return null;
    }

    const feeWallet = this.getFeeSupportWallet(mnemonic, network.net_symbol);

    try {
      // SOL: không cần nativeCoin từ DB, xử lý trực tiếp; thử DB rồi env khi lỗi/rate limit
      if (network.net_symbol === 'SOL') {
        if (amount <= 0) {
          return null;
        }
        const wssUrl = this.configService.get<string>('SOLANA_WSS_URL');
        return this.runWithSolRpcUrl(async (rpcUrl) => {
          const connection = new Connection(rpcUrl, {
            commitment: 'confirmed',
            wsEndpoint: wssUrl || undefined,
          });

          const keypair = feeWallet as Keypair;
          const feeSupportAddress = keypair.publicKey.toBase58();
          const toPubkey = new PublicKey(toAddress);

          const lamports = Math.floor(amount * 1e9);

          const supportBalance = await this.rpcRateLimitService.withRpcLimit(
            () => connection.getBalance(keypair.publicKey),
          );
          if (supportBalance < lamports) {
            console.warn(
              `[SOL] Fee support (${feeSupportAddress}) insufficient: has ${supportBalance / 1e9} SOL, need ${lamports / 1e9}. Nạp SOL vào địa chỉ trên. Marking depleted.`,
            );
            this.feeSupportDepletedNetworks.add(network.net_symbol);
            return null;
          }

          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey,
              lamports,
            }),
          );

          const signature = await this.rpcRateLimitService.withRpcLimit(() =>
            connection.sendTransaction(transaction, [keypair]),
          );
          try {
            await this.rpcRateLimitService.withRpcLimit(() =>
              Promise.race([
                connection.confirmTransaction(signature, 'confirmed'),
                new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error('Confirm timeout 30s')),
                    30000,
                  ),
                ),
              ]),
            );
          } catch {
            // Tx may still succeed on-chain
          }
          return signature;
        });
      }

      if (this.isTronNetwork(network.net_symbol)) {
        const twSk = feeWallet as TronHdWallet;
        const fullHost = await this.getTronFullHost(network);
        const tw = this.createTronWebWithKey(fullHost, twSk.privateKeyHex);
        const fromAddr =
          tw.defaultAddress.base58 ||
          TronWeb.address.fromPrivateKey(twSk.privateKeyHex);
        if (!fromAddr || typeof fromAddr !== 'string') {
          throw new BadRequestException('Tron fee wallet address unavailable');
        }
        const toAddr = this.normalizeTronAddress(tw, toAddress);

        const energyTrx =
          await this.adminSettingsConfigService.getTronDelegateEnergyStakeTrx();
        const bandwidthTrx =
          await this.adminSettingsConfigService.getTronDelegateBandwidthStakeTrx();
        const lastDelegateTxId = await this.delegateTronResourcesFromFeeWallet(
          tw,
          twSk.privateKeyHex,
          fromAddr,
          toAddr,
          energyTrx,
          bandwidthTrx,
        );
        if (lastDelegateTxId) {
          console.log(
            `[${network.net_symbol}] Fee support: delegated resources to receiver, tx=${lastDelegateTxId}`,
          );
        }
        return lastDelegateTxId;
      }

      if (amount <= 0) {
        return null;
      }

      // EVM (ETH/BSC) – gửi native từ ví 369, không bắt buộc nativeCoin trong DB
      const rpcUrls = await this.getEvmRpcUrls(network);
      const valueWei = parseUnits(amount.toString(), 18);
      for (const rpcUrl of rpcUrls) {
        try {
          const provider = createEvmJsonRpcProvider(rpcUrl);
          const evmWallet = feeWallet as HDNodeWallet;
          const connected = evmWallet.connect(provider);
          const supportBalance = await this.rpcRateLimitService.withRpcLimit(
            () => provider.getBalance(connected.address),
          );
          if (supportBalance < valueWei) {
            if (rpcUrls.indexOf(rpcUrl) < rpcUrls.length - 1) continue;
            console.warn(
              `[${network.net_symbol}] Fee support (369) insufficient: has ${Number(supportBalance) / 1e18}, need ${amount}`,
            );
            this.feeSupportDepletedNetworks.add(network.net_symbol);
            return null;
          }
          const tx = await this.rpcRateLimitService.withRpcLimit(() =>
            connected.sendTransaction({
              to: toAddress,
              value: valueWei,
            }),
          );
          await this.rpcRateLimitService.withRpcLimit(() => tx.wait());
          return tx.hash;
        } catch (err: any) {
          if (rpcUrls.indexOf(rpcUrl) < rpcUrls.length - 1) {
            continue;
          }
          throw err;
        }
      }
      return null;
    } catch (error: any) {
      const msg = String(error?.message ?? '');
      if (
        msg.includes('insufficient') ||
        msg.includes('balance') ||
        msg.includes('depleted')
      ) {
        this.feeSupportDepletedNetworks.add(network.net_symbol);
      }
      return null;
    }
  }

  /**
   * Send transaction from user wallet to main wallet (USDT hoặc native)
   */
  private async sendTransactionToMain(
    network: Network,
    coin: Coin,
    coinNetwork: CoinNetwork,
    userWallet: HDNodeWallet | Keypair | TronHdWallet,
    mainWalletAddress: string,
    amount: number,
  ): Promise<string> {
    if (network.net_symbol === 'SOL') {
      const wssUrl = this.configService.get<string>('SOLANA_WSS_URL');
      return this.runWithSolRpcUrl(async (rpcUrl) => {
        const connection = new Connection(rpcUrl, {
          commitment: 'confirmed',
          wsEndpoint: wssUrl || undefined,
        });

        const keypair = userWallet as Keypair;
        const toPublicKey = new PublicKey(mainWalletAddress);

        if (coin.coin_symbol === 'SOL') {
          // Native SOL transfer
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: toPublicKey,
              lamports: amount * 1e9,
            }),
          );

          const signature = await this.rpcRateLimitService.withRpcLimit(() =>
            connection.sendTransaction(transaction, [keypair]),
          );
          await this.rpcRateLimitService.withRpcLimit(() =>
            connection.confirmTransaction(signature, 'confirmed'),
          );
          return signature;
        } else {
          // SPL Token transfer (USDT)
          const mintStr = this.getCoinNetworkMint(coinNetwork);
          if (!mintStr) {
            throw new BadRequestException(
              `SPL ${coin.coin_symbol} on SOL requires cn_coin_mint in coin_network`,
            );
          }
          const mintPublicKey = new PublicKey(mintStr);
          const mintInfo = await this.rpcRateLimitService.withRpcLimit(() =>
            getMint(connection, mintPublicKey),
          );
          const decimals = mintInfo.decimals;

          const fromTokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            keypair.publicKey,
          );
          const toTokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            toPublicKey,
          );

          // Kiểm tra balance
          let fromTokenAccountInfo;
          try {
            fromTokenAccountInfo = await this.rpcRateLimitService.withRpcLimit(
              () => getAccount(connection, fromTokenAccount),
            );
          } catch {
            throw new BadRequestException(
              `Sender token account does not exist or has no balance`,
            );
          }

          const transferAmount = BigInt(
            Math.floor(amount * Math.pow(10, decimals)),
          );
          if (fromTokenAccountInfo.amount < transferAmount) {
            throw new BadRequestException('Insufficient token balance');
          }

          // Kiểm tra token account của receiver
          let toTokenAccountInfo;
          try {
            toTokenAccountInfo = await this.rpcRateLimitService.withRpcLimit(
              () => getAccount(connection, toTokenAccount),
            );
          } catch {
            toTokenAccountInfo = null;
          }

          // Tạo transaction
          const transaction = new Transaction();

          if (!toTokenAccountInfo) {
            transaction.add(
              createAssociatedTokenAccountInstruction(
                keypair.publicKey,
                toTokenAccount,
                toPublicKey,
                mintPublicKey,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
              ),
            );
          }

          transaction.add(
            createTransferInstruction(
              fromTokenAccount,
              toTokenAccount,
              keypair.publicKey,
              transferAmount,
              [],
              TOKEN_PROGRAM_ID,
            ),
          );

          const { blockhash } = await this.rpcRateLimitService.withRpcLimit(
            () => connection.getLatestBlockhash('confirmed'),
          );
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = keypair.publicKey;

          const feePayerBalance = await this.rpcRateLimitService.withRpcLimit(
            () => connection.getBalance(keypair.publicKey),
          );
          if (
            feePayerBalance <
            AdminsWalletOpsService.MIN_SOL_LAMPORTS_FOR_SPL_FEE
          ) {
            throw new BadRequestException(
              `Insufficient SOL for tx fee (${feePayerBalance / 1e9} SOL). Need ~${AdminsWalletOpsService.MIN_SOL_LAMPORTS_FOR_SPL_FEE / 1e9} SOL.`,
            );
          }

          const signature = await this.rpcRateLimitService.withRpcLimit(() =>
            connection.sendTransaction(transaction, [keypair]),
          );
          await this.rpcRateLimitService.withRpcLimit(() =>
            connection.confirmTransaction(signature, 'confirmed'),
          );
          return signature;
        }
      });
    } else if (this.isTronNetwork(network.net_symbol)) {
      const fullHost = await this.getTronFullHost(network);
      const { privateKeyHex } = userWallet as TronHdWallet;
      const tw = this.createTronWebWithKey(fullHost, privateKeyHex);
      const fromBase58 = tw.defaultAddress.base58;
      const toNorm = this.normalizeTronAddress(tw, mainWalletAddress);
      const coinSym = coin.coin_symbol.trim().toUpperCase();
      const netSym = network.net_symbol.trim().toUpperCase();
      const isNativeTrx = coinSym === 'TRX' || coinSym === netSym;

      if (isNativeTrx) {
        const sun = Math.floor(amount * 1_000_000);
        if (sun <= 0) {
          throw new BadRequestException('Invalid TRX transfer amount');
        }
        const result = await this.rpcRateLimitService.withRpcLimit(() =>
          tw.trx.sendTransaction(toNorm, sun, { privateKey: privateKeyHex }),
        );
        return this.extractTronTxId(result);
      }

      if (!coinNetwork.cn_coin_mint) {
        throw new BadRequestException(
          `Token ${coin.coin_symbol} requires cn_coin_mint on ${network.net_symbol}`,
        );
      }
      const contractAddr = this.resolveTronContractBase58(
        tw,
        coinNetwork.cn_coin_mint,
      );
      const contract = await tw.contract().at(contractAddr);
      const callOpts = { from: fromBase58 };
      const decimalsRaw = await this.rpcRateLimitService.withRpcLimit(() =>
        contract.decimals().call(callOpts),
      );
      const decimals =
        typeof decimalsRaw === 'object' &&
        decimalsRaw != null &&
        'toString' in decimalsRaw
          ? Number((decimalsRaw as { toString(): string }).toString())
          : Number(decimalsRaw);
      const amountUnits = BigInt(
        Math.floor(amount * Math.pow(10, decimals) + 1e-12),
      );
      if (amountUnits <= BigInt(0)) {
        throw new BadRequestException('Invalid TRC20 transfer amount');
      }
      const txid = await this.rpcRateLimitService.withRpcLimit(() =>
        contract
          .transfer(toNorm, amountUnits.toString())
          .send(
            { feeLimit: AdminsWalletOpsService.TRON_TRC20_FEE_LIMIT_SUN },
            privateKeyHex,
          ),
      );
      if (typeof txid !== 'string' || !txid) {
        throw new BadRequestException('TRC20 transfer did not return tx id');
      }
      return txid;
    } else {
      // EVM transaction – thử các RPC đã cấu hình (DB hoặc env)
      const rpcUrls = await this.getEvmRpcUrls(network);
      if (!rpcUrls.length) {
        throw new BadRequestException(
          `RPC endpoint not configured for network ${network.net_symbol}`,
        );
      }

      const wallet = userWallet as HDNodeWallet;
      const isNativeToken =
        coin.coin_symbol === network.net_symbol ||
        (network.net_symbol === 'ETH' && coin.coin_symbol === 'ETH') ||
        (network.net_symbol === 'BSC' && coin.coin_symbol === 'BNB');

      let lastEvmError: Error | null = null;
      for (const rpcUrl of rpcUrls) {
        try {
          const provider = createEvmJsonRpcProvider(rpcUrl);

          const connectedWallet = wallet.connect(provider);

          if (isNativeToken) {
            const transferAmount = parseUnits(amount.toString(), 18);
            const senderBalance = await this.rpcRateLimitService.withRpcLimit(
              () => provider.getBalance(connectedWallet.address),
            );
            const feeData = await this.rpcRateLimitService.withRpcLimit(() =>
              provider.getFeeData(),
            );
            const estimatedGasLimit = 21000;
            const estimatedGasFee = feeData.gasPrice
              ? feeData.gasPrice * BigInt(estimatedGasLimit)
              : BigInt(0);
            if (senderBalance < transferAmount + estimatedGasFee) {
              throw new BadRequestException(
                'Insufficient balance (including gas fee)',
              );
            }
            const tx = await this.rpcRateLimitService.withRpcLimit(() =>
              connectedWallet.sendTransaction({
                to: mainWalletAddress,
                value: transferAmount,
              }),
            );
            await this.rpcRateLimitService.withRpcLimit(() => tx.wait());
            return tx.hash;
          } else {
            if (!coinNetwork.cn_coin_mint) {
              throw new BadRequestException(
                `Token ${coin.coin_symbol} requires cn_coin_mint on network ${network.net_symbol}`,
              );
            }
            const erc20Abi = [
              'function transfer(address to, uint256 amount) returns (bool)',
              'function decimals() view returns (uint8)',
            ];
            const tokenContractAddress = this.normalizeEvmAddress(
              coinNetwork.cn_coin_mint,
            );
            const tokenContract = new Contract(
              tokenContractAddress,
              new Interface(erc20Abi),
              connectedWallet,
            );
            const decimalsRaw = await this.rpcRateLimitService.withRpcLimit(
              () => tokenContract.decimals(),
            );
            const decimals =
              typeof decimalsRaw === 'bigint'
                ? Number(decimalsRaw)
                : Number(decimalsRaw);
            const transferAmount = parseUnits(amount.toString(), decimals);
            const tx = await this.rpcRateLimitService.withRpcLimit(() =>
              tokenContract.transfer(mainWalletAddress, transferAmount),
            );
            await this.rpcRateLimitService.withRpcLimit(() => tx.wait());
            return tx.hash;
          }
        } catch (err: any) {
          lastEvmError = err;
          if (rpcUrls.indexOf(rpcUrl) < rpcUrls.length - 1) {
            continue;
          }
          throw err;
        }
      }
      throw lastEvmError ?? new Error('EVM sendTransactionToMain failed');
    }
  }

  /**
   * Process main withdraw - rút USDT từ các ví active về ví main
   * Chạy background, không block response.
   * @param fromApi - true khi gọi từ API: chỉ cho phép nếu thời gian đến lần chạy tự động còn dưới 3 phút; khi chạy xong sẽ reset lịch tự động 10 phút.
   */
  async processMainWithdraw(
    adminId: number,
    options?: { fromApi?: boolean },
  ): Promise<{
    statusCode: number;
    message: string;
    data: {
      total_wallets: number;
      processing: boolean;
    };
  }> {
    const fromApi = options?.fromApi === true;

    if (fromApi) {
      const now = Date.now();
      const remainingMs =
        this.nextAutoMainWithdrawAt > 0 ? this.nextAutoMainWithdrawAt - now : 0;
      if (remainingMs > MAIN_WITHDRAW_API_MAX_WAIT_MS) {
        const remainingMin = Math.ceil(remainingMs / 60000);
        throw new BadRequestException(
          `Chỉ được gọi API main-withdraw khi thời gian đến lần chạy tự động còn dưới 3 phút. Thời gian còn lại: ${remainingMin} phút.`,
        );
      }
    }

    // Check if process is already running (set ngay để tránh 2 request cùng lúc cùng pass check)
    if (this.isMainWithdrawProcessing) {
      throw new BadRequestException(
        'Main withdraw process is already running. Please wait for the current process to complete.',
      );
    }
    this.isMainWithdrawProcessing = true;

    // Mỗi lần chạy main withdraw reset danh sách "ví trợ phí hết" để lần này thử lại (admin có thể đã nạp thêm vào ví trợ phí)
    this.feeSupportDepletedNetworks.clear();

    // Get USDT coin
    const usdtCoin = await this.coinRepository.findOne({
      where: { coin_symbol: 'USDT' },
    });

    if (!usdtCoin) {
      this.isMainWithdrawProcessing = false;
      throw new BadRequestException('USDT coin not found');
    }

    // Lấy danh sách ví đã từng nạp tiền nhưng chưa được xử lý main withdraw
    const depositTrackers = await this.walletDepositTrackerRepository.find({
      where: { wdt_withdraw: false },
    });

    if (depositTrackers.length === 0) {
      this.isMainWithdrawProcessing = false;
      return {
        statusCode: 200,
        message: 'No deposit wallets pending for main withdraw',
        data: {
          total_wallets: 0,
          processing: false,
        },
      };
    }

    // Lọc danh sách user và network từ wallet_deposit_tracker
    const userIds = Array.from(
      new Set(depositTrackers.map((t) => t.wdt_user_id)),
    );
    const networkIds = Array.from(
      new Set(depositTrackers.map((t) => t.wdt_network_id)),
    );

    // Lấy các ví active tương ứng với các user/network này
    const activeWallets = await this.activeWalletTrackerRepository.find({
      where: {
        awt_user_id: In(userIds),
        awt_network_id: In(networkIds),
      },
      relations: ['network', 'wallet_network'],
      order: { awt_last_accessed_at: 'DESC' },
    });

    if (activeWallets.length === 0) {
      this.isMainWithdrawProcessing = false;
      return {
        statusCode: 200,
        message: 'No active wallets found for deposit wallets',
        data: {
          total_wallets: 0,
          processing: false,
        },
      };
    }

    // Get mnemonic for main wallet
    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
      this.isMainWithdrawProcessing = false;
      throw new BadRequestException('Wallet seed not configured or invalid');
    }

    // Process in background (không await)
    this.processWithdrawsInBackground(
      activeWallets,
      usdtCoin,
      mnemonic,
      adminId,
    )
      .catch((error) => {
        console.error('Error processing main withdraws:', error);
      })
      .finally(() => {
        this.isMainWithdrawProcessing = false;
        // Reset lịch tự động: lần chạy tự động tiếp theo sau 10 phút (cron hoặc API thành công)
        this.nextAutoMainWithdrawAt =
          Date.now() + MAIN_WITHDRAW_AUTO_INTERVAL_MS;
      });

    // Create admin log
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Admin triggered main withdraw process for ${activeWallets.length} active wallets (from wallet_deposit_tracker)`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_type: 'wallet',
      log_old_data: null,
      log_new_data: { total_wallets: activeWallets.length },
    });

    return {
      statusCode: 200,
      message: `Main withdraw process started for ${activeWallets.length} wallets`,
      data: {
        total_wallets: activeWallets.length,
        processing: true,
      },
    };
  }

  /**
   * Get CEO wallet address from .env or fallback to main wallet
   */
  private getCeoWalletAddress(
    networkSymbol: string,
    mainWalletAddress: string,
  ): string {
    let ceoWalletAddress: string | undefined;

    if (networkSymbol === 'ETH') {
      ceoWalletAddress = this.configService.get<string>('WALLET_CEO_ETH');
    } else if (networkSymbol === 'BSC') {
      ceoWalletAddress = this.configService.get<string>('WALLET_CEO_BNB');
    } else if (networkSymbol === 'SOL') {
      ceoWalletAddress = this.configService.get<string>('WALLET_CEO_SOL');
    } else if (this.isTronNetwork(networkSymbol)) {
      ceoWalletAddress = this.configService.get<string>('WALLET_CEO_TRX');
    }

    // Validate CEO wallet address
    if (
      ceoWalletAddress &&
      this.isValidWalletAddress(ceoWalletAddress, networkSymbol)
    ) {
      return ceoWalletAddress;
    }

    // Fallback to main wallet
    return mainWalletAddress;
  }

  /** So sánh hai địa chỉ sweep (CEO vs main) theo từng mạng. */
  private sweepDestinationsEqual(
    a: string,
    b: string,
    networkSymbol: string,
  ): boolean {
    const A = a.trim();
    const B = b.trim();
    if (networkSymbol === 'SOL') {
      return A === B;
    }
    if (this.isTronNetwork(networkSymbol)) {
      return A === B;
    }
    try {
      return getAddress(A) === getAddress(B);
    } catch {
      return A.toLowerCase() === B.toLowerCase();
    }
  }

  /**
   * Tách số USDT gom về CEO / main theo `ceoPercent` (0–100).
   * Nhánh dưới ngưỡng tối thiểu được gộp sang nhánh kia để tránh gửi số quá nhỏ.
   */
  private static readonly MIN_SWEEP_USDT_LEG = 0.01;

  private splitSweepUsdtAmounts(
    total: number,
    ceoPercent: number,
  ): { toCeo: number; toMain: number } {
    if (total <= 0) {
      return { toCeo: 0, toMain: 0 };
    }
    const p = Math.min(100, Math.max(0, ceoPercent));
    if (p <= 0) {
      return { toCeo: 0, toMain: Math.round(total * 1e6) / 1e6 };
    }
    if (p >= 100) {
      return { toCeo: Math.round(total * 1e6) / 1e6, toMain: 0 };
    }
    let toCeo = Math.round((total * p * 1e6) / 100) / 1e6;
    let toMain = Math.round((total - toCeo) * 1e6) / 1e6;
    const min = AdminsWalletOpsService.MIN_SWEEP_USDT_LEG;
    if (toCeo > 0 && toCeo < min && toMain >= min) {
      toMain = Math.round((toMain + toCeo) * 1e6) / 1e6;
      toCeo = 0;
    } else if (toMain > 0 && toMain < min && toCeo >= min) {
      toCeo = Math.round((toCeo + toMain) * 1e6) / 1e6;
      toMain = 0;
    } else if (toCeo > 0 && toCeo < min && toMain > 0 && toMain < min) {
      if (toCeo >= toMain) {
        toCeo = Math.round((toCeo + toMain) * 1e6) / 1e6;
        toMain = 0;
      } else {
        toMain = Math.round((toCeo + toMain) * 1e6) / 1e6;
        toCeo = 0;
      }
    }
    return { toCeo, toMain };
  }

  /**
   * Validate wallet address format
   */
  private isValidWalletAddress(
    address: string,
    networkSymbol: string,
  ): boolean {
    if (!address || address.trim().length === 0) {
      return false;
    }

    if (networkSymbol === 'SOL') {
      // Solana addresses are base58 encoded, typically 32-44 characters
      try {
        new PublicKey(address);
        return true;
      } catch {
        return false;
      }
    }
    if (this.isTronNetwork(networkSymbol)) {
      // Tron base58, thường 34 ký tự, bắt đầu bằng T
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address.trim());
    }
    // EVM addresses (ETH, BSC, …) are 0x followed by 40 hex characters
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  /** Tối thiểu SOL (lamports) để trả phí giao dịch SPL (~5000 + buffer). */
  private static readonly MIN_SOL_LAMPORTS_FOR_SPL_FEE = 50_000;

  /** Giới hạn phí (sun) khi gọi TRC20 triggerSmartContract — TronWeb feeLimit. */
  private static readonly TRON_TRC20_FEE_LIMIT_SUN = 100_000_000;

  /** Mint / contract address từ coin_network (source of truth). */
  private getCoinNetworkMint(coinNetwork: CoinNetwork): string | null {
    const m = coinNetwork.cn_coin_mint?.trim();
    return m && m.length > 0 ? m : null;
  }

  /**
   * SOL SPL token: trả về true nếu nên skip rút (ATA không tồn tại, balance < withdrawAmount, hoặc ví không đủ SOL trả phí).
   * Tránh lỗi simulation "Attempt to debit an account but found no record of a prior credit".
   */
  private async shouldSkipSolTokenWithdraw(
    network: Network,
    coin: Coin,
    coinNetwork: CoinNetwork,
    keypair: Keypair,
    withdrawAmount: number,
    derivedAddress: string,
  ): Promise<boolean> {
    try {
      const solUrls =
        await this.adminSettingsConfigService.getRpcSolUrlsToTry();
      if (solUrls.length === 0) return true;
      return await this.runWithSolRpcUrl(async (rpcUrl) => {
        const connection = new Connection(rpcUrl, { commitment: 'confirmed' });

        const solBalance = await this.rpcRateLimitService.withRpcLimit(() =>
          connection.getBalance(keypair.publicKey),
        );
        if (solBalance < AdminsWalletOpsService.MIN_SOL_LAMPORTS_FOR_SPL_FEE) {
          console.log(
            `SOL skip: ${derivedAddress} insufficient SOL for fee (${solBalance / 1e9} SOL), skipping`,
          );
          return true;
        }

        const mintStr = this.getCoinNetworkMint(coinNetwork);
        if (!mintStr) {
          return true;
        }
        const mintPublicKey = new PublicKey(mintStr);
        const fromTokenAccount = await getAssociatedTokenAddress(
          mintPublicKey,
          keypair.publicKey,
        );
        const accountInfo = await this.rpcRateLimitService.withRpcLimit(() =>
          getAccount(connection, fromTokenAccount),
        );
        const mintInfo = await this.rpcRateLimitService.withRpcLimit(() =>
          getMint(connection, mintPublicKey),
        );
        const balanceNum =
          Number(accountInfo.amount) / Math.pow(10, mintInfo.decimals);
        const requiredRaw = Math.floor(
          withdrawAmount * Math.pow(10, mintInfo.decimals),
        );
        if (Number(accountInfo.amount) < requiredRaw) {
          console.log(
            `SOL skip: ${derivedAddress} ${coin.coin_symbol} ATA balance ${balanceNum} < withdraw ${withdrawAmount}`,
          );
          return true;
        }
        return false;
      });
    } catch {
      console.log(
        `SOL skip: ${derivedAddress} ${coin.coin_symbol} ATA missing or error, skipping withdraw`,
      );
      return true;
    }
  }

  /**
   * Normalize EVM address to checksummed form (tránh lỗi "bad address checksum" khi DB lưu sai).
   */
  private normalizeEvmAddress(address: string): string {
    if (!address || !address.startsWith('0x')) return address;
    try {
      return getAddress(address);
    } catch {
      return getAddress(address.toLowerCase());
    }
  }

  /**
   * Get coin price in USD (simplified - using fixed prices)
   * In production, this should fetch from an API like CoinGecko
   */
  private getCoinPriceUSD(coinSymbol: string): number {
    const prices: Record<string, number> = {
      ETH: 3000,
      BNB: 600,
      SOL: 150,
      TRX: 0.25,
      USDT: 1,
    };
    return prices[coinSymbol.toUpperCase()] || 0;
  }

  onModuleInit(): void {
    // Chạy main withdraw một lần khi start server, sau 3s để app khởi động xong
    setTimeout(() => {
      this.handleAutoMainWithdraw().catch(() => {});
    }, 3000);
  }

  /**
   * Cron job: tự động xử lý main withdraw mỗi 10 phút
   * API POST /admins/wallets/main-withdraw chỉ được gọi khi thời gian đến lần chạy tự động còn dưới 3 phút; khi gọi thành công thì reset lịch 10 phút.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleAutoMainWithdraw(): Promise<void> {
    // Lấy admin_id đầu tiên (cũ nhất) trong database để ghi log
    const oldestAdmin = await this.adminRepository.find({
      order: { admin_id: 'ASC' },
      take: 1,
    });

    if (!oldestAdmin || oldestAdmin.length === 0) {
      console.warn(
        'handleAutoMainWithdraw: no admin found in database, skipping',
      );
      return;
    }

    const adminId = oldestAdmin[0].admin_id;

    try {
      await this.processMainWithdraw(adminId, { fromApi: false });
    } catch (error: any) {
      // Nếu đang có tiến trình chạy rồi thì bỏ qua, không log lỗi nặng
      if (
        error instanceof BadRequestException &&
        typeof error.message === 'string' &&
        error.message.includes('Main withdraw process is already running')
      ) {
        return;
      }

      console.error('Auto main withdraw cron error:', error.message);
    }
  }

  /**
   * Process withdrawals in background
   */
  private async processWithdrawsInBackground(
    activeWallets: ActiveWalletTracker[],
    usdtCoin: Coin,
    mnemonic: string,
    adminId: number,
  ): Promise<void> {
    // Group by network
    const walletsByNetwork = new Map<number, ActiveWalletTracker[]>();
    for (const wallet of activeWallets) {
      const networkId = wallet.awt_network_id;
      if (!walletsByNetwork.has(networkId)) {
        walletsByNetwork.set(networkId, []);
      }
      walletsByNetwork.get(networkId)!.push(wallet);
    }

    // Process each network in parallel
    const networkPromises = Array.from(walletsByNetwork.entries()).map(
      async ([networkId, wallets]) => {
        const network = await this.networkRepository.findOne({
          where: { net_id: networkId },
        });

        if (!network) {
          console.warn(`Network ${networkId} not found, skipping`);
          return;
        }

        // Get main wallet for this network (path 382' — ví sàn)
        const mainWallet = this.getExchangeWallet(mnemonic, network.net_symbol);
        const mainWalletAddress = this.getExchangeWalletPublicKey(
          mainWallet,
          network.net_symbol,
        );

        // CEO wallet (env); fallback main. Không dùng ví trợ phí (369) làm đích CEO.
        let ceoWalletAddress = this.getCeoWalletAddress(
          network.net_symbol,
          mainWalletAddress,
        );

        if (network.net_symbol === 'SOL') {
          const feeSupportWallet = this.getFeeSupportWallet(
            mnemonic,
            'SOL',
          ) as Keypair;
          const feeSupportAddress = feeSupportWallet.publicKey.toBase58();
          if (ceoWalletAddress === feeSupportAddress) {
            console.warn(
              'Main withdraw SOL: CEO was fee support wallet (369), using main wallet (382) as CEO destination.',
            );
            ceoWalletAddress = mainWalletAddress;
          }
        }
        if (this.isTronNetwork(network.net_symbol)) {
          const feeSupportWallet = this.getFeeSupportWallet(
            mnemonic,
            network.net_symbol,
          ) as TronHdWallet;
          const feeSupportAddress = this.tronAddressFromPrivateKeyHex(
            feeSupportWallet.privateKeyHex,
          );
          if (ceoWalletAddress === feeSupportAddress) {
            console.warn(
              'Main withdraw TRX: CEO was fee support wallet (369), using main wallet (382) as CEO destination.',
            );
            ceoWalletAddress = mainWalletAddress;
          }
        }

        const ceoPercent =
          await this.adminSettingsConfigService.getSweepCeoWalletPercent();

        // Get USDT coin network config
        const coinNetwork = await this.coinNetworkRepository.findOne({
          where: {
            cn_coin_id: usdtCoin.coin_id,
            cn_network_id: network.net_id,
            cn_status: CoinNetworkStatus.ACTIVE,
          },
        });

        if (!coinNetwork) {
          console.warn(
            `USDT not configured for network ${network.net_symbol}, skipping`,
          );
          return;
        }

        // SOL: đảm bảo ATA USDT cho mọi đích nhận (CEO và main nếu khác nhau)
        if (network.net_symbol === 'SOL') {
          await this.ensureTargetHasSolUsdtAta(
            network,
            usdtCoin,
            coinNetwork,
            ceoWalletAddress,
            mainWalletAddress,
            mnemonic,
          );
          if (
            !this.sweepDestinationsEqual(
              ceoWalletAddress,
              mainWalletAddress,
              network.net_symbol,
            )
          ) {
            await this.ensureTargetHasSolUsdtAta(
              network,
              usdtCoin,
              coinNetwork,
              mainWalletAddress,
              mainWalletAddress,
              mnemonic,
            );
          }
        }

        const sweepDestinations = {
          mainWalletAddress,
          ceoWalletAddress,
          ceoPercent,
        };

        // Process each wallet in parallel (with error handling)
        const walletPromises = wallets.map(async (tracker) => {
          try {
            await this.processSingleWalletWithdraw(
              tracker,
              network,
              usdtCoin,
              coinNetwork,
              sweepDestinations,
              adminId,
              mnemonic,
            );
          } catch (error) {
            console.error(
              `Error processing wallet ${tracker.awt_address} on ${network.net_symbol}:`,
              error.message,
            );
            // Continue with other wallets
          }
        });

        await Promise.allSettled(walletPromises);
      },
    );

    await Promise.allSettled(networkPromises);
  }

  /**
   * Đồng bộ DB khi on-chain đã không còn tài sản đáng kể (đã sweep / trống) nhưng wdt_withdraw vẫn false.
   */
  private async reconcileWalletDepositTrackerWithdrawn(
    tracker: ActiveWalletTracker,
    network: Network,
    userWalletAddress: string,
    reason: string,
  ): Promise<void> {
    try {
      const result = await this.walletDepositTrackerRepository.update(
        {
          wdt_user_id: tracker.awt_user_id,
          wdt_network_id: network.net_id,
          wdt_address: userWalletAddress,
          wdt_withdraw: false,
        },
        { wdt_withdraw: true },
      );
      if (result.affected && result.affected > 0) {
        console.log(
          `wallet_deposit_tracker: wdt_withdraw=true (${reason}) user=${tracker.awt_user_id} net=${network.net_symbol} addr=${userWalletAddress}`,
        );
      }
    } catch (e: any) {
      console.error(
        `reconcileWalletDepositTrackerWithdrawn failed for ${userWalletAddress}:`,
        e?.message ?? e,
      );
    }
  }

  /**
   * Process withdraw for a single wallet
   */
  private async processSingleWalletWithdraw(
    tracker: ActiveWalletTracker,
    network: Network,
    usdtCoin: Coin,
    coinNetwork: CoinNetwork,
    sweepDestinations: {
      mainWalletAddress: string;
      ceoWalletAddress: string;
      ceoPercent: number;
    },
    adminId: number,
    mnemonic: string,
  ): Promise<void> {
    const userWalletAddress = tracker.awt_address;

    // Get wallet network to get end_path
    const walletNetwork = await this.useWalletNetworkRepository.findOne({
      where: { uwn_id: tracker.uwn_id },
      select: ['uwn_end_path'],
    });

    if (!walletNetwork) {
      console.warn(`Wallet network ${tracker.uwn_id} not found, skipping`);
      return;
    }

    // Generate ví derive (ví thực sự ký và gửi) và dùng địa chỉ này để check balance,
    // tránh lỗi SOL "Attempt to debit an account but found no record of a prior credit".
    const userWallet = this.generateUserWallet(
      mnemonic,
      tracker.awt_user_id,
      walletNetwork.uwn_end_path,
      network.net_symbol,
    );
    const derivedAddress = this.getDerivedWalletAddressString(
      userWallet,
      network.net_symbol,
    );
    // Check native coin balance first (for gas fee and threshold check)
    let nativeCoin: Coin | null = null;
    if (network.net_symbol === 'SOL') {
      nativeCoin = await this.coinRepository.findOne({
        where: { coin_symbol: 'SOL' },
      });
    } else if (network.net_symbol === 'ETH') {
      nativeCoin = await this.coinRepository.findOne({
        where: { coin_symbol: 'ETH' },
      });
    } else if (network.net_symbol === 'BSC') {
      nativeCoin = await this.coinRepository.findOne({
        where: { coin_symbol: 'BNB' },
      });
    } else if (this.isTronNetwork(network.net_symbol)) {
      nativeCoin = await this.coinRepository.findOne({
        where: { coin_symbol: 'TRX' },
      });
    }

    let nativeBalance = 0;
    let nativeCoinNetwork: CoinNetwork | null = null;
    let nativeCoinError = false;

    if (nativeCoin) {
      nativeCoinNetwork = await this.coinNetworkRepository.findOne({
        where: {
          cn_coin_id: nativeCoin.coin_id,
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
      });

      const minGasThreshold =
        network.net_symbol === 'SOL'
          ? 0.001
          : this.isTronNetwork(network.net_symbol)
            ? 0
            : 0.0001;

      if (nativeCoinNetwork && !this.isTronNetwork(network.net_symbol)) {
        try {
          nativeBalance = await this.getWalletBalance(
            network,
            nativeCoin,
            nativeCoinNetwork,
            derivedAddress,
          );
        } catch (error) {
          console.error(
            `Error checking native coin balance for ${derivedAddress}:`,
            error.message,
          );
          nativeCoinError = true;
        }
      } else if (network.net_symbol === 'SOL') {
        // SOL: không có coin_network trong DB vẫn lấy balance qua RPC và nạp phí từ ví 369 (thử DB rồi env)
        try {
          const solUrls =
            await this.adminSettingsConfigService.getRpcSolUrlsToTry();
          if (solUrls.length > 0) {
            nativeBalance = await this.runWithSolRpcUrl(async (rpcUrl) => {
              const connection = new Connection(rpcUrl, {
                commitment: 'confirmed',
              });
              const lamports = await this.rpcRateLimitService.withRpcLimit(() =>
                connection.getBalance((userWallet as Keypair).publicKey),
              );
              return lamports / 1e9;
            });
          }
        } catch (error) {
          console.error(
            `Error getting SOL balance for ${derivedAddress}:`,
            error?.message ?? error,
          );
          nativeCoinError = true;
        }
      } else if (this.isTronNetwork(network.net_symbol)) {
        nativeBalance = 0;
        nativeCoinError = false;
      } else {
        nativeCoinError = true;
      }

      // SOL: nếu chưa có balance tin cậy (lỗi hoặc chưa lấy), thử lấy trực tiếp qua RPC (DB rồi env)
      if (
        network.net_symbol === 'SOL' &&
        (nativeCoinError || nativeBalance < minGasThreshold)
      ) {
        try {
          const solUrls =
            await this.adminSettingsConfigService.getRpcSolUrlsToTry();
          if (solUrls.length > 0) {
            nativeBalance = await this.runWithSolRpcUrl(async (rpcUrl) => {
              const connection = new Connection(rpcUrl, {
                commitment: 'confirmed',
              });
              const lamports = await this.rpcRateLimitService.withRpcLimit(() =>
                connection.getBalance((userWallet as Keypair).publicKey),
              );
              return lamports / 1e9;
            });
            nativeCoinError = false;
          }
        } catch {
          // Giữ nguyên nativeBalance / nativeCoinError
        }
      }

      // Nạp native (SOL / ETH / BNB) từ ví 369 nếu thiếu phí — TRX không nạp TRX lỏng, chỉ delegate (xem khối sau).
      const canTopUpNative =
        network.net_symbol === 'SOL' ||
        (!this.isTronNetwork(network.net_symbol) && nativeCoinNetwork != null);
      if (nativeBalance < minGasThreshold && canTopUpNative) {
        const targetBalance = minGasThreshold * 2;
        const topupAmount = targetBalance - nativeBalance;

        const topupTxHash = await this.sendGasFromSupportWallet(
          network,
          nativeCoin,
          nativeCoinNetwork ?? (null as any),
          mnemonic,
          derivedAddress,
          topupAmount,
        );

        if (!topupTxHash) {
          return;
        }
      }
    } else {
      nativeCoinError = true;
    }

    // SOL: luôn đảm bảo ví user có đủ SOL trả phí (từ ví trợ phí 369), không phụ thuộc nativeCoin/nativeCoinNetwork trong DB
    if (
      network.net_symbol === 'SOL' &&
      !this.feeSupportDepletedNetworks.has('SOL')
    ) {
      try {
        const solUrls =
          await this.adminSettingsConfigService.getRpcSolUrlsToTry();
        if (solUrls.length > 0) {
          const solBalance = await this.runWithSolRpcUrl(async (rpcUrl) => {
            const connection = new Connection(rpcUrl, {
              commitment: 'confirmed',
            });
            const lamports = await this.rpcRateLimitService.withRpcLimit(() =>
              connection.getBalance((userWallet as Keypair).publicKey),
            );
            return lamports / 1e9;
          });
          const minSol = 0.001;
          if (solBalance < minSol) {
            const topupAmount = 0.002;
            const txHash = await this.sendGasFromSupportWallet(
              network,
              null,
              null,
              mnemonic,
              derivedAddress,
              topupAmount,
            );
            if (!txHash) {
              // Fee support depleted or error
            }
          }
        }
      } catch {
        // Ignore SOL top-up errors
      }
    }

    // BSC/ETH: đảm bảo ví user có đủ native (BNB/ETH) trả phí, trợ từ ví 369 nếu thiếu
    const isEvmNetwork =
      network.net_symbol === 'BSC' || network.net_symbol === 'ETH';
    if (
      isEvmNetwork &&
      !this.feeSupportDepletedNetworks.has(network.net_symbol)
    ) {
      try {
        const rpcUrls = await this.getEvmRpcUrls(network);
        const minNativeWei = BigInt('100000000000000'); // 0.0001
        const topupAmount = 0.001;
        let nativeBalanceWei = BigInt(0);
        for (const rpcUrl of rpcUrls) {
          try {
            const provider = createEvmJsonRpcProvider(rpcUrl);
            nativeBalanceWei = await this.rpcRateLimitService.withRpcLimit(() =>
              provider.getBalance(derivedAddress),
            );
            break;
          } catch {
            if (rpcUrls.indexOf(rpcUrl) < rpcUrls.length - 1) continue;
          }
        }
        if (nativeBalanceWei < minNativeWei) {
          const txHash = await this.sendGasFromSupportWallet(
            network,
            null,
            null,
            mnemonic,
            derivedAddress,
            topupAmount,
          );
          if (!txHash) {
            // Fee support depleted or error
          }
        }
      } catch {
        // Ignore native top-up errors
      }
    }

    // TRX: luôn ủy quyền ENERGY (và BANDWIDTH nếu cấu hình) từ ví 369 — không kiểm tra / không nạp TRX lỏng cho ví user.
    if (
      this.isTronNetwork(network.net_symbol) &&
      !this.feeSupportDepletedNetworks.has(network.net_symbol)
    ) {
      try {
        await this.sendGasFromSupportWallet(
          network,
          null,
          null,
          mnemonic,
          derivedAddress,
          0,
        );
      } catch {
        // vẫn tiếp tục sweep
      }
    }

    // Get USDT balance from blockchain (địa chỉ ví derive = ví sẽ gửi, tránh lỗi SOL token account không tồn tại)
    let usdtBalance = 0;
    let usdtBalanceError = false;
    try {
      usdtBalance = await this.getWalletBalance(
        network,
        usdtCoin,
        coinNetwork,
        derivedAddress,
      );
    } catch (error) {
      console.error(
        `Error getting USDT balance for ${derivedAddress}:`,
        error.message,
      );
      usdtBalanceError = true;
      // Continue to check native coin if USDT check fails
    }

    const nativeCoinValueUSD =
      !nativeCoinError && nativeCoin && nativeBalance > 0
        ? nativeBalance * this.getCoinPriceUSD(nativeCoin.coin_symbol)
        : 0;

    // Không sweep khi còn USDT trong khoảng (0, 10] — tránh tốn phí cho số nhỏ / chờ gom thêm
    if (!usdtBalanceError && usdtBalance > 0 && usdtBalance <= 10) {
      console.log(
        `Wallet ${derivedAddress} has USDT balance <= 10 (${usdtBalance}), skipping main withdraw`,
      );
      return;
    }

    // On-chain đã gần như hết USDT (<1) và native không đáng kể (<$2): coi như đã xử lý (kể cả sweep thủ công / lỗi cập nhật DB trước đó)
    if (!usdtBalanceError && !nativeCoinError) {
      if (usdtBalance < 1 && nativeCoinValueUSD < 2) {
        await this.reconcileWalletDepositTrackerWithdrawn(
          tracker,
          network,
          userWalletAddress,
          'on-chain USDT<1 and native USD<2',
        );
        return;
      }
    }
    // If there's an error in checking, proceed with withdrawal (as per requirement)

    // Process withdrawals for coins that meet conditions
    const coinsToWithdraw: Array<{
      coin: Coin;
      coinNetwork: CoinNetwork;
      balance: number;
      needsBalanceCheck: boolean; // Flag to indicate if balance needs to be fetched during withdrawal
    }> = [];

    // Add USDT: chỉ thêm khi balance > 0; nếu lỗi đọc balance thì thử đọc lại trong loop (trừ SOL: không thử rút khi chưa biết balance)
    if (usdtBalance > 0) {
      coinsToWithdraw.push({
        coin: usdtCoin,
        coinNetwork: coinNetwork,
        balance: usdtBalance,
        needsBalanceCheck: usdtBalanceError,
      });
    } else if (
      usdtBalanceError &&
      network.net_symbol !== 'SOL' &&
      !this.isTronNetwork(network.net_symbol)
    ) {
      // EVM: có thể RPC lỗi tạm thời, thử đọc balance lại trong loop
      coinsToWithdraw.push({
        coin: usdtCoin,
        coinNetwork: coinNetwork,
        balance: 0,
        needsBalanceCheck: true,
      });
    }
    // SOL: không thêm khi usdtBalance = 0 (tránh thử rút khi ATA không tồn tại / balance 0)

    // Process each coin that meets withdrawal conditions
    for (const {
      coin,
      coinNetwork: cn,
      balance,
      needsBalanceCheck,
    } of coinsToWithdraw) {
      try {
        let actualBalance = balance;

        // If balance check failed, try to get balance directly from blockchain (dùng derived address)
        if (needsBalanceCheck) {
          try {
            actualBalance = await this.getWalletBalance(
              network,
              coin,
              cn,
              derivedAddress,
            );

            if (actualBalance <= 0) {
              continue;
            }
          } catch (error) {
            console.error(
              `Error getting ${coin.coin_symbol} balance during withdrawal for ${derivedAddress}:`,
              error.message,
            );
            // If still can't get balance, skip this coin
            continue;
          }
        }

        // Rút toàn bộ USDT trên mạng; chia CEO/main theo `wallet.sweep.ceo_wallet_percent` (trừ khi cùng đích)
        const withdrawAmount = actualBalance;

        if (withdrawAmount <= 0) {
          continue;
        }

        // SOL SPL: ví có USDT nhưng thiếu SOL trả phí thì thử nạp từ ví trợ phí (path 369) trước khi skip
        if (
          network.net_symbol === 'SOL' &&
          coin.coin_symbol !== 'SOL' &&
          nativeCoin &&
          !this.feeSupportDepletedNetworks.has('SOL')
        ) {
          try {
            const solUrls =
              await this.adminSettingsConfigService.getRpcSolUrlsToTry();
            if (solUrls.length > 0) {
              const solLamports = await this.runWithSolRpcUrl(
                async (rpcUrl) => {
                  const connection = new Connection(rpcUrl, {
                    commitment: 'confirmed',
                  });
                  const keypair = userWallet as Keypair;
                  return this.rpcRateLimitService.withRpcLimit(() =>
                    connection.getBalance(keypair.publicKey),
                  );
                },
              );
              if (
                solLamports <
                AdminsWalletOpsService.MIN_SOL_LAMPORTS_FOR_SPL_FEE
              ) {
                const topupAmount = 0.002;
                const topupTx = await this.sendGasFromSupportWallet(
                  network,
                  nativeCoin,
                  nativeCoinNetwork ?? (null as any),
                  mnemonic,
                  derivedAddress,
                  topupAmount,
                );
                if (topupTx) {
                  // SOL topped up for USDT withdraw
                }
              }
            }
          } catch {
            // Bỏ qua lỗi, tiếp tục kiểm tra shouldSkipSolTokenWithdraw
          }
        }

        // SOL SPL: xác nhận ATA tồn tại và đủ balance trước khi gửi, tránh lỗi "no record of a prior credit"
        if (network.net_symbol === 'SOL' && coin.coin_symbol !== 'SOL') {
          const solSkip = await this.shouldSkipSolTokenWithdraw(
            network,
            coin,
            cn,
            userWallet as Keypair,
            withdrawAmount,
            derivedAddress,
          );
          if (solSkip) {
            continue;
          }
        }

        // userWallet đã tạo ở đầu hàm (ví derive), dùng luôn để gửi
        const { mainWalletAddress, ceoWalletAddress, ceoPercent } =
          sweepDestinations;
        const sameDest = this.sweepDestinationsEqual(
          ceoWalletAddress,
          mainWalletAddress,
          network.net_symbol,
        );

        type Leg = { to: string; amount: number; role: string };
        let legs: Leg[];
        if (sameDest || ceoPercent <= 0) {
          legs = [
            {
              to: mainWalletAddress,
              amount: withdrawAmount,
              role: 'main',
            },
          ];
        } else if (ceoPercent >= 100) {
          legs = [
            {
              to: ceoWalletAddress,
              amount: withdrawAmount,
              role: 'ceo',
            },
          ];
        } else {
          const { toCeo, toMain } = this.splitSweepUsdtAmounts(
            withdrawAmount,
            ceoPercent,
          );
          legs = [];
          if (toCeo > 0) {
            legs.push({ to: ceoWalletAddress, amount: toCeo, role: 'ceo' });
          }
          if (toMain > 0) {
            legs.push({ to: mainWalletAddress, amount: toMain, role: 'main' });
          }
        }

        if (legs.length === 0) {
          continue;
        }

        const txHashes: string[] = [];
        for (const leg of legs) {
          const txHash = await this.sendTransactionToMain(
            network,
            coin,
            cn,
            userWallet,
            leg.to,
            leg.amount,
          );
          txHashes.push(txHash);

          const existingByHash = await this.walletHistoryRepository.findOne({
            where: {
              wh_hash: txHash,
              wh_option: WalletHistoryOption.ADMIN_DEPOSIT,
            },
          });
          if (!existingByHash) {
            await this.walletHistoryRepository.save({
              wh_wallet_netword_id: tracker.uwn_id,
              wh_type: WalletHistoryType.CRYPTO,
              wh_option: WalletHistoryOption.ADMIN_DEPOSIT,
              wh_coins: coin.coin_id,
              wh_amount: leg.amount,
              wh_hash: txHash,
              wh_status: WalletHistoryStatus.SUCCESS,
              wh_user: tracker.awt_user_id,
              wh_node: `${network.net_symbol}:${leg.role}`,
            });
          }
        }

        const legSummary = legs
          .map((l) => `${l.amount}→${l.role}(${l.to})`)
          .join(' | ');
        await this.adminLogRepository.save({
          log_admin_id: adminId,
          log_action: AdminLogAction.UPDATE,
          log_module: AdminLogModule.SYSTEM,
          log_description:
            `Main withdraw: ${withdrawAmount} ${coin.coin_symbol} from ${derivedAddress} on ${network.net_symbol} ` +
            `(ceo%=${ceoPercent}): ${legSummary}. Tx: ${txHashes.join(', ')}`,
          log_ip_address: null,
          log_user_agent: null,
          log_target_id: tracker.uwn_id,
          log_target_type: 'wallet',
          log_old_data: { balance },
          log_new_data: {
            withdrawAmount,
            txHashes,
            legs,
            ceoPercent,
          },
        });

        // Sau khi rút tiền thành công, cập nhật wdt_withdraw = true
        // cho tất cả các bản ghi có cùng địa chỉ ví (wdt_address) của user trên network này
        try {
          await this.walletDepositTrackerRepository.update(
            {
              wdt_user_id: tracker.awt_user_id,
              wdt_network_id: network.net_id,
              wdt_address: userWalletAddress,
            },
            { wdt_withdraw: true },
          );
        } catch (updateError: any) {
          console.error(
            `Error updating wallet_deposit_tracker for ${userWalletAddress} on ${network.net_symbol}:`,
            updateError.message,
          );
        }
      } catch (error) {
        console.error(
          `Error withdrawing ${coin.coin_symbol} from ${derivedAddress} on ${network.net_symbol}:`,
          error.message,
        );
        // Continue with other coins - don't throw
      }
    }
  }

  /** RPC SOL: từ admin_settings (as_config_rps_sol) hoặc .env SOLANA_RPC_URL. */
  private async getEffectiveRpcSol(): Promise<string> {
    const url = await this.adminSettingsConfigService.getEffectiveRpcSol();
    if (!url) {
      throw new BadRequestException(
        'SOLANA_RPC_URL not configured (admin_settings or .env)',
      );
    }
    return url;
  }

  /** Gọi SOL RPC (một URL duy nhất: DB hoặc env). */
  private async runWithSolRpcUrl<T>(
    fn: (rpcUrl: string) => Promise<T>,
  ): Promise<T> {
    const urls = await this.adminSettingsConfigService.getRpcSolUrlsToTry();
    if (urls.length === 0) {
      throw new BadRequestException(
        'SOLANA_RPC_URL not configured (admin_settings or .env)',
      );
    }
    let lastErr: Error | null = null;
    for (const rpcUrl of urls) {
      try {
        return await fn(rpcUrl);
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        continue;
      }
    }
    throw lastErr ?? new BadRequestException('SOLANA_RPC_URL not configured');
  }

  private async getEvmRpcUrls(network: Network): Promise<string[]> {
    return this.adminSettingsConfigService.getRpcUrlsToTryByNetwork(
      network.net_symbol,
    );
  }

  private tronApiHeaders(): Record<string, string> | undefined {
    const key =
      this.configService.get<string>('TRONGRID_API_KEY')?.trim() ||
      this.configService.get<string>('TRON_API_KEY')?.trim();
    return key ? { 'Tron-Pro-Api-Key': key } : undefined;
  }

  private async getTronFullHost(network: Network): Promise<string> {
    const urls = await this.adminSettingsConfigService.getRpcUrlsToTryByNetwork(
      network.net_symbol,
    );
    if (!urls.length) {
      throw new BadRequestException(
        `Tron RPC not configured for network ${network.net_symbol}`,
      );
    }
    return urls[0].replace(/\/+$/, '').trim();
  }

  private createTronWebReadOnly(fullHost: string): TronWeb {
    return new TronWeb({
      fullHost: fullHost.replace(/\/+$/, ''),
      headers: this.tronApiHeaders(),
    });
  }

  private createTronWebWithKey(
    fullHost: string,
    privateKeyHex: string,
  ): TronWeb {
    return new TronWeb({
      fullHost: fullHost.replace(/\/+$/, ''),
      headers: this.tronApiHeaders(),
      privateKey: privateKeyHex,
    });
  }

  private normalizeTronAddress(tw: TronWeb, address: string): string {
    const a = address.trim();
    if (!a) throw new BadRequestException('Empty Tron address');
    if (tw.isAddress(a)) return a;
    if (/^41[0-9a-fA-F]{40}$/.test(a)) {
      return tw.address.fromHex(a);
    }
    throw new BadRequestException(`Invalid Tron address: ${a.slice(0, 12)}…`);
  }

  private resolveTronContractBase58(
    tw: TronWeb,
    mintOrContract: string,
  ): string {
    const s = mintOrContract.trim();
    if (tw.isAddress(s)) return s;
    if (/^41[0-9a-fA-F]{40}$/.test(s)) {
      return tw.address.fromHex(s);
    }
    throw new BadRequestException(
      `Invalid TRC20 contract: ${s.slice(0, 16)}… (expect base58 T… or 41-hex)`,
    );
  }

  private extractTronTxId(result: unknown): string {
    const r = result as {
      transaction?: { txID?: string };
      txid?: string;
    };
    const id = r?.transaction?.txID ?? r?.txid;
    if (id && typeof id === 'string') return id;
    throw new BadRequestException('Tron broadcast: missing txID');
  }

  /**
   * Giới hạn sun ủy quyền theo getCanDelegatedMaxSize (ví trợ phí phải đã stake đủ).
   */
  private async clampTronDelegateSun(
    tw: TronWeb,
    ownerBase58: string,
    resource: 'ENERGY' | 'BANDWIDTH',
    requestedSun: number,
  ): Promise<number> {
    if (requestedSun <= 0) return 0;
    try {
      const res = (await this.rpcRateLimitService.withRpcLimit(() =>
        tw.trx.getCanDelegatedMaxSize(ownerBase58, resource),
      )) as { max_size?: number };
      const max = res?.max_size;
      if (typeof max === 'number' && Number.isFinite(max) && max > 0) {
        return Math.min(requestedSun, Math.floor(max));
      }
    } catch {
      // RPC không hỗ trợ hoặc lỗi — thử nguyên requestedSun
    }
    return requestedSun;
  }

  private async broadcastTronSignedTransaction(
    tw: TronWeb,
    privateKeyHex: string,
    unsignedTx: object,
  ): Promise<string> {
    const signed = await this.rpcRateLimitService.withRpcLimit(() =>
      tw.trx.sign(unsignedTx as any, privateKeyHex),
    );
    const out = await this.rpcRateLimitService.withRpcLimit(() =>
      tw.trx.sendRawTransaction(signed as any),
    );
    const ok = (out as { result?: boolean }).result;
    if (ok === false) {
      const msg = (out as { message?: string }).message || 'broadcast failed';
      throw new Error(String(msg));
    }
    return this.extractTronTxId(out);
  }

  /**
   * Ủy quyền ENERGY và/hoặc BANDWIDTH (Stake 2.0) từ ví trợ phí → ví user.
   * Trả về txID giao dịch ủy quyền cuối cùng, hoặc null nếu không có gì được gửi.
   */
  private async delegateTronResourcesFromFeeWallet(
    tw: TronWeb,
    feePrivateKeyHex: string,
    fromBase58: string,
    receiverBase58: string,
    energyTrx: number,
    bandwidthTrx: number,
  ): Promise<string | null> {
    let lastTxId: string | null = null;

    if (energyTrx > 0) {
      try {
        let sun = Math.floor(energyTrx * 1_000_000);
        sun = await this.clampTronDelegateSun(tw, fromBase58, 'ENERGY', sun);
        if (sun > 0) {
          const tx = await this.rpcRateLimitService.withRpcLimit(() =>
            tw.transactionBuilder.delegateResource(
              sun,
              receiverBase58,
              'ENERGY',
              fromBase58,
              false,
              undefined,
            ),
          );
          lastTxId = await this.broadcastTronSignedTransaction(
            tw,
            feePrivateKeyHex,
            tx as object,
          );
        }
      } catch (e: any) {
        console.warn(
          `[TRX] delegate ENERGY failed:`,
          e?.message != null ? e.message : e,
        );
      }
    }

    if (bandwidthTrx > 0) {
      try {
        let sun = Math.floor(bandwidthTrx * 1_000_000);
        sun = await this.clampTronDelegateSun(tw, fromBase58, 'BANDWIDTH', sun);
        if (sun > 0) {
          const tx = await this.rpcRateLimitService.withRpcLimit(() =>
            tw.transactionBuilder.delegateResource(
              sun,
              receiverBase58,
              'BANDWIDTH',
              fromBase58,
              false,
              undefined,
            ),
          );
          lastTxId = await this.broadcastTronSignedTransaction(
            tw,
            feePrivateKeyHex,
            tx as object,
          );
        }
      } catch (e: any) {
        console.warn(
          `[TRX] delegate BANDWIDTH failed:`,
          e?.message != null ? e.message : e,
        );
      }
    }

    return lastTxId;
  }

  private async getTronNativeTrxBalance(
    network: Network,
    address: string,
  ): Promise<number> {
    const fullHost = await this.getTronFullHost(network);
    const tw = this.createTronWebReadOnly(fullHost);
    const addr = this.normalizeTronAddress(tw, address);
    const sun = await this.rpcRateLimitService.withRpcLimit(() =>
      tw.trx.getBalance(addr),
    );
    return Number(sun) / 1_000_000;
  }

  /**
   * Get wallet balance from blockchain
   */
  private async getWalletBalance(
    network: Network,
    coin: Coin,
    coinNetwork: CoinNetwork,
    address: string,
  ): Promise<number> {
    if (network.net_symbol === 'SOL') {
      return this.runWithSolRpcUrl(async (rpcUrl) => {
        const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
        const addressPublicKey = new PublicKey(address);

        if (coin.coin_symbol === 'SOL') {
          const balance = await this.rpcRateLimitService.withRpcLimit(() =>
            connection.getBalance(addressPublicKey),
          );
          return balance / 1e9; // Convert lamports to SOL
        } else {
          // SPL Token
          const mintStr = this.getCoinNetworkMint(coinNetwork);
          if (!mintStr) {
            return 0;
          }
          const mintPublicKey = new PublicKey(mintStr);
          const tokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            addressPublicKey,
          );
          try {
            const accountInfo = await this.rpcRateLimitService.withRpcLimit(
              () => getAccount(connection, tokenAccount),
            );
            const mintInfo = await this.rpcRateLimitService.withRpcLimit(() =>
              getMint(connection, mintPublicKey),
            );
            return Number(accountInfo.amount) / Math.pow(10, mintInfo.decimals);
          } catch {
            return 0; // Token account doesn't exist or has no balance
          }
        }
      });
    } else if (this.isTronNetwork(network.net_symbol)) {
      const fullHost = await this.getTronFullHost(network);
      const tw = this.createTronWebReadOnly(fullHost);
      const addr = this.normalizeTronAddress(tw, address);
      const sym = coin.coin_symbol.trim().toUpperCase();
      const netSym = network.net_symbol.trim().toUpperCase();
      const isNativeTrx = sym === 'TRX' || sym === netSym;
      if (isNativeTrx) {
        const sun = await this.rpcRateLimitService.withRpcLimit(() =>
          tw.trx.getBalance(addr),
        );
        return Number(sun) / 1_000_000;
      }
      if (!coinNetwork.cn_coin_mint) {
        return 0;
      }
      const contractAddr = this.resolveTronContractBase58(
        tw,
        coinNetwork.cn_coin_mint,
      );
      const contract = await tw.contract().at(contractAddr);
      const callOpts = { from: addr };
      const [rawBalance, decimalsRaw] = await Promise.all([
        this.rpcRateLimitService.withRpcLimit(() =>
          contract.balanceOf(addr).call(callOpts),
        ),
        this.rpcRateLimitService.withRpcLimit(() =>
          contract.decimals().call(callOpts),
        ),
      ]);
      const dec =
        typeof decimalsRaw === 'object' &&
        decimalsRaw != null &&
        'toString' in decimalsRaw
          ? Number((decimalsRaw as { toString(): string }).toString())
          : Number(decimalsRaw);
      const balStr =
        typeof rawBalance === 'object' &&
        rawBalance != null &&
        'toString' in rawBalance
          ? (rawBalance as { toString(): string }).toString()
          : String(rawBalance);
      const n = Number(balStr);
      if (!Number.isFinite(n) || dec < 0 || dec > 36) {
        return 0;
      }
      return n / 10 ** dec;
    } else {
      // EVM – RPC từ DB hoặc env, retry khi invalid JSON / lỗi mạng
      const rpcUrls = await this.getEvmRpcUrls(network);
      if (rpcUrls.length === 0) {
        throw new BadRequestException(
          `RPC endpoint not configured for network ${network.net_symbol}`,
        );
      }

      const delayMs = 800;
      let lastError: Error | null = null;

      for (let urlIndex = 0; urlIndex < rpcUrls.length; urlIndex++) {
        const rpcUrl = rpcUrls[urlIndex];
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const provider = createEvmJsonRpcProvider(rpcUrl);

            if (
              coin.coin_symbol === network.net_symbol ||
              (network.net_symbol === 'ETH' && coin.coin_symbol === 'ETH') ||
              (network.net_symbol === 'BSC' && coin.coin_symbol === 'BNB')
            ) {
              const balance = await this.rpcRateLimitService.withRpcLimit(() =>
                provider.getBalance(address),
              );
              const balanceStr =
                typeof balance === 'bigint'
                  ? balance.toString()
                  : String(balance);
              return parseFloat(parseUnits(balanceStr, 0).toString()) / 1e18;
            } else {
              if (!coinNetwork.cn_coin_mint) {
                return 0;
              }
              const erc20Abi = [
                'function balanceOf(address owner) view returns (uint256)',
                'function decimals() view returns (uint8)',
              ];
              const tokenContractAddress = this.normalizeEvmAddress(
                coinNetwork.cn_coin_mint,
              );
              const tokenContract = new Contract(
                tokenContractAddress,
                new Interface(erc20Abi),
                provider,
              );
              const balance = await this.rpcRateLimitService.withRpcLimit(() =>
                tokenContract.balanceOf(address),
              );
              const decimalsRaw = await this.rpcRateLimitService.withRpcLimit(
                () => tokenContract.decimals(),
              );
              const decimals =
                typeof decimalsRaw === 'bigint'
                  ? Number(decimalsRaw)
                  : Number(decimalsRaw);
              const balanceNum =
                typeof balance === 'bigint'
                  ? Number(balance)
                  : parseFloat(balance.toString());
              return balanceNum / Math.pow(10, decimals);
            }
          } catch (err: any) {
            lastError = err;
            const isRetryable =
              err?.code === 'UNSUPPORTED_OPERATION' ||
              (typeof err?.message === 'string' &&
                (err.message.includes('valid JSON') ||
                  err.message.includes('ECONNRESET') ||
                  err.message.includes('ETIMEDOUT') ||
                  err.message.includes('network')));
            if (isRetryable && attempt < 2) {
              await new Promise((r) => setTimeout(r, delayMs));
              continue;
            }
            if (urlIndex < rpcUrls.length - 1) {
              break;
            }
            throw err;
          }
        }
      }
      throw lastError ?? new Error('EVM getWalletBalance failed after retries');
    }
  }

  /**
   * Chuyển toàn bộ tài sản từ ví trợ phí (path 369) sang ví CEO (fallback ví main 382).
   * - USDT: chỉ chuyển nếu balance >= 1 USDT.
   * - Native (SOL/ETH/BNB trên BSC): chuyển gần như toàn bộ, giữ lại một ít làm phí.
   */
  async feeSubsidyToMain(adminId: number): Promise<{
    statusCode: number;
    message: string;
    data: {
      results: Array<{
        network: string;
        usdtTransferred: number;
        nativeTransferred: number;
        usdtTxHash?: string | null;
        nativeTxHash?: string | null;
      }>;
    };
  }> {
    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
      throw new BadRequestException('Wallet seed not configured or invalid');
    }

    const usdtCoin = await this.coinRepository.findOne({
      where: { coin_symbol: 'USDT' },
    });
    if (!usdtCoin) {
      throw new BadRequestException('USDT coin not found');
    }

    // Lấy các network đang active
    const networks = await this.networkRepository.find({
      where: { net_status: NetStatus.ACTIVE },
      order: { net_id: 'ASC' },
    });

    const results: Array<{
      network: string;
      usdtTransferred: number;
      nativeTransferred: number;
      usdtTxHash?: string | null;
      nativeTxHash?: string | null;
    }> = [];

    for (const network of networks) {
      const feeWallet = this.getFeeSupportWallet(mnemonic, network.net_symbol);
      const feeWalletAddress = this.getExchangeWalletPublicKey(
        feeWallet,
        network.net_symbol,
      );

      const mainWallet = this.getExchangeWallet(mnemonic, network.net_symbol);
      const mainWalletAddress = this.getExchangeWalletPublicKey(
        mainWallet,
        network.net_symbol,
      );
      let ceoWalletAddress = this.getCeoWalletAddress(
        network.net_symbol,
        mainWalletAddress,
      );
      if (network.net_symbol === 'SOL') {
        const feeW = this.getFeeSupportWallet(mnemonic, 'SOL') as Keypair;
        if (ceoWalletAddress === feeW.publicKey.toBase58()) {
          ceoWalletAddress = mainWalletAddress;
        }
      }
      if (this.isTronNetwork(network.net_symbol)) {
        const feeW = this.getFeeSupportWallet(
          mnemonic,
          network.net_symbol,
        ) as TronHdWallet;
        const feeAddr = this.tronAddressFromPrivateKeyHex(feeW.privateKeyHex);
        if (ceoWalletAddress === feeAddr) {
          ceoWalletAddress = mainWalletAddress;
        }
      }

      const sweepCeoPercent =
        await this.adminSettingsConfigService.getSweepCeoWalletPercent();
      const sameSweepDest = this.sweepDestinationsEqual(
        ceoWalletAddress,
        mainWalletAddress,
        network.net_symbol,
      );

      console.log(
        '[feeSubsidyToMain] Start network',
        network.net_symbol,
        '| feeWallet =',
        feeWalletAddress,
        '| ceoWallet =',
        ceoWalletAddress,
        '| mainWallet =',
        mainWalletAddress,
        '| ceoPercent =',
        sweepCeoPercent,
      );

      let usdtTransferred = 0;
      let nativeTransferred = 0;
      let usdtTxHash: string | null = null;
      let nativeTxHash: string | null = null;

      // 1. Chuyển USDT từ ví trợ phí (path 369) sang ví CEO (fallback main 382) nếu balance >= 1 USDT
      const usdtCoinNetwork = await this.coinNetworkRepository.findOne({
        where: {
          cn_coin_id: usdtCoin.coin_id,
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
      });

      if (usdtCoinNetwork) {
        try {
          const usdtBalance = await this.getWalletBalance(
            network,
            usdtCoin,
            usdtCoinNetwork,
            feeWalletAddress,
          );

          console.log(
            '[feeSubsidyToMain] USDT balance',
            usdtBalance,
            'on',
            network.net_symbol,
            'for fee wallet',
            feeWalletAddress,
          );

          if (usdtBalance >= 1) {
            const sendAmount = usdtBalance;
            const usdtHashes: string[] = [];
            try {
              type Leg = { to: string; amount: number };
              let legs: Leg[];
              if (sameSweepDest || sweepCeoPercent <= 0) {
                legs = [{ to: mainWalletAddress, amount: sendAmount }];
              } else if (sweepCeoPercent >= 100) {
                legs = [{ to: ceoWalletAddress, amount: sendAmount }];
              } else {
                const { toCeo, toMain } = this.splitSweepUsdtAmounts(
                  sendAmount,
                  sweepCeoPercent,
                );
                legs = [];
                if (toCeo > 0) {
                  legs.push({ to: ceoWalletAddress, amount: toCeo });
                }
                if (toMain > 0) {
                  legs.push({ to: mainWalletAddress, amount: toMain });
                }
              }
              for (const leg of legs) {
                console.log(
                  '[feeSubsidyToMain] Sending USDT',
                  leg.amount,
                  'from fee wallet',
                  feeWalletAddress,
                  'to',
                  leg.to,
                  'on',
                  network.net_symbol,
                );
                const h = await this.sendTransactionToMain(
                  network,
                  usdtCoin,
                  usdtCoinNetwork,
                  feeWallet,
                  leg.to,
                  leg.amount,
                );
                usdtHashes.push(h);
              }
              usdtTransferred = sendAmount;
              usdtTxHash = usdtHashes.length ? usdtHashes.join(',') : null;
            } catch (error: any) {
              console.error(
                `feeSubsidyToMain USDT transfer failed on ${network.net_symbol}:`,
                error?.message || error,
              );
            }
          } else {
            console.log(
              '[feeSubsidyToMain] Skip USDT on',
              network.net_symbol,
              'because balance < 1 USDT:',
              usdtBalance,
            );
          }
        } catch (error: any) {
          console.error(
            `feeSubsidyToMain get USDT balance failed on ${network.net_symbol}:`,
            error?.message || error,
          );
        }
      }

      // 2. Chuyển native coin (SOL / ETH / BNB trên BSC) còn lại từ ví trợ phí sang ví CEO (fallback main 382)
      try {
        let nativeBalance = 0;

        if (network.net_symbol === 'SOL') {
          nativeBalance = await this.runWithSolRpcUrl(async (rpcUrl) => {
            const connection = new Connection(rpcUrl, {
              commitment: 'confirmed',
            });
            const balanceLamports = await this.rpcRateLimitService.withRpcLimit(
              () => connection.getBalance(new PublicKey(feeWalletAddress)),
            );
            return balanceLamports / 1e9;
          });
        } else if (this.isTronNetwork(network.net_symbol)) {
          nativeBalance = await this.getTronNativeTrxBalance(
            network,
            feeWalletAddress,
          );
        } else {
          const rpcUrls = await this.getEvmRpcUrls(network);
          if (rpcUrls.length === 0) {
            throw new BadRequestException(
              `RPC endpoint not configured for network ${network.net_symbol}`,
            );
          }

          let lastError: Error | null = null;
          for (let urlIndex = 0; urlIndex < rpcUrls.length; urlIndex++) {
            const rpcUrl = rpcUrls[urlIndex];
            try {
              const provider = createEvmJsonRpcProvider(rpcUrl);
              const balanceWei = await this.rpcRateLimitService.withRpcLimit(
                () => provider.getBalance(feeWalletAddress),
              );
              const balanceStr =
                typeof balanceWei === 'bigint'
                  ? balanceWei.toString()
                  : String(balanceWei);
              nativeBalance =
                parseFloat(parseUnits(balanceStr, 0).toString()) / 1e18;
              lastError = null;
              break;
            } catch (err: any) {
              lastError = err;
              if (urlIndex < rpcUrls.length - 1) continue;
            }
          }
          if (lastError) throw lastError;
        }

        const minRemain =
          network.net_symbol === 'SOL'
            ? 0.001
            : this.isTronNetwork(network.net_symbol)
              ? 5
              : 0.0001;
        console.log(
          '[feeSubsidyToMain] Native balance',
          nativeBalance,
          'on',
          network.net_symbol,
          'for fee wallet',
          feeWalletAddress,
          '| minRemain =',
          minRemain,
        );

        if (nativeBalance > minRemain) {
          const sendAmount = nativeBalance - minRemain;
          const nativeHashes: string[] = [];
          try {
            type NLeg = { to: string; amount: number };
            let nLegs: NLeg[];
            if (sameSweepDest || sweepCeoPercent <= 0) {
              nLegs = [{ to: mainWalletAddress, amount: sendAmount }];
            } else if (sweepCeoPercent >= 100) {
              nLegs = [{ to: ceoWalletAddress, amount: sendAmount }];
            } else {
              const toCeo = sendAmount * (sweepCeoPercent / 100);
              const toMain = sendAmount - toCeo;
              nLegs = [];
              if (toCeo > 1e-12) {
                nLegs.push({ to: ceoWalletAddress, amount: toCeo });
              }
              if (toMain > 1e-12) {
                nLegs.push({ to: mainWalletAddress, amount: toMain });
              }
            }
            for (const leg of nLegs) {
              console.log(
                '[feeSubsidyToMain] Sending native',
                leg.amount,
                'from fee wallet',
                feeWalletAddress,
                'to',
                leg.to,
                'on',
                network.net_symbol,
              );
              const h = await this.sendGasFromSupportWallet(
                network,
                null,
                null,
                mnemonic,
                leg.to,
                leg.amount,
              );
              if (h) {
                nativeHashes.push(h);
              }
            }
            nativeTransferred = sendAmount;
            nativeTxHash = nativeHashes.length ? nativeHashes.join(',') : null;
          } catch (error: any) {
            console.error(
              `feeSubsidyToMain native transfer failed on ${network.net_symbol}:`,
              error?.message || error,
            );
          }
        } else {
          console.log(
            '[feeSubsidyToMain] Skip native on',
            network.net_symbol,
            'because balance <= minRemain:',
            nativeBalance,
            '<=',
            minRemain,
          );
        }
      } catch (error: any) {
        console.error(
          `feeSubsidyToMain get native balance failed on ${network.net_symbol}:`,
          error?.message || error,
        );
      }

      results.push({
        network: network.net_symbol,
        usdtTransferred,
        nativeTransferred,
        usdtTxHash,
        nativeTxHash,
      });
    }

    // Ghi log admin cho action này
    await this.adminLogRepository.save({
      log_admin_id: adminId,
      log_action: AdminLogAction.UPDATE,
      log_module: AdminLogModule.SYSTEM,
      log_description: `Super admin triggered fee-subsidy to main for ${networks.length} fee wallets`,
      log_ip_address: null,
      log_user_agent: null,
      log_target_type: 'wallet',
      log_old_data: null,
      log_new_data: { networks: networks.map((n) => n.net_symbol) },
    });

    return {
      statusCode: 200,
      message: 'Fee subsidy wallets transferred to CEO/main wallets',
      data: {
        results,
      },
    };
  }

  /**
   * Lấy danh sách KOL articles với filter
   * @param status - Filter theo status (optional)
   * @param userId - Filter theo user_id (optional)
   * @returns Danh sách KOL articles
   */
}
