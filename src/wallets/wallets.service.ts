/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import axios from 'axios';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bip39 from 'bip39';
import * as bip32 from 'bip32';
import * as tinysecp from 'tiny-secp256k1';
import { derivePath } from 'ed25519-hd-key';
import {
  Keypair,
  Connection,
  PublicKey,
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
  Mnemonic,
  parseUnits,
  Contract,
  Interface,
  Wallet,
  getAddress,
} from 'ethers';
import { TronWeb } from 'tronweb';
import { createEvmJsonRpcProvider } from '../common/evm-json-rpc-provider.factory';
import * as QRCode from 'qrcode';
import { UserWalletNetwork } from './entities/user-wallet-network.entity';
import { UserWallet, WalletType } from './entities/user-wallet.entity';
import {
  WalletHistory,
  WalletHistoryType,
  WalletHistoryOption,
  WalletHistoryStatus,
} from './entities/wallet-history.entity';
import {
  WalletTransfer,
  WalletTransferFrom,
  WalletTransferTo,
  WalletTransferStatus,
} from './entities/wallet-transfer.entity';
import { User, UserStatus } from '../users/entities/user.entity';
import {
  UserCode,
  UserCodePlace,
  UserCodeType,
} from '../users/entities/user-code.entity';
import { ActiveWalletTracker } from './entities/active-wallet-tracker.entity';
import { Coin } from '../settings/entities/coin.entity';
import { CoinStatus } from '../settings/entities/coin.entity';
import { Network } from '../settings/entities/network.entity';
import {
  CoinNetwork,
  CoinNetworkStatus,
} from '../settings/entities/coin-network.entity';
import { FundType } from '../settings/entities/admin-setting.entity';
import { WalletsSchedulerService } from './wallets-scheduler.service';
import { RpcRateLimitService } from '../common/rpc-rate-limit.service';
import { AdminSettingsConfigService } from '../settings/admin-settings-config.service';
import { requireTotpIfEnabled } from '../common/helpers/two-factor.helper';
import { CacheService } from '../systems/cache.service';
import { EmailService } from '../systems/email.service';

/** Thông báo lỗi chung trả về frontend khi rút tiền thất bại (ví main thiếu dư, RPC lỗi, simulation fail, ...). */
const WITHDRAW_ERROR_MESSAGE =
  'The system is overloaded. Please try again later or try a different network.';

/** CoinGecko id → symbol; giá quy đổi gần USDT (dùng USD ~ USDT). */
const TOKEN_USDT_PRICE_COINGECKO_IDS: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  binancecoin: 'BNB',
  tron: 'TRX',
  arbitrum: 'ARB',
  tether: 'USDT',
};

const TOKEN_USDT_PRICES_CACHE_KEY = 'wallets:token_prices_usdt';
const TOKEN_USDT_PRICES_TTL_SEC = 60;
const TOKEN_USDT_PRICES_REFRESH_MS = 60_000;

/** Ví TRX derive HD — private key hex 64 ký tự (TronWeb) */
type TronHdWallet = { privateKeyHex: string };

@Injectable()
export class WalletsService implements OnModuleInit {
  private readonly logger = new Logger(WalletsService.name);

  private static readonly TRON_TRC20_FEE_LIMIT_SUN = 100_000_000;

  private debugShortAddr(addr: string, head = 8, tail = 6): string {
    const s = (addr || '').trim();
    if (!s) return '(empty)';
    if (s.length <= head + tail + 3) return s;
    return `${s.slice(0, head)}...${s.slice(-tail)}`;
  }

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(UserWalletNetwork)
    private useWalletNetworkRepository: Repository<UserWalletNetwork>,
    @InjectRepository(UserWallet)
    private userWalletRepository: Repository<UserWallet>,
    @InjectRepository(WalletHistory)
    private walletHistoryRepository: Repository<WalletHistory>,
    @InjectRepository(ActiveWalletTracker)
    private activeWalletTrackerRepository: Repository<ActiveWalletTracker>,
    @InjectRepository(Coin)
    private coinRepository: Repository<Coin>,
    @InjectRepository(Network)
    private networkRepository: Repository<Network>,
    @InjectRepository(CoinNetwork)
    private coinNetworkRepository: Repository<CoinNetwork>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(WalletTransfer)
    private walletTransferRepository: Repository<WalletTransfer>,
    @InjectRepository(UserCode)
    private readonly userCodeRepository: Repository<UserCode>,
    private configService: ConfigService,
    private walletsSchedulerService: WalletsSchedulerService,
    private rpcRateLimitService: RpcRateLimitService,
    private adminSettingsConfigService: AdminSettingsConfigService,
    private cacheService: CacheService,
    private emailService: EmailService,
  ) {}

  onModuleInit(): void {
    void this.fetchAndCacheTokenPricesUsdt();
    setInterval(() => {
      void this.fetchAndCacheTokenPricesUsdt();
    }, TOKEN_USDT_PRICES_REFRESH_MS);
  }

  /**
   * Giá token theo USDT (thực tế lấy USD từ CoinGecko / USDT pair từ Binance fallback).
   * Trả về map symbol → số USDT cho 1 đơn vị token, thêm timestamp (ms).
   */
  async getTokenPricesUsdt(): Promise<
    Record<string, number> & { timestamp?: number }
  > {
    const raw = await this.cacheService.get(TOKEN_USDT_PRICES_CACHE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as Record<string, number> & {
          timestamp?: number;
        };
      } catch {
        this.logger.warn('token prices cache parse failed, refreshing');
      }
    }
    await this.fetchAndCacheTokenPricesUsdt();
    const again = await this.cacheService.get(TOKEN_USDT_PRICES_CACHE_KEY);
    if (!again) {
      return {};
    }
    try {
      return JSON.parse(again) as Record<string, number> & {
        timestamp?: number;
      };
    } catch {
      return {};
    }
  }

  private async fetchAndCacheTokenPricesUsdt(): Promise<void> {
    const ids = Object.keys(TOKEN_USDT_PRICE_COINGECKO_IDS).join(',');
    try {
      const { data } = await axios.get<Record<string, { usd?: number }>>(
        'https://api.coingecko.com/api/v3/simple/price',
        { params: { ids, vs_currencies: 'usd' }, timeout: 15_000 },
      );

      const result: Record<string, number> & { timestamp: number } = {
        timestamp: Date.now(),
      };
      for (const key of Object.keys(data)) {
        const symbol = TOKEN_USDT_PRICE_COINGECKO_IDS[key];
        const usd = data[key]?.usd;
        if (symbol != null && typeof usd === 'number') {
          result[symbol] = usd;
        }
      }

      await this.cacheService.set(
        TOKEN_USDT_PRICES_CACHE_KEY,
        JSON.stringify(result),
        TOKEN_USDT_PRICES_TTL_SEC,
      );
    } catch (e) {
      this.logger.warn(
        `CoinGecko price fetch failed, using Binance fallback: ${(e as Error)?.message}`,
      );

      const symbols = [
        'BTCUSDT',
        'ETHUSDT',
        'SOLUSDT',
        'BNBUSDT',
        'TRXUSDT',
        'ARBUSDT',
      ];
      try {
        const res = await axios.get<{ symbol: string; price: string }[]>(
          'https://api.binance.com/api/v3/ticker/price',
          { timeout: 15_000 },
        );

        const map: Record<string, number> & { timestamp: number } = {
          USDT: 1,
          timestamp: Date.now(),
        };
        const want = new Set(symbols);
        for (const i of res.data) {
          if (want.has(i.symbol)) {
            map[i.symbol.replace('USDT', '')] = Number(i.price);
          }
        }

        await this.cacheService.set(
          TOKEN_USDT_PRICES_CACHE_KEY,
          JSON.stringify(map),
          TOKEN_USDT_PRICES_TTL_SEC,
        );
      } catch (fallbackErr) {
        this.logger.error(
          `Binance price fallback failed: ${(fallbackErr as Error)?.message}`,
        );
      }
    }
  }

  async getListCoins(): Promise<Coin[]> {
    return await this.coinRepository.find({
      order: {
        coin_id: 'ASC',
      },
    });
  }

  async getListNetworks(): Promise<Network[]> {
    return await this.networkRepository.find({
      order: {
        net_id: 'ASC',
      },
    });
  }

  async getWalletByNetwork(
    userId: number,
    networkId: number,
  ): Promise<UserWalletNetwork | null> {
    const wallet = await this.useWalletNetworkRepository.findOne({
      where: {
        uwn_user_id: userId,
        uwn_network_id: networkId,
      },
    });

    // Nếu có wallet và có public_key, tracking wallet
    if (wallet && wallet.uwn_public_key) {
      await this.trackingWallet(
        userId,
        networkId,
        wallet.uwn_public_key,
        wallet.uwn_id,
      );
    }

    return wallet;
  }

  async getBalanceByCoin(
    userId: number,
    coinId: number,
  ): Promise<UserWallet | null> {
    const wallet = await this.userWalletRepository.findOne({
      where: {
        uw_user_id: userId,
        uw_wallet_coins: coinId,
      },
    });

    if (!wallet) {
      return null;
    }

    return wallet;
  }

  /**
   * Get all wallets of user grouped by network symbol
   * Returns object with network symbols as keys and public keys as values (or null if not exists)
   */
  async getMyWallets(userId: number): Promise<Record<string, string | null>> {
    // 1. Lấy tất cả networks
    const networks = await this.networkRepository.find({
      order: { net_id: 'ASC' },
    });

    // 2. Lấy tất cả wallets của user
    const userWallets = await this.useWalletNetworkRepository.find({
      where: {
        uwn_user_id: userId,
      },
    });

    // 3. Tạo map để dễ tìm kiếm wallet theo network_id
    const walletMap = new Map<number, string>();
    userWallets.forEach((wallet) => {
      walletMap.set(wallet.uwn_network_id, wallet.uwn_public_key);
    });

    // 4. Tạo object với key là net_symbol và value là public_key hoặc null
    const result: Record<string, string | null> = {};
    networks.forEach((network) => {
      result[network.net_symbol] = walletMap.get(network.net_id) || null;
    });

    return result;
  }

  /**
   * Track wallet activity - save or update active wallet tracker.
   * Địa chỉ được trim để tránh trùng do khoảng trắng. Cùng địa chỉ trên hai mạng (VD: ETH và BSC) là hai ví khác nhau, có hai bản ghi.
   * Nếu đã tồn tại theo (awt_address + awt_network_id) hoặc theo uwn_id thì chỉ cập nhật thời gian, không tạo mới.
   */
  async trackingWallet(
    userId: number,
    networkId: number,
    publicKey: string,
    uwnId?: number,
  ): Promise<void> {
    const normalizedAddress = (publicKey ?? '').trim();
    if (!normalizedAddress) return;

    // Dùng UTC để lưu thống nhất với created_at/updated_at (tránh lệch múi giờ khi server chạy VN)
    const nowUTC = new Date();
    const expiresAt = new Date(nowUTC.getTime() + 1 * 60 * 60 * 1000); // +1 giờ

    // 1. Tìm theo địa chỉ + mạng (cùng ví cùng mạng = một tracker)
    const existingByAddressAndNetwork =
      await this.activeWalletTrackerRepository.findOne({
        where: {
          awt_address: normalizedAddress,
          awt_network_id: networkId,
        },
      });
    if (existingByAddressAndNetwork) {
      existingByAddressAndNetwork.awt_last_accessed_at = nowUTC;
      existingByAddressAndNetwork.awt_expires_at = expiresAt;
      existingByAddressAndNetwork.awt_user_id = userId;
      existingByAddressAndNetwork.uwn_id =
        uwnId ?? existingByAddressAndNetwork.uwn_id;
      await this.activeWalletTrackerRepository.save(
        existingByAddressAndNetwork,
      );
      return;
    }

    // 2. Lấy uwn_id nếu chưa truyền
    let walletNetworkId = uwnId;
    if (walletNetworkId == null) {
      const wallet = await this.useWalletNetworkRepository.findOne({
        where: {
          uwn_user_id: userId,
          uwn_network_id: networkId,
          uwn_public_key: normalizedAddress,
        },
      });
      if (wallet) walletNetworkId = wallet.uwn_id;
    }
    if (walletNetworkId == null) return;

    // 3. Tìm theo uwn_id – nếu có thì cập nhật và đồng bộ awt_address (trim)
    const existingByUwnId = await this.activeWalletTrackerRepository.findOne({
      where: { uwn_id: walletNetworkId },
    });
    if (existingByUwnId) {
      existingByUwnId.awt_last_accessed_at = nowUTC;
      existingByUwnId.awt_expires_at = expiresAt;
      existingByUwnId.awt_address = normalizedAddress;
      existingByUwnId.awt_network_id = networkId;
      existingByUwnId.awt_user_id = userId;
      await this.activeWalletTrackerRepository.save(existingByUwnId);
      return;
    }

    // 4. Tạo mới (dùng địa chỉ đã trim). Nếu trùng do race (unique uq_awt_address_network) thì cập nhật bản ghi đã có.
    const newTracker = this.activeWalletTrackerRepository.create({
      uwn_id: walletNetworkId,
      awt_last_accessed_at: nowUTC,
      awt_expires_at: expiresAt,
      awt_network_id: networkId,
      awt_user_id: userId,
      awt_address: normalizedAddress,
    });
    try {
      await this.activeWalletTrackerRepository.save(newTracker);
    } catch (err: any) {
      if (err?.code === '23505') {
        const existing = await this.activeWalletTrackerRepository.findOne({
          where: {
            awt_address: normalizedAddress,
            awt_network_id: networkId,
          },
        });
        if (existing) {
          existing.awt_last_accessed_at = nowUTC;
          existing.awt_expires_at = expiresAt;
          existing.uwn_id = walletNetworkId;
          existing.awt_user_id = userId;
          await this.activeWalletTrackerRepository.save(existing);
        }
      } else {
        throw err;
      }
    }
  }

  /**
   * Get wallet address for a specific network by net_id or net_symbol
   * @param userId - User ID
   * @param networkParam - Network ID (number) or Network Symbol (string)
   * @returns Public key (address) of the wallet or null if not found
   */
  async checkWalletNetwork(
    userId: number,
    networkParam: string,
  ): Promise<string | null> {
    // 1. Tìm network theo net_id hoặc net_symbol
    const networkId = parseInt(networkParam, 10);
    let network: Network | null = null;

    if (!isNaN(networkId)) {
      network = await this.networkRepository.findOne({
        where: { net_id: networkId },
      });
    }

    if (!network) {
      network = await this.networkRepository.findOne({
        where: { net_symbol: networkParam.toUpperCase() },
      });
    }

    if (!network) {
      throw new BadRequestException('Network not found');
    }

    // 2. Tìm wallet của user cho network đó
    const wallet = await this.useWalletNetworkRepository.findOne({
      where: {
        uwn_user_id: userId,
        uwn_network_id: network.net_id,
      },
    });

    // 3. Trả về public_key nếu có, null nếu không có
    const publicKey = wallet ? wallet.uwn_public_key : null;

    // 4. Nếu có public_key và wallet, tracking wallet
    if (publicKey && wallet) {
      await this.trackingWallet(
        userId,
        network.net_id,
        publicKey,
        wallet.uwn_id,
      );
    }

    return publicKey;
  }

  /**
   * Generate QR code from public key
   * Returns base64 encoded QR code image
   */
  async generateQRCode(publicKey: string): Promise<string> {
    try {
      const qrCodeDataURL = await QRCode.toDataURL(publicKey, {
        errorCorrectionLevel: 'M',
        margin: 1,
      });
      return qrCodeDataURL;
    } catch (error) {
      throw new BadRequestException('Failed to generate QR code');
    }
  }

  /**
   * Calculate derivation path components from user ID
   * a = Math.floor(uid / 100000) % 100
   * b = Math.floor(uid / 1000) % 100
   * c = uid % 1000
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
   * Generate public key for ETH/BSC (EVM) using BIP44 derivation path
   * Path format: m/44'/60'/0'/{a}'/{b}'/{c}'/{d}'
   * where {d} is the last 3 digits of uwn_id
   */
  private generateEthAddress(
    mnemonic: string,
    a: number,
    b: number,
    c: number,
    d?: number,
  ): string {
    // Sử dụng bip32 để tạo HD wallet từ seed (giống như SOL sử dụng ed25519-hd-key)
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const bip32Factory = bip32.BIP32Factory(tinysecp);
    const root = bip32Factory.fromSeed(seed);

    // Xây dựng full path giống như SOL (derive toàn bộ path một lần)
    // Path format: m/44'/60'/0'/${a}'/${b}'/${c}'/${d}' (all hardened)
    const path =
      d !== undefined
        ? `m/44'/60'/0'/${a}'/${b}'/${c}'/${d}'`
        : `m/44'/60'/0'/${a}'/${b}'/${c}'`;

    // Derive toàn bộ path một lần từ root node
    const derivedNode = root.derivePath(path);

    // Chuyển đổi private key từ bip32 sang Wallet để lấy address
    if (!derivedNode.privateKey) {
      throw new BadRequestException('Failed to derive private key');
    }

    // Lấy private key từ bip32 node
    const privateKeyBuffer = derivedNode.privateKey;
    const privateKey = `0x${Buffer.from(privateKeyBuffer).toString('hex')}`;

    // Tạo wallet từ private key để lấy address
    const wallet = new Wallet(privateKey);

    return wallet.address;
  }

  /**
   * Địa chỉ Tron (base58 T…) từ cùng cấu trúc HD như ETH nhưng coin type 195 (BIP44 TRX).
   * Path: m/44'/195'/0'/{a}'/{b}'/{c}'[/ {d}'] — khớp pattern a,b,c,d của user.
   */
  private generateTronAddress(
    mnemonic: string,
    a: number,
    b: number,
    c: number,
    d?: number,
  ): string {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const bip32Factory = bip32.BIP32Factory(tinysecp);
    const root = bip32Factory.fromSeed(seed);
    const path =
      d !== undefined
        ? `m/44'/195'/0'/${a}'/${b}'/${c}'/${d}'`
        : `m/44'/195'/0'/${a}'/${b}'/${c}'`;
    const derivedNode = root.derivePath(path);
    if (!derivedNode.privateKey) {
      throw new BadRequestException('Failed to derive private key');
    }
    const privateKeyHex = Buffer.from(derivedNode.privateKey).toString('hex');
    const addr = TronWeb.address.fromPrivateKey(privateKeyHex);
    if (!addr || typeof addr !== 'string') {
      throw new BadRequestException('Failed to derive Tron address');
    }
    return addr;
  }

  /**
   * Public key / địa chỉ nạp theo mạng (bước tạm không có d, hoặc bước cuối có d).
   */
  private resolveDerivedDepositAddress(
    networkSymbol: string,
    mnemonic: string,
    a: number,
    b: number,
    c: number,
    d?: number,
  ): string {
    const sym = networkSymbol.trim().toUpperCase();
    switch (sym) {
      case 'SOL':
        return d === undefined
          ? this.generateSolAddress(mnemonic, a, b, c)
          : this.generateSolAddress(mnemonic, a, b, c, d);
      case 'TRX':
      case 'TRON':
        return d === undefined
          ? this.generateTronAddress(mnemonic, a, b, c)
          : this.generateTronAddress(mnemonic, a, b, c, d);
      case 'ETH':
      case 'BSC':
      case 'ARB':
      default:
        return d === undefined
          ? this.generateEthAddress(mnemonic, a, b, c)
          : this.generateEthAddress(mnemonic, a, b, c, d);
    }
  }

  /**
   * Keypair Solana tại path đầy đủ (d = uwn_end_path hoặc 3 số cuối uwn_id).
   * Trùng với địa chỉ nạp tiền của user.
   */
  private deriveSolKeypair(
    mnemonic: string,
    a: number,
    b: number,
    c: number,
    d: number,
  ): Keypair {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const path = `m/44'/501'/0'/${a}'/${b}'/${c}'/${d}'`;
    const derivedSeed = derivePath(path, seed.toString('hex'));
    return Keypair.fromSeed(derivedSeed.key);
  }

  /**
   * Generate public key for SOL using ed25519 derivation
   * Path format: m/44'/501'/0'/{a}'/{b}'/{c}'/{d}'
   * where {d} is the last 3 digits of uwn_id
   */
  private generateSolAddress(
    mnemonic: string,
    a: number,
    b: number,
    c: number,
    d?: number,
  ): string {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    if (d === undefined) {
      const path = `m/44'/501'/0'/${a}'/${b}'/${c}'`;
      const derivedSeed = derivePath(path, seed.toString('hex'));
      return Keypair.fromSeed(derivedSeed.key).publicKey.toBase58();
    }
    return this.deriveSolKeypair(mnemonic, a, b, c, d).publicKey.toBase58();
  }

  /**
   * Extract last 3 digits from uwn_id
   * If uwn_id has less than 3 digits, pad with zeros or use the full number
   */
  private getLastThreeDigits(uwnId: number): number {
    // Convert to string to get last 3 digits
    const idStr = uwnId.toString();
    // Get last 3 characters, pad with zeros if needed
    const lastThree = idStr.slice(-3);
    return parseInt(lastThree, 10);
  }

  async createWallet(userId: number, networkId: number): Promise<any> {
    // 1. Kiểm tra network_id có tồn tại không
    const network = await this.networkRepository.findOne({
      where: { net_id: networkId },
    });

    if (!network) {
      throw new BadRequestException('Network not found');
    }

    // 2. Kiểm tra đã có public_key cho uid và network_id chưa
    const existingWallet = await this.useWalletNetworkRepository.findOne({
      where: {
        uwn_user_id: userId,
        uwn_network_id: networkId,
      },
    });

    if (existingWallet) {
      throw new BadRequestException('Wallet already exists for this network');
    }

    // 2.5. Kiểm tra nếu đang tạo ví ETH hoặc BSC, xem đã có ví của mạng lưới còn lại chưa
    // Nếu có, sử dụng lại cùng public key và uwn_end_path (vì ETH và BSC dùng cùng HD Wallet derivation)
    if (network.net_symbol === 'ETH' || network.net_symbol === 'BSC') {
      const otherNetworkSymbol = network.net_symbol === 'ETH' ? 'BSC' : 'ETH';
      const otherNetwork = await this.networkRepository.findOne({
        where: { net_symbol: otherNetworkSymbol },
      });

      if (otherNetwork) {
        const existingOtherWallet =
          await this.useWalletNetworkRepository.findOne({
            where: {
              uwn_user_id: userId,
              uwn_network_id: otherNetwork.net_id,
            },
          });

        // Nếu đã có ví của mạng lưới còn lại, sử dụng lại cùng public key và end_path
        if (
          existingOtherWallet &&
          existingOtherWallet.uwn_public_key &&
          existingOtherWallet.uwn_end_path != null
        ) {
          const newWallet = this.useWalletNetworkRepository.create({
            uwn_user_id: userId,
            uwn_network_id: networkId,
            uwn_public_key: existingOtherWallet.uwn_public_key, // Sử dụng lại cùng public key
            uwn_end_path: existingOtherWallet.uwn_end_path, // Sử dụng lại cùng end_path
          });

          const savedWallet =
            await this.useWalletNetworkRepository.save(newWallet);

          return {
            message:
              'Wallet created successfully (reused from existing EVM wallet)',
            wallet: savedWallet,
          };
        }
      }
    }

    // 3. Lấy SEED từ .env (24 từ mnemonic)
    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic) {
      throw new BadRequestException('Wallet seed not configured');
    }

    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new BadRequestException('Invalid wallet seed');
    }

    // 4. Tính các thành phần path từ uid
    // a = Math.floor(uid / 100000) % 100
    // b = Math.floor(uid / 1000) % 100
    // c = uid % 1000
    const { a, b, c } = this.calculatePathComponents(userId);

    // 5. Tạo wallet tạm để lấy uwn_id (path chưa có d)
    const tempPublicKey = this.resolveDerivedDepositAddress(
      network.net_symbol,
      mnemonic,
      a,
      b,
      c,
    );

    // 6. Tạo wallet tạm để lấy uwn_id
    const tempWallet = this.useWalletNetworkRepository.create({
      uwn_user_id: userId,
      uwn_network_id: networkId,
      uwn_public_key: tempPublicKey,
    });

    // 7. Lưu wallet tạm để lấy uwn_id
    const savedTempWallet =
      await this.useWalletNetworkRepository.save(tempWallet);

    // 8. Lấy 3 ký tự cuối của uwn_id làm d
    const d = this.getLastThreeDigits(savedTempWallet.uwn_id);

    // 9. Generate lại địa chỉ với path đầy đủ có d
    const finalPublicKey = this.resolveDerivedDepositAddress(
      network.net_symbol,
      mnemonic,
      a,
      b,
      c,
      d,
    );

    // 10. Cập nhật public key và uwn_end_path với giá trị mới
    savedTempWallet.uwn_public_key = finalPublicKey;
    savedTempWallet.uwn_end_path = d; // Lưu 3 số cuối của uwn_id
    const savedWallet =
      await this.useWalletNetworkRepository.save(savedTempWallet);

    return {
      message: 'Wallet created successfully',
      wallet: savedWallet,
    };
  }

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
   * Ví main (mainWallet) — path 382': SOL / EVM / TRX
   */
  private getMainWallet(
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
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const bip32Factory = bip32.BIP32Factory(tinysecp);
    const root = bip32Factory.fromSeed(seed);
    const derivedNode = root.derivePath(`m/44'/60'/0'/0'/0'/382'`);
    if (!derivedNode.privateKey) {
      throw new BadRequestException('Failed to derive main wallet');
    }
    const privateKey = `0x${Buffer.from(derivedNode.privateKey).toString('hex')}`;
    const wallet = new Wallet(privateKey);
    return wallet as any as HDNodeWallet;
  }

  /**
   * Ví trợ phí (feeWallet) — path 369': trả phí mạng / delegate TRX → main
   */
  private getFeeWallet(
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
      throw new BadRequestException('Failed to derive fee wallet');
    }
    const privateKey = `0x${Buffer.from(derivedNode.privateKey).toString('hex')}`;
    const wallet = new Wallet(privateKey);
    return wallet as any as HDNodeWallet;
  }

  /**
   * Send transaction from exchange wallet to destination address
   */
  /** Thử lần lượt SOL RPC (DB rồi env nếu khác); khi lỗi/rate limit thử URL tiếp theo. */
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

  /** Chuẩn hóa địa chỉ EVM (checksum) để tránh lỗi "bad address checksum" (BSC/ETH). */
  private normalizeEvmAddress(address: string): string {
    if (!address || !address.startsWith('0x')) return address;
    try {
      return getAddress(address);
    } catch {
      return getAddress(address.toLowerCase());
    }
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

  private createTronWebWithKey(
    fullHost: string,
    privateKeyHex: string,
  ): InstanceType<typeof TronWeb> {
    return new TronWeb({
      fullHost: fullHost.replace(/\/+$/, ''),
      headers: this.tronApiHeaders(),
      privateKey: privateKeyHex,
    });
  }

  private normalizeTronAddress(
    tw: InstanceType<typeof TronWeb>,
    address: string,
  ): string {
    const a = address.trim();
    if (!a) throw new BadRequestException('Empty Tron address');
    if (tw.isAddress(a)) return a;
    if (/^41[0-9a-fA-F]{40}$/.test(a)) {
      return tw.address.fromHex(a);
    }
    throw new BadRequestException(`Invalid Tron address: ${a.slice(0, 12)}…`);
  }

  private resolveTronContractBase58(
    tw: InstanceType<typeof TronWeb>,
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

  private async clampTronDelegateSun(
    tw: InstanceType<typeof TronWeb>,
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
      // ignore
    }
    return requestedSun;
  }

  private async broadcastTronSignedTransaction(
    tw: InstanceType<typeof TronWeb>,
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

  /** Ủy quyền ENERGY/BANDWIDTH từ ví fee (369) → ví main (382). */
  private async delegateTronResourcesFromFeeWallet(
    tw: InstanceType<typeof TronWeb>,
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
        this.logger.warn(
          `[withdraw-trx] delegate ENERGY failed: ${e?.message ?? e}`,
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
        this.logger.warn(
          `[withdraw-trx] delegate BANDWIDTH failed: ${e?.message ?? e}`,
        );
      }
    }
    return lastTxId;
  }

  private async ensureEvmMainHasGas(
    provider: ReturnType<typeof createEvmJsonRpcProvider>,
    mainWallet: HDNodeWallet | Wallet,
    feeWallet: HDNodeWallet | Wallet,
    minMainWei: bigint,
  ): Promise<void> {
    const connectedMain = mainWallet.connect(provider);
    const connectedFee = feeWallet.connect(provider);
    const bal = await this.rpcRateLimitService.withRpcLimit(() =>
      provider.getBalance(connectedMain.address),
    );
    if (bal >= minMainWei) return;
    const need = minMainWei - bal;
    const feeData = await this.rpcRateLimitService.withRpcLimit(() =>
      provider.getFeeData(),
    );
    const gasPrice = feeData.gasPrice ?? BigInt(0);
    const gasForTopup = gasPrice * BigInt(21000);
    const feeBal = await this.rpcRateLimitService.withRpcLimit(() =>
      provider.getBalance(connectedFee.address),
    );
    if (feeBal < need + gasForTopup) {
      throw new BadRequestException(
        'Fee wallet cannot fund gas on main wallet; try again later',
      );
    }
    const tx = await this.rpcRateLimitService.withRpcLimit(() =>
      connectedFee.sendTransaction({
        to: connectedMain.address,
        value: need,
        gasPrice: feeData.gasPrice,
      }),
    );
    await this.rpcRateLimitService.withRpcLimit(() => tx.wait());
  }

  /**
   * Rút on-chain: luôn ký từ ví main (382), phí mạng từ ví fee (369).
   * Hỗ trợ SOL, ETH, BSC, TRX.
   */
  private async sendWithdrawTransaction(
    network: Network,
    coin: Coin,
    mnemonic: string,
    toAddress: string,
    amount: number,
  ): Promise<string> {
    if (network.net_symbol === 'SOL') {
      const wssUrl = this.configService.get<string>('SOLANA_WSS_URL');

      // Kiểm tra coin_network để lấy mint address và decimals
      const coinNetwork = await this.coinNetworkRepository.findOne({
        where: {
          cn_coin_id: coin.coin_id,
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
      });

      if (!coinNetwork) {
        throw new BadRequestException(
          `Coin ${coin.coin_symbol} is not available on network ${network.net_symbol}`,
        );
      }

      return this.runWithSolRpcUrl(async (rpcUrl) => {
        const connection = new Connection(rpcUrl, {
          commitment: 'confirmed',
          wsEndpoint: wssUrl || undefined,
        });
        const mainKeypair = this.getMainWallet(mnemonic, 'SOL') as Keypair;
        const feeKeypair = this.getFeeWallet(mnemonic, 'SOL') as Keypair;
        const toPublicKey = new PublicKey(toAddress);

        // Kiểm tra xem coin có phải native SOL không
        if (coin.coin_symbol === 'SOL') {
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: mainKeypair.publicKey,
              toPubkey: toPublicKey,
              lamports: amount * 1e9,
            }),
          );
          const { blockhash } = await this.rpcRateLimitService.withRpcLimit(
            () => connection.getLatestBlockhash('confirmed'),
          );
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = feeKeypair.publicKey;

          const signature = await this.rpcRateLimitService.withRpcLimit(() =>
            connection.sendTransaction(transaction, [mainKeypair, feeKeypair]),
          );
          await this.rpcRateLimitService.withRpcLimit(() =>
            connection.confirmTransaction(signature, 'confirmed'),
          );
          return signature;
        } else {
          // SPL Token transfer (USDT, USDC, etc.)
          if (!coinNetwork.cn_coin_mint) {
            throw new BadRequestException(
              `SPL token ${coin.coin_symbol} requires cn_coin_mint on network ${network.net_symbol}`,
            );
          }
          const mintPublicKey = new PublicKey(coinNetwork.cn_coin_mint);
          // Lấy mint info để biết decimals
          const mintInfo = await this.rpcRateLimitService.withRpcLimit(() =>
            getMint(connection, mintPublicKey),
          );
          const decimals = mintInfo.decimals;

          // Lấy associated token address của sender và receiver
          const fromTokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            mainKeypair.publicKey,
          );
          const toTokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            toPublicKey,
          );

          this.logger.debug(
            `[withdraw-sol-spl] rpcUrl=${rpcUrl} mint=${mintPublicKey.toBase58()} decimals=${decimals} ` +
              `fromWallet=${mainKeypair.publicKey.toBase58()} fromATA=${fromTokenAccount.toBase58()} ` +
              `toWallet=${toPublicKey.toBase58()} toATA=${toTokenAccount.toBase58()} amount=${amount}`,
          );

          // Kiểm tra token account của sender có tồn tại và có balance không
          let fromTokenAccountInfo;
          try {
            fromTokenAccountInfo = await this.rpcRateLimitService.withRpcLimit(
              () => getAccount(connection, fromTokenAccount),
            );
            this.logger.debug(
              `[withdraw-sol-spl] sender ATA ok amountRaw=${fromTokenAccountInfo.amount.toString()}`,
            );
          } catch (error) {
            const errMsg =
              error instanceof Error ? error.message : String(error);
            const errName = error instanceof Error ? error.name : typeof error;
            const errCode =
              error &&
              typeof error === 'object' &&
              'code' in error &&
              (error as { code?: unknown }).code !== undefined
                ? String((error as { code: unknown }).code)
                : '';
            this.logger.debug(
              `[withdraw-sol-spl] getAccount(sender) fail ` +
                `signerPubkey=${mainKeypair.publicKey.toBase58()} ` +
                `mint=${mintPublicKey.toBase58()} rpcUrl=${rpcUrl} ` +
                `error.name=${errName} error.code=${errCode || 'n/a'} err=${errMsg || '(empty message)'}`,
            );
            this.logger.error(
              `[withdraw-sol-spl] sender ATA missing/invalid fromATA=${fromTokenAccount.toBase58()} ` +
                `error.name=${errName} err=${errMsg || '(empty message)'}`,
            );
            throw new BadRequestException(
              `Sender token account does not exist or has no balance. Token account: ${fromTokenAccount.toBase58()}`,
            );
          }

          // Kiểm tra balance của sender
          const transferAmount = BigInt(
            Math.floor(amount * Math.pow(10, decimals)),
          );
          if (fromTokenAccountInfo.amount < transferAmount) {
            throw new BadRequestException(
              `Insufficient token balance. Available: ${Number(fromTokenAccountInfo.amount) / Math.pow(10, decimals)}, Required: ${amount}`,
            );
          }

          // Kiểm tra token account của receiver có tồn tại không
          let toTokenAccountInfo;
          try {
            toTokenAccountInfo = await this.rpcRateLimitService.withRpcLimit(
              () => getAccount(connection, toTokenAccount),
            );
            this.logger.debug(
              `[withdraw-sol-spl] receiver ATA exists toATA=${toTokenAccount.toBase58()}`,
            );
          } catch (error) {
            // Token account của receiver chưa tồn tại, cần tạo
            toTokenAccountInfo = null;
            const errMsg =
              error instanceof Error ? error.message : String(error);
            const errName = error instanceof Error ? error.name : typeof error;
            const errCode =
              error &&
              typeof error === 'object' &&
              'code' in error &&
              (error as { code?: unknown }).code !== undefined
                ? String((error as { code: unknown }).code)
                : '';
            this.logger.debug(
              `[withdraw-sol-spl] getAccount(receiver) fail (may create ATA) ` +
                `signerPubkey=${mainKeypair.publicKey.toBase58()} ` +
                `mint=${mintPublicKey.toBase58()} rpcUrl=${rpcUrl} ` +
                `error.name=${errName} error.code=${errCode || 'n/a'} err=${errMsg || '(empty message)'} ` +
                `toATA=${toTokenAccount.toBase58()}`,
            );
          }

          // Tạo transaction
          const transaction = new Transaction();

          // Nếu token account của receiver chưa tồn tại, thêm instruction để tạo
          if (!toTokenAccountInfo) {
            transaction.add(
              createAssociatedTokenAccountInstruction(
                feeKeypair.publicKey,
                toTokenAccount,
                toPublicKey,
                mintPublicKey,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
              ),
            );
          }

          // Thêm instruction transfer
          transaction.add(
            createTransferInstruction(
              fromTokenAccount,
              toTokenAccount,
              mainKeypair.publicKey,
              transferAmount,
              [],
              TOKEN_PROGRAM_ID,
            ),
          );

          // Lấy recent blockhash
          const { blockhash } = await this.rpcRateLimitService.withRpcLimit(
            () => connection.getLatestBlockhash('confirmed'),
          );
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = feeKeypair.publicKey;

          // Simulate transaction trước khi gửi để kiểm tra lỗi
          try {
            const simulation = await this.rpcRateLimitService.withRpcLimit(() =>
              connection.simulateTransaction(transaction, [
                mainKeypair,
                feeKeypair,
              ]),
            );
            if (simulation.value.err) {
              const errorMessage = simulation.value.err.toString();
              const logs = simulation.value.logs || [];
              this.logger.error(
                `[withdraw-sol-spl] simulation failed err=${errorMessage}`,
              );
              if (logs.length) {
                this.logger.debug(
                  `[withdraw-sol-spl] simulation logs:\n${logs.join('\n')}`,
                );
              }
              throw new BadRequestException(
                `Transaction simulation failed. Message: ${errorMessage}. Logs: ${logs.join('\n')}`,
              );
            }
          } catch (simError) {
            // Nếu là BadRequestException từ simulation, throw lại
            if (simError instanceof BadRequestException) {
              throw simError;
            }
            // Nếu là lỗi khác (network issue, etc.), vẫn thử gửi transaction thật
            const errMsg =
              simError instanceof Error ? simError.message : String(simError);
            this.logger.warn(
              `[withdraw-sol-spl] simulation error (non-critical), proceeding with actual transaction: ${errMsg}`,
            );
          }

          const signature = await this.rpcRateLimitService.withRpcLimit(() =>
            connection.sendTransaction(transaction, [mainKeypair, feeKeypair]),
          );
          await this.rpcRateLimitService.withRpcLimit(() =>
            connection.confirmTransaction(signature, 'confirmed'),
          );
          return signature;
        }
      });
    } else if (this.isTronNetwork(network.net_symbol)) {
      const coinNetwork = await this.coinNetworkRepository.findOne({
        where: {
          cn_coin_id: coin.coin_id,
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
      });
      if (!coinNetwork) {
        throw new BadRequestException(
          `Coin ${coin.coin_symbol} is not available on network ${network.net_symbol}`,
        );
      }

      const fullHost = await this.getTronFullHost(network);
      const mainSk = this.getMainWallet(
        mnemonic,
        network.net_symbol,
      ) as TronHdWallet;
      const feeSk = this.getFeeWallet(
        mnemonic,
        network.net_symbol,
      ) as TronHdWallet;
      const mainAddr = this.tronAddressFromPrivateKeyHex(mainSk.privateKeyHex);
      const twFee = this.createTronWebWithKey(fullHost, feeSk.privateKeyHex);
      const feeAddr =
        twFee.defaultAddress.base58 ||
        this.tronAddressFromPrivateKeyHex(feeSk.privateKeyHex);

      const energyTrx =
        await this.adminSettingsConfigService.getTronDelegateEnergyStakeTrx();
      const bandwidthTrx =
        await this.adminSettingsConfigService.getTronDelegateBandwidthStakeTrx();
      await this.delegateTronResourcesFromFeeWallet(
        twFee,
        feeSk.privateKeyHex,
        feeAddr,
        mainAddr,
        energyTrx,
        bandwidthTrx,
      );

      const twMain = this.createTronWebWithKey(fullHost, mainSk.privateKeyHex);
      const toNorm = this.normalizeTronAddress(twMain, toAddress);
      const coinSym = coin.coin_symbol.trim().toUpperCase();
      const netSym = network.net_symbol.trim().toUpperCase();
      const isNativeTrx = coinSym === 'TRX' || coinSym === netSym;

      if (isNativeTrx) {
        const sun = Math.floor(amount * 1_000_000);
        if (sun <= 0) {
          throw new BadRequestException('Invalid TRX transfer amount');
        }
        const result = await this.rpcRateLimitService.withRpcLimit(() =>
          twMain.trx.sendTransaction(toNorm, sun, {
            privateKey: mainSk.privateKeyHex,
          }),
        );
        return this.extractTronTxId(result);
      }

      if (!coinNetwork.cn_coin_mint) {
        throw new BadRequestException(
          `Token ${coin.coin_symbol} requires cn_coin_mint on ${network.net_symbol}`,
        );
      }

      const contractAddr = this.resolveTronContractBase58(
        twMain,
        coinNetwork.cn_coin_mint,
      );
      const contract = await twMain.contract().at(contractAddr);
      const callOpts = { from: mainAddr };
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
            { feeLimit: WalletsService.TRON_TRC20_FEE_LIMIT_SUN },
            mainSk.privateKeyHex,
          ),
      );
      if (typeof txid !== 'string' || !txid) {
        throw new BadRequestException('TRC20 transfer did not return tx id');
      }
      return txid;
    } else {
      // EVM: thử lần lượt RPC từ DB rồi env (nếu khác), khi lỗi/rate limit thử URL tiếp theo
      const rpcUrls =
        await this.adminSettingsConfigService.getRpcUrlsToTryByNetwork(
          network.net_symbol,
        );
      if (!rpcUrls.length) {
        throw new BadRequestException(
          `RPC endpoint not configured for network ${network.net_symbol}`,
        );
      }

      // Kiểm tra coin_network để lấy contract address và decimals
      const coinNetwork = await this.coinNetworkRepository.findOne({
        where: {
          cn_coin_id: coin.coin_id,
          cn_network_id: network.net_id,
          cn_status: CoinNetworkStatus.ACTIVE,
        },
      });

      if (!coinNetwork) {
        throw new BadRequestException(
          `Coin ${coin.coin_symbol} is not available on network ${network.net_symbol}`,
        );
      }

      const mainWallet = this.getMainWallet(mnemonic, network.net_symbol) as
        | HDNodeWallet
        | Wallet;
      const feeWallet = this.getFeeWallet(mnemonic, network.net_symbol) as
        | HDNodeWallet
        | Wallet;

      let lastEvmErr: Error | null = null;
      for (const rpcUrl of rpcUrls) {
        try {
          const provider = createEvmJsonRpcProvider(rpcUrl);

          const connectedWallet = mainWallet.connect(provider);
          const normalizedToAddressEvm = this.normalizeEvmAddress(toAddress);

          // Kiểm tra xem coin có phải native token không (ETH hoặc BNB trên BSC)
          const isNativeToken =
            coin.coin_symbol === network.net_symbol ||
            (network.net_symbol === 'ETH' && coin.coin_symbol === 'ETH') ||
            (network.net_symbol === 'BSC' && coin.coin_symbol === 'BNB');

          if (isNativeToken) {
            const transferAmount = parseUnits(amount.toString(), 18);
            const feeData = await this.rpcRateLimitService.withRpcLimit(() =>
              provider.getFeeData(),
            );
            const estimatedGasLimit = BigInt(21000);
            const estimatedGasFee = feeData.gasPrice
              ? feeData.gasPrice * estimatedGasLimit
              : BigInt(0);
            const gasBuffer = estimatedGasFee / BigInt(5) + BigInt(1);
            const minMainWei = transferAmount + estimatedGasFee + gasBuffer;

            await this.ensureEvmMainHasGas(
              provider,
              mainWallet,
              feeWallet,
              minMainWei,
            );

            const senderBalance = await this.rpcRateLimitService.withRpcLimit(
              () => provider.getBalance(connectedWallet.address),
            );
            if (senderBalance < transferAmount + estimatedGasFee) {
              const availableBalance =
                Number(senderBalance - estimatedGasFee) / Math.pow(10, 18);
              throw new BadRequestException(
                `Insufficient balance. Available: ${availableBalance.toFixed(8)} ${coin.coin_symbol}, Required: ${amount} ${coin.coin_symbol} (plus gas fee)`,
              );
            }

            const tx = await this.rpcRateLimitService.withRpcLimit(() =>
              connectedWallet.sendTransaction({
                to: normalizedToAddressEvm,
                value: transferAmount,
                gasPrice: feeData.gasPrice,
              }),
            );

            const receipt = (await this.rpcRateLimitService.withRpcLimit(() =>
              tx.wait(),
            )) as { hash: string } | null;
            if (!receipt) throw new BadRequestException('Transaction failed');
            return receipt.hash;
          } else {
            // ERC20 Token transfer (USDT, USDC, etc.)
            if (!coinNetwork.cn_coin_mint) {
              throw new BadRequestException(
                `Token ${coin.coin_symbol} requires cn_coin_mint (contract) on network ${network.net_symbol}`,
              );
            }
            // Chuẩn hóa địa chỉ checksum (tránh lỗi "bad address checksum" trên BSC/ETH)
            const normalizedContractAddress = this.normalizeEvmAddress(
              coinNetwork.cn_coin_mint,
            );

            const erc20Abi = [
              'function transfer(address to, uint256 amount) returns (bool)',
              'function decimals() view returns (uint8)',
              'function balanceOf(address account) view returns (uint256)',
            ];

            const tokenContract = new Contract(
              normalizedContractAddress,
              erc20Abi,
              connectedWallet,
            );

            let decimals = 18;
            try {
              decimals = await this.rpcRateLimitService.withRpcLimit(() =>
                tokenContract.decimals(),
              );
            } catch (error) {
              this.logger.warn(
                `Could not get decimals for token ${normalizedContractAddress}, using default 18`,
              );
            }

            const transferAmount = parseUnits(amount.toString(), decimals);
            try {
              const senderBalance = await this.rpcRateLimitService.withRpcLimit(
                () => tokenContract.balanceOf(connectedWallet.address),
              );
              if (senderBalance < transferAmount) {
                const availableBalance =
                  Number(senderBalance) / Math.pow(10, decimals);
                throw new BadRequestException(
                  `Insufficient token balance. Available: ${availableBalance}, Required: ${amount}`,
                );
              }
            } catch (error) {
              if (error instanceof BadRequestException) {
                throw error;
              }
              const errMsg =
                error instanceof Error ? error.message : String(error);
              this.logger.warn(
                `Could not check token balance, proceeding with transfer: ${errMsg}`,
              );
            }

            const feeData = await this.rpcRateLimitService.withRpcLimit(() =>
              provider.getFeeData(),
            );
            const gasPrice = feeData.gasPrice ?? BigInt(0);
            let gasLimit = BigInt(120_000);
            try {
              gasLimit = await this.rpcRateLimitService.withRpcLimit(() =>
                tokenContract.transfer.estimateGas(
                  normalizedToAddressEvm,
                  transferAmount,
                ),
              );
            } catch {
              // dùng mặc định
            }
            const gasWithBuffer = gasLimit + gasLimit / BigInt(5) + BigInt(1);
            await this.ensureEvmMainHasGas(
              provider,
              mainWallet,
              feeWallet,
              gasPrice * gasWithBuffer,
            );

            const tx = await this.rpcRateLimitService.withRpcLimit(() =>
              tokenContract.transfer(normalizedToAddressEvm, transferAmount),
            );

            const receipt = (await this.rpcRateLimitService.withRpcLimit(() =>
              tx.wait(),
            )) as { hash: string } | null;
            if (!receipt) throw new BadRequestException('Transaction failed');
            return receipt.hash;
          }
        } catch (e) {
          lastEvmErr = e instanceof Error ? e : new Error(String(e));
          continue;
        }
      }
      throw lastEvmErr ?? new BadRequestException('EVM RPC failed');
    }
  }

  /**
   * Kiểm tra và tính toán max_withdraw dựa trên quỹ của hệ thống
   * @returns max_withdraw hoặc null nếu không giới hạn
   */
  async checkMaxWithdraw(): Promise<number | null> {
    const { fundAmount, fundType } =
      await this.adminSettingsConfigService.getFundSettings();
    if (!fundAmount || fundAmount <= 0 || !fundType) {
      return null; // Không giới hạn
    }

    // 2. Tính total_deposit: tổng lệnh nạp thành công của tất cả users
    const totalDepositResult = await this.walletHistoryRepository
      .createQueryBuilder('wh')
      .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
      .where('wh.wh_option IN (:...depositOptions)', {
        depositOptions: [
          WalletHistoryOption.DEPOSIT,
          WalletHistoryOption.ADMIN_DEPOSIT,
        ],
      })
      .andWhere('wh.wh_status = :status', {
        status: WalletHistoryStatus.SUCCESS,
      })
      .getRawOne();

    const totalDeposit = parseFloat(totalDepositResult?.total || '0');

    // 3. Tính total_withdraw: tổng lệnh rút đang pending | success | checked của tất cả users
    const totalWithdrawResult = await this.walletHistoryRepository
      .createQueryBuilder('wh')
      .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
      .where('wh.wh_option = :option', {
        option: WalletHistoryOption.WITHDRAW,
      })
      .andWhere('wh.wh_status IN (:...statuses)', {
        statuses: [
          WalletHistoryStatus.PENDING,
          WalletHistoryStatus.SUCCESS,
          WalletHistoryStatus.CHECKED,
        ],
      })
      .getRawOne();

    const totalWithdraw = parseFloat(totalWithdrawResult?.total || '0');

    // 4. Tính max_withdraw dựa trên withdraw.fund_type
    let maxWithdraw: number;

    if (fundType === FundType.GAIN_LOSS) {
      // gain_loss: max_withdraw = total_deposit + fund_amount - total_withdraw
      maxWithdraw = totalDeposit + fundAmount - totalWithdraw;
    } else if (fundType === FundType.ALWAYS_PROFITABLE) {
      // always_profitable: max_withdraw = total_deposit - fund_amount - total_withdraw
      maxWithdraw = totalDeposit - fundAmount - totalWithdraw;
    } else {
      // Trường hợp không xác định, không giới hạn
      return null;
    }

    return maxWithdraw;
  }

  /**
   * Kiểm tra số lần rút miễn phí của user
   * @param userId - ID của user
   * @returns Object chứa thông tin về free withdraw: { isFree, totalWithdrawn, turnWithdrawFree }
   */
  async checkFreeWithdraw(userId: number): Promise<{
    isFree: boolean;
    totalWithdrawn: number;
    turnWithdrawFree: number;
  }> {
    // 1. Đếm total_withdrawn_of_user: tổng số lần rút tiền success hoặc pending hoặc checked của user
    const totalWithdrawnResult = await this.walletHistoryRepository
      .createQueryBuilder('wh')
      .select('COUNT(wh.wh_id)', 'count')
      .where('wh.wh_user = :userId', { userId })
      .andWhere('wh.wh_option = :option', {
        option: WalletHistoryOption.WITHDRAW,
      })
      .andWhere('wh.wh_status IN (:...statuses)', {
        statuses: [
          WalletHistoryStatus.PENDING,
          WalletHistoryStatus.SUCCESS,
          WalletHistoryStatus.CHECKED,
        ],
      })
      .getRawOne();

    const totalWithdrawn = parseInt(totalWithdrawnResult?.count || '0', 10);

    const turnWithdrawFree =
      await this.adminSettingsConfigService.getEffectiveTurnWithdrawFree();

    // 3. Kiểm tra xem có phải free withdraw không
    const isFree = totalWithdrawn < turnWithdrawFree;

    return {
      isFree,
      totalWithdrawn,
      turnWithdrawFree,
    };
  }

  /**
   * Kiểm tra và đồng bộ balance trước khi rút tiền
   * Kiểm tra xem uw_balance có bằng tổng deposit - tổng withdraw - tổng staking không
   * Nếu không bằng thì gọi lại hàm kiểm tra lịch sử giao dịch và cập nhật balance
   * Đồng bộ TẤT CẢ networks của user (SOL, ETH, BSC, …) để đảm bảo tính chính xác
   * Chỉ cập nhật database nếu balance mới khác với balance cũ (uw_balance + staking)
   */
  private async checkAndSyncBalance(
    userId: number,
    coinId: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    network: Network,
  ): Promise<void> {
    try {
      // 1. Tính toán expected balance (từ TẤT CẢ networks)
      const expectedBalance = await this.calculateExpectedBalance(
        userId,
        coinId,
      );

      // 2. Lấy balance hiện tại từ database
      const userWallet = await this.userWalletRepository.findOne({
        where: {
          uw_user_id: userId,
          uw_wallet_coins: coinId,
        },
      });

      if (!userWallet) {
        // Nếu chưa có wallet, tạo mới với balance = expectedBalance
        const newWallet = this.userWalletRepository.create({
          uw_user_id: userId,
          uw_wallet_type: 'crypto' as any,
          uw_wallet_coins: coinId,
          uw_balance: expectedBalance,
        });
        await this.userWalletRepository.save(newWallet);
        return;
      }

      // 3. Kiểm tra điều kiện để quyết định có cần sync hay không
      // Tính các giá trị cần thiết để kiểm tra
      const totalDepositResult = await this.walletHistoryRepository
        .createQueryBuilder('wh')
        .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
        .where('wh.wh_user = :userId', { userId })
        .andWhere('wh.wh_coins = :coinId', { coinId })
        .andWhere('wh.wh_option = :option', {
          option: WalletHistoryOption.DEPOSIT,
        })
        .andWhere('wh.wh_status = :status', {
          status: WalletHistoryStatus.SUCCESS,
        })
        .getRawOne();

      const totalDeposit = parseFloat(totalDepositResult?.total || '0');

      const totalWithdrawResult = await this.walletHistoryRepository
        .createQueryBuilder('wh')
        .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
        .where('wh.wh_user = :userId', { userId })
        .andWhere('wh.wh_coins = :coinId', { coinId })
        .andWhere('wh.wh_option = :option', {
          option: WalletHistoryOption.WITHDRAW,
        })
        .andWhere('wh.wh_status IN (:...statuses)', {
          statuses: [
            WalletHistoryStatus.PENDING,
            WalletHistoryStatus.SUCCESS,
            WalletHistoryStatus.CHECKED,
          ],
        })
        .getRawOne();

      const totalWithdraw = parseFloat(totalWithdrawResult?.total || '0');

      const totalStaking = 0;

      // Tính totalReward từ wallet_transfers
      const totalRewardResult = await this.walletTransferRepository
        .createQueryBuilder('wt')
        .select('COALESCE(SUM(wt.wt_amount), 0)', 'total')
        .where('wt.wt_user_id = :userId', { userId })
        .andWhere('wt.wt_from IN (:...fromTypes)', {
          fromTypes: [WalletTransferFrom.REWARD, WalletTransferFrom.GIFT],
        })
        .andWhere('wt.wt_to = :toType', {
          toType: 'main',
        })
        .andWhere('wt.wt_status = :status', {
          status: WalletTransferStatus.SUCCESS,
        })
        .getRawOne();

      const totalReward = parseFloat(totalRewardResult?.total || '0');

      // Balance cũ chỉ là uw_balance (không cộng staking)
      const oldBalance = parseFloat(userWallet.uw_balance.toString());

      // Kiểm tra điều kiện để quyết định có cần sync hay không
      const availableAmount = totalDeposit + totalReward - totalWithdraw; // Số tiền có sẵn (chưa trừ staking)
      let shouldSync = true;

      // Trường hợp không có staking (totalStaking = 0) hoặc staking <= availableAmount
      // Logic: Nếu balance mới = balance cũ thì không cần sync
      if (totalStaking <= availableAmount) {
        // Bao gồm cả trường hợp totalStaking = 0 (không có staking nào)
        const tolerance = 0.00000001; // Sai số cho phép
        if (Math.abs(expectedBalance - oldBalance) <= tolerance) {
          shouldSync = false;
        }
      } else {
        // Trường hợp tổng staking > (totalDeposit - totalWithdraw) - có thể do lỗi dữ liệu hoặc edge case
        // Nếu balance mới + 10 < balance cũ thì không cần sync (cho phép chênh lệch tối đa 10)
        if (expectedBalance + 10 < oldBalance) {
          shouldSync = false;
        }
      }

      if (shouldSync) {
        // Balance không khớp, cần đồng bộ lại từ onchain
        // Lấy TẤT CẢ wallet networks của user để sync tất cả networks
        const walletNetworks = await this.useWalletNetworkRepository.find({
          where: {
            uwn_user_id: userId,
          },
        });

        // Sync từng network của user
        for (const walletNetwork of walletNetworks) {
          if (!walletNetwork.uwn_public_key) {
            continue;
          }

          // Lấy network object
          const networkObj = await this.networkRepository.findOne({
            where: { net_id: walletNetwork.uwn_network_id },
          });

          if (!networkObj) {
            continue;
          }

          try {
            // Tạo tracker tạm thời để sử dụng logic từ scheduler
            const tracker: ActiveWalletTracker = {
              awt_id: 0,
              uwn_id: walletNetwork.uwn_id,
              awt_last_accessed_at: new Date(),
              awt_expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 giờ
              awt_network_id: walletNetwork.uwn_network_id,
              awt_user_id: userId,
              awt_address: walletNetwork.uwn_public_key,
              created_at: new Date(),
              updated_at: new Date(),
            } as ActiveWalletTracker;

            // Gọi hàm từ scheduler service để kiểm tra và cập nhật balance cho từng network
            await this.walletsSchedulerService.syncWalletBalance(
              tracker,
              networkObj,
              coinId,
            );
          } catch (error) {
            // Log lỗi nhưng tiếp tục sync các networks khác
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(
              `Error syncing balance for network ${networkObj.net_symbol}: ${errorMessage}`,
            );
          }
        }

        // Sau khi sync tất cả networks, sử dụng hàm chung để cập nhật balance
        await this.walletsSchedulerService.updateUserBalanceIfChanged(
          userId,
          coinId,
        );
      }
      // Nếu không cần sync từ đầu, bỏ qua
    } catch (error) {
      // Log lỗi nhưng không throw để không block quá trình rút tiền
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Error checking and syncing balance: ${errorMessage}`);
    }
  }

  /**
   * Tính toán expected balance dựa trên công thức
   * expectedBalance = totalDeposit + totalReward - totalStaking - totalWithdraw
   * với totalReward = tổng wt_amount từ wallet_transfers (wt_from = reward/gift, wt_to = main, wt_status = success)
   */
  private async calculateExpectedBalance(
    userId: number,
    coinId: number,
  ): Promise<number> {
    // 1. Tổng số tiền nạp thành công
    const totalDepositResult = await this.walletHistoryRepository
      .createQueryBuilder('wh')
      .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
      .where('wh.wh_user = :userId', { userId })
      .andWhere('wh.wh_coins = :coinId', { coinId })
      .andWhere('wh.wh_option = :option', {
        option: WalletHistoryOption.DEPOSIT,
      })
      .andWhere('wh.wh_status = :status', {
        status: WalletHistoryStatus.SUCCESS,
      })
      .getRawOne();

    const totalDeposit = parseFloat(totalDepositResult?.total || '0');

    // 2. Tổng số tiền reward/gift chuyển vào main (từ wallet_transfers)
    const totalRewardResult = await this.walletTransferRepository
      .createQueryBuilder('wt')
      .select('COALESCE(SUM(wt.wt_amount), 0)', 'total')
      .where('wt.wt_user_id = :userId', { userId })
      .andWhere('wt.wt_from IN (:...fromTypes)', {
        fromTypes: [WalletTransferFrom.REWARD, WalletTransferFrom.GIFT],
      })
      .andWhere('wt.wt_to = :toType', {
        toType: 'main',
      })
      .andWhere('wt.wt_status = :status', {
        status: WalletTransferStatus.SUCCESS,
      })
      .getRawOne();

    const totalReward = parseFloat(totalRewardResult?.total || '0');

    const totalStaking = 0;

    // 4. Tổng số tiền đã rút (pending/success/checked)
    const totalWithdrawResult = await this.walletHistoryRepository
      .createQueryBuilder('wh')
      .select('COALESCE(SUM(wh.wh_amount), 0)', 'total')
      .where('wh.wh_user = :userId', { userId })
      .andWhere('wh.wh_coins = :coinId', { coinId })
      .andWhere('wh.wh_option = :option', {
        option: WalletHistoryOption.WITHDRAW,
      })
      .andWhere('wh.wh_status IN (:...statuses)', {
        statuses: [
          WalletHistoryStatus.PENDING,
          WalletHistoryStatus.SUCCESS,
          WalletHistoryStatus.CHECKED,
        ],
      })
      .getRawOne();

    const totalWithdraw = parseFloat(totalWithdrawResult?.total || '0');

    // 5. Tính expected balance
    const expectedBalance =
      totalDeposit + totalReward - totalStaking - totalWithdraw;
    // Đảm bảo balance không âm: nếu <= 0 thì return 0
    return expectedBalance <= 0 ? 0 : expectedBalance;
  }

  /**
   * Lấy lịch sử các giao dịch chuyển từ ví reward sang ví main
   * @param userId - User ID
   * @param status - Filter theo wt_status (optional)
   * @returns Danh sách wallet transfers từ reward sang main, sắp xếp theo thời gian mới nhất
   */
  async getTransferRewardsHistory(
    userId: number,
    status?: WalletTransferStatus,
  ): Promise<WalletTransfer[]> {
    const queryBuilder = this.walletTransferRepository
      .createQueryBuilder('wt')
      .where('wt.wt_user_id = :userId', { userId })
      .andWhere('wt.wt_from = :fromType', {
        fromType: WalletTransferFrom.REWARD,
      })
      .andWhere('wt.wt_to = :toType', { toType: WalletTransferTo.MAIN })
      .orderBy('wt.created_at', 'DESC'); // Sắp xếp theo thời gian mới nhất

    // Nếu có status, thêm điều kiện filter
    if (status) {
      queryBuilder.andWhere('wt.wt_status = :status', { status });
    }

    return await queryBuilder.getMany();
  }

  async transferRewardFromMainWallet(
    networkId: number,
    toAddress: string,
    amount: number,
  ): Promise<{
    txHash: string;
    networkId: number;
    coinSymbol: string;
  }> {
    const network = await this.networkRepository.findOne({
      where: { net_id: networkId },
    });

    if (!network) {
      throw new BadRequestException('Network not found');
    }

    const usdtCoin = await this.coinRepository.findOne({
      where: {
        coin_symbol: 'USDT',
        coin_status: CoinStatus.ACTIVE,
      },
    });

    if (!usdtCoin) {
      throw new BadRequestException('USDT coin not configured');
    }

    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic) {
      throw new BadRequestException('Wallet seed not configured');
    }

    if (!bip39.validateMnemonic(mnemonic)) {
      throw new BadRequestException('Invalid wallet seed');
    }

    const txHash = await this.sendWithdrawTransaction(
      network,
      usdtCoin,
      mnemonic,
      toAddress.trim(),
      amount,
    );

    return {
      txHash,
      networkId,
      coinSymbol: usdtCoin.coin_symbol,
    };
  }

  private generateInternalExchangeEmailCode(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    return result;
  }

  private async verifyInternalExchangeEmailCode(
    userId: number,
    emailCode: string,
  ): Promise<void> {
    const normalized = emailCode.trim().toUpperCase();
    const userCode = await this.userCodeRepository.findOne({
      where: {
        uc_user_id: userId,
        uc_type: UserCodeType.INTERNAL_EXCHANGE,
        uc_value: normalized,
        uc_life: true,
      },
      order: { created_at: 'DESC' },
    });
    if (!userCode) {
      throw new BadRequestException('Invalid verification code');
    }

    if (userCode.uc_code_time < new Date()) {
      userCode.uc_life = false;
      await this.userCodeRepository.save(userCode);
      throw new BadRequestException('Verification code has expired');
    }

    userCode.uc_life = false;
    await this.userCodeRepository.save(userCode);
  }

  /**
   * Gửi mã 6 ký tự qua email (template `getVerifyEmailCodeHtml`) để dùng khi gọi `internalExchangeTransfer`.
   */
  async sendInternalExchangeVerifyCode(userId: number): Promise<{
    message: string;
    expires_at: string;
  }> {
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      select: ['uid', 'uemail'],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.uemail) {
      throw new BadRequestException('User email is missing');
    }

    await this.userCodeRepository.update(
      {
        uc_user_id: userId,
        uc_type: UserCodeType.INTERNAL_EXCHANGE,
        uc_life: true,
      },
      { uc_life: false },
    );

    const code = this.generateInternalExchangeEmailCode();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
    const userCode = this.userCodeRepository.create({
      uc_value: code,
      uc_type: UserCodeType.INTERNAL_EXCHANGE,
      uc_place: UserCodePlace.EMAIL,
      uc_code_time: expiresAt,
      uc_life: true,
      uc_user_id: userId,
    });
    await this.userCodeRepository.save(userCode);
    await this.emailService.sendEmailVerificationCode(user.uemail, code);

    return {
      message: 'Verification code has been sent to your email',
      expires_at: expiresAt.toISOString(),
    };
  }

  private async getUserWalletPessimisticOrCreate(
    manager: EntityManager,
    userId: number,
    coinId: number,
  ): Promise<UserWallet> {
    let row = await manager
      .getRepository(UserWallet)
      .createQueryBuilder('uw')
      .setLock('pessimistic_write')
      .where('uw.uw_user_id = :uid', { uid: userId })
      .andWhere('uw.uw_wallet_coins = :cid', { cid: coinId })
      .getOne();

    if (!row) {
      const created = manager.create(UserWallet, {
        uw_user_id: userId,
        uw_wallet_type: WalletType.CRYPTO,
        uw_wallet_coins: coinId,
        uw_balance: 0 as any,
        uw_lock_balance: 0 as any,
      });
      await manager.save(UserWallet, created);
      row = await manager
        .getRepository(UserWallet)
        .createQueryBuilder('uw')
        .setLock('pessimistic_write')
        .where('uw.uw_user_id = :uid', { uid: userId })
        .andWhere('uw.uw_wallet_coins = :cid', { cid: coinId })
        .getOne();
    }

    if (!row) {
      throw new BadRequestException('Wallet row could not be loaded');
    }
    return row;
  }

  /**
   * Chuyển coin nội bộ giữa hai user. Kiểm tra giống rút on-chain (KYC, 2FA, phí, max),
   * cập nhật số dư trong một transaction DB với khóa pessimistic (thứ tự user id để tránh deadlock).
   */
  async internalExchangeTransfer(
    senderUserId: number,
    recipientUserId: number,
    coinId: number,
    amount: number,
    emailCode: string,
    twoFactorCode?: string,
  ): Promise<{
    message: string;
    sender_history_id: number;
    receiver_history_id: number;
    amount_debited: number;
    amount_credited: number;
    is_free_withdraw: boolean;
  }> {
    this.logger.debug(
      `[internalExchange] sender=${senderUserId} recipient=${recipientUserId} coin=${coinId} amount=${amount}`,
    );

    if (recipientUserId === senderUserId) {
      throw new BadRequestException('Cannot transfer to yourself');
    }

    const sender = await this.userRepository.findOne({
      where: { uid: senderUserId },
      select: [
        'uid',
        'uverify',
        'ustatus',
        'u_active_ggauth',
        'uggauth',
        'uemail',
      ],
    });

    if (!sender) {
      throw new BadRequestException('User not found');
    }

    requireTotpIfEnabled(sender, twoFactorCode);

    await this.verifyInternalExchangeEmailCode(senderUserId, emailCode);

    if (!sender.uverify) {
      throw new BadRequestException('Identity not verified');
    }

    if (sender.ustatus !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        'System is overloaded! Please try again later',
      );
    }

    const recipient = await this.userRepository.findOne({
      where: { uid: recipientUserId },
      select: ['uid', 'uverify', 'ustatus'],
    });

    if (!recipient) {
      throw new BadRequestException('Recipient user not found');
    }

    if (!recipient.uverify) {
      throw new BadRequestException('Recipient identity not verified');
    }

    if (recipient.ustatus !== UserStatus.ACTIVE) {
      throw new BadRequestException('Recipient account is not active');
    }

    const coin = await this.coinRepository.findOne({
      where: { coin_id: coinId },
    });

    if (!coin) {
      throw new BadRequestException('Coin not found');
    }

    const coinNetwork = await this.coinNetworkRepository.findOne({
      where: {
        cn_coin_id: coin.coin_id,
        cn_status: CoinNetworkStatus.ACTIVE,
      },
    });

    if (!coinNetwork) {
      throw new BadRequestException(
        `Coin ${coin.coin_symbol} is not available for transfer`,
      );
    }

    const network = await this.networkRepository.findOne({
      where: { net_id: coinNetwork.cn_network_id },
    });

    if (!network) {
      throw new BadRequestException('Network not found for coin');
    }

    await this.checkAndSyncBalance(senderUserId, coin.coin_id, network);

    const freeWithdrawInfo = await this.checkFreeWithdraw(senderUserId);
    const WITHDRAW_FEE = 1;
    let creditAmount = amount;
    const isFreeWithdraw = freeWithdrawInfo.isFree;

    if (!isFreeWithdraw) {
      creditAmount = amount - WITHDRAW_FEE;
      if (creditAmount <= 0) {
        throw new BadRequestException(
          `Transfer amount must be greater than withdrawal fee (${WITHDRAW_FEE})`,
        );
      }
    }

    const maxWithdraw = await this.checkMaxWithdraw();
    if (maxWithdraw !== null && amount > maxWithdraw) {
      throw new BadRequestException(
        `Transfer amount exceeds maximum allowed. Maximum withdraw: ${maxWithdraw}`,
      );
    }

    const uLow =
      senderUserId < recipientUserId ? senderUserId : recipientUserId;
    const uHigh =
      senderUserId < recipientUserId ? recipientUserId : senderUserId;

    const { sender_history_id, receiver_history_id } =
      await this.dataSource.transaction(async (manager) => {
        const wLow = await this.getUserWalletPessimisticOrCreate(
          manager,
          uLow,
          coinId,
        );
        const wHigh = await this.getUserWalletPessimisticOrCreate(
          manager,
          uHigh,
          coinId,
        );

        const senderWallet = senderUserId === uLow ? wLow : wHigh;
        const receiverWallet = recipientUserId === uLow ? wLow : wHigh;

        const senderBal = parseFloat(senderWallet.uw_balance.toString());
        if (senderBal < amount) {
          throw new BadRequestException('Insufficient balance');
        }

        const receiverBal = parseFloat(receiverWallet.uw_balance.toString());
        let newSenderBal = senderBal - amount;
        if (newSenderBal <= 0) {
          newSenderBal = 0;
        }
        const newReceiverBal = receiverBal + creditAmount;

        senderWallet.uw_balance = newSenderBal as any;
        receiverWallet.uw_balance = newReceiverBal as any;
        await manager.save(UserWallet, [senderWallet, receiverWallet]);

        const whSend = manager.create(WalletHistory, {
          wh_wallet_netword_id: null,
          wh_type: WalletHistoryType.CRYPTO,
          wh_option: WalletHistoryOption.WITHDRAW,
          wh_coins: coin.coin_id,
          wh_amount: amount,
          wh_hash: null,
          wh_imnage_veryfy: null,
          wh_status: WalletHistoryStatus.SUCCESS,
          wh_node: `internal-to:${recipientUserId}`,
          wh_user: senderUserId,
        });

        const whRecv = manager.create(WalletHistory, {
          wh_wallet_netword_id: null,
          wh_type: WalletHistoryType.CRYPTO,
          wh_option: WalletHistoryOption.DEPOSIT,
          wh_coins: coin.coin_id,
          wh_amount: creditAmount,
          wh_hash: null,
          wh_imnage_veryfy: null,
          wh_status: WalletHistoryStatus.SUCCESS,
          wh_node: `internal-from:${senderUserId}`,
          wh_user: recipientUserId,
        });

        const savedSend = await manager.save(WalletHistory, whSend);
        const savedRecv = await manager.save(WalletHistory, whRecv);
        return {
          sender_history_id: savedSend.wh_id,
          receiver_history_id: savedRecv.wh_id,
        };
      });

    return {
      message: 'Internal transfer successful',
      sender_history_id,
      receiver_history_id,
      amount_debited: amount,
      amount_credited: creditAmount,
      is_free_withdraw: isFreeWithdraw,
    };
  }

  async withdraw(
    userId: number,
    networkId: number,
    coinId: number,
    address: string,
    amount: number,
    twoFactorCode?: string,
  ): Promise<any> {
    // Normalize address: trim whitespace để tránh lỗi do người dùng nhập nhầm
    address = address.trim();

    this.logger.debug(
      `[withdraw] start userId=${userId} network_id=${networkId} coin_id=${coinId} ` +
        `to=${address} amount=${amount}`,
    );

    // 0. Kiểm tra user đã xác minh danh tính và status = active
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      select: [
        'uid',
        'uverify',
        'ustatus',
        'u_active_ggauth',
        'uggauth',
        'uemail',
      ],
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    requireTotpIfEnabled(user, twoFactorCode);

    if (!user.uverify) {
      throw new BadRequestException('Identity not verified');
    }

    if (user.ustatus !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        'System is overloaded! Please try again later',
      );
    }

    // 1. Tìm network theo net_id
    const network = await this.networkRepository.findOne({
      where: { net_id: networkId },
    });

    if (!network) {
      throw new BadRequestException('Network not found');
    }

    const netSymUpper = network.net_symbol.trim().toUpperCase();
    const withdrawSupported =
      netSymUpper === 'SOL' ||
      netSymUpper === 'ETH' ||
      netSymUpper === 'BSC' ||
      this.isTronNetwork(network.net_symbol);
    if (!withdrawSupported) {
      throw new BadRequestException(
        'Withdraw is only supported on SOL, ETH, BSC, and TRX networks',
      );
    }

    this.logger.debug(
      `[withdraw] resolved network=${network.net_symbol} net_id=${network.net_id}`,
    );

    // 1.5. Kiểm tra và chặn rút tiền về ví của chính user
    // Lấy tất cả ví của user từ bảng use_wallet_networks
    const userWallets = await this.useWalletNetworkRepository.find({
      where: {
        uwn_user_id: userId,
      },
    });

    // Kiểm tra xem address có trùng với bất kỳ ví nào của user không
    // (address đã được trim ở đầu hàm)
    for (const userWallet of userWallets) {
      if (!userWallet.uwn_public_key) {
        continue; // Bỏ qua nếu không có public_key
      }

      // Normalize public_key: trim whitespace
      const normalizedPublicKey = userWallet.uwn_public_key.trim();

      // SOL / TRX: base58 case-sensitive; EVM: checksum-insensitive
      let isMatch = false;

      if (
        network.net_symbol === 'SOL' ||
        this.isTronNetwork(network.net_symbol)
      ) {
        isMatch = address === normalizedPublicKey;
      } else {
        isMatch = address.toLowerCase() === normalizedPublicKey.toLowerCase();
      }

      if (isMatch) {
        throw new BadRequestException(
          'Cannot withdraw to your own wallet address',
        );
      }
    }

    // 2. Tìm coin theo coin_id
    const coin = await this.coinRepository.findOne({
      where: { coin_id: coinId },
    });

    if (!coin) {
      throw new BadRequestException('Coin not found');
    }

    this.logger.debug(
      `[withdraw] resolved coin=${coin.coin_symbol} coin_id=${coin.coin_id}`,
    );

    // 2.3. Kiểm tra coin có tồn tại trên network này không
    const coinNetwork = await this.coinNetworkRepository.findOne({
      where: {
        cn_coin_id: coin.coin_id,
        cn_network_id: network.net_id,
        cn_status: CoinNetworkStatus.ACTIVE,
      },
    });

    if (!coinNetwork) {
      throw new BadRequestException(
        `Coin ${coin.coin_symbol} is not available on network ${network.net_symbol}`,
      );
    }

    this.logger.debug(
      `[withdraw] coinNetwork active mint/contract=${
        coinNetwork.cn_coin_mint
          ? this.debugShortAddr(coinNetwork.cn_coin_mint, 10, 8)
          : 'native'
      }`,
    );

    // 2.5. Kiểm tra và đồng bộ balance trước khi kiểm tra amount
    await this.checkAndSyncBalance(userId, coin.coin_id, network);

    // 3. Kiểm tra số dư uw_balance của user với coin đó (sau khi đã đồng bộ)
    const userWallet = await this.userWalletRepository.findOne({
      where: {
        uw_user_id: userId,
        uw_wallet_coins: coin.coin_id,
      },
    });

    if (!userWallet) {
      throw new BadRequestException('Wallet not found for this coin');
    }

    // 3.5. Kiểm tra free withdraw để tính phí (nếu có)
    const freeWithdrawInfo = await this.checkFreeWithdraw(userId);
    const WITHDRAW_FEE = 1; // Phí rút tiền: 1 USDT (hoặc 1 đơn vị của coin đang rút)
    let onchainAmount = amount; // Số tiền sẽ rút onchain
    const isFreeWithdraw = freeWithdrawInfo.isFree;

    // Nếu không phải free withdraw, trừ phí 1 USDT
    if (!isFreeWithdraw) {
      onchainAmount = amount - WITHDRAW_FEE;
      if (onchainAmount <= 0) {
        throw new BadRequestException(
          `Withdraw amount must be greater than withdrawal fee (${WITHDRAW_FEE})`,
        );
      }
    }

    // 4. Kiểm tra số dư uw_balance của user với coin đó (kiểm tra với amount gốc)
    const balance = parseFloat(userWallet.uw_balance.toString());
    if (balance < amount) {
      throw new BadRequestException('Insufficient balance');
    }

    // 5. Kiểm tra max_withdraw trước khi xử lý rút tiền (kiểm tra với amount gốc)
    const maxWithdraw = await this.checkMaxWithdraw();
    if (maxWithdraw !== null && amount > maxWithdraw) {
      throw new BadRequestException(
        `Withdraw amount exceeds maximum allowed. Maximum withdraw: ${maxWithdraw}`,
      );
    }

    // 6. Lấy SEED từ .env và tạo ví sàn
    const mnemonic = this.configService.get<string>('WALLET_SEED');
    if (!mnemonic) {
      throw new BadRequestException('Wallet seed not configured');
    }

    if (!bip39.validateMnemonic(mnemonic)) {
      throw new BadRequestException('Invalid wallet seed');
    }

    // 7. Ghi nhận uwn_id (ví nạp user trên network) cho wallet_history — on-chain rút từ ví main 382', phí từ ví 369'.
    const userWalletNetwork = await this.useWalletNetworkRepository.findOne({
      where: {
        uwn_user_id: userId,
        uwn_network_id: network.net_id,
      },
    });

    // 8. Tạo wallet_history với status PENDING
    // Lưu ý: Database vẫn ghi nhận amount gốc (bao gồm cả phí nếu có)
    const walletHistory = this.walletHistoryRepository.create({
      wh_wallet_netword_id: userWalletNetwork?.uwn_id || null, // Lấy uwn_id từ wallet network của user
      wh_type: WalletHistoryType.CRYPTO,
      wh_option: WalletHistoryOption.WITHDRAW,
      wh_coins: coin.coin_id,
      wh_amount: amount, // Lưu amount gốc vào database
      wh_hash: null,
      wh_imnage_veryfy: null,
      wh_status: WalletHistoryStatus.PENDING,
      wh_node: null,
      wh_user: userId,
    });

    const savedHistory = await this.walletHistoryRepository.save(walletHistory);

    try {
      // 9. Gửi từ ví main (382') tới đích; phí mạng do ví fee (369') (SOL ký 2 bên; EVM nạp gas; TRX ủy quyền energy từ fee).
      const txHash = await this.sendWithdrawTransaction(
        network,
        coin,
        mnemonic,
        address,
        onchainAmount,
      );

      // 10. Cập nhật wallet_history với hash, status SUCCESS và wh_node
      savedHistory.wh_hash = txHash;
      savedHistory.wh_status = WalletHistoryStatus.SUCCESS;
      savedHistory.wh_node = network.net_symbol; // Cập nhật network symbol
      await this.walletHistoryRepository.save(savedHistory);

      // 11. Trừ số dư từ user_wallet (trừ amount gốc, bao gồm cả phí)
      let newBalance = balance - amount;
      // Đảm bảo balance không âm: nếu <= 0 thì set = 0
      if (newBalance <= 0) {
        newBalance = 0;
      }
      userWallet.uw_balance = newBalance as any; // TypeORM decimal type
      await this.userWalletRepository.save(userWallet);

      if (user.uemail) {
        try {
          await this.emailService.sendWithdrawNotification(user.uemail, {
            amount,
            asset: coin.coin_symbol,
            network: network.net_symbol,
            txHash,
            destinationAddress: address,
            createdAt: savedHistory.updated_at || new Date(),
            status: 'completed',
          });
        } catch (emailError: any) {
          this.logger.error(
            `[withdraw] send email failed userId=${userId}: ${emailError?.message || emailError}`,
          );
        }
      }

      return {
        message: 'Withdraw successful',
        transaction_hash: txHash,
        history_id: savedHistory.wh_id,
        amount_withdrawn: amount, // Amount gốc (bao gồm phí)
        onchain_amount: onchainAmount, // Amount thực tế rút onchain
        is_free_withdraw: isFreeWithdraw,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[withdraw] onchain transfer failed userId=${userId} network=${network.net_symbol} coin=${coin.coin_symbol} ` +
          `to=${address} amount=${amount} onchainAmount=${onchainAmount} historyId=${savedHistory.wh_id} ` +
          `err=${errMsg}`,
      );
      if (errStack) {
        this.logger.debug(`[withdraw] error stack: ${errStack}`);
      }
      // 12. Nếu lỗi, cập nhật status thành FAILED (lưu chi tiết vào wh_node để admin xem)
      savedHistory.wh_status = WalletHistoryStatus.FAILED;
      savedHistory.wh_node = errMsg || 'Transaction failed';
      await this.walletHistoryRepository.save(savedHistory);

      throw new BadRequestException(WITHDRAW_ERROR_MESSAGE);
    }
  }

  /**
   * Lấy lịch sử giao dịch nạp/rút tiền của user
   * @param userId - ID của user
   * @param coinParam - coin_id hoặc coin_symbol (optional)
   * @param networkParam - network_id hoặc network_symbol (optional)
   * @param type - 'withdraw' hoặc 'deposit' (optional, nếu trống thì lấy cả hai, không lấy admin-deposit)
   * @returns Danh sách lịch sử giao dịch
   */
  async getTransactionHistory(
    userId: number,
    coinParam?: string,
    networkParam?: string,
    type?: 'withdraw' | 'deposit',
  ): Promise<WalletHistory[]> {
    // 1. Tìm coin nếu có coinParam
    let coinId: number | null = null;
    if (coinParam) {
      const coinIdNum = parseInt(coinParam, 10);
      let coin: Coin | null = null;

      if (!isNaN(coinIdNum)) {
        coin = await this.coinRepository.findOne({
          where: { coin_id: coinIdNum },
        });
      }

      if (!coin) {
        coin = await this.coinRepository.findOne({
          where: { coin_symbol: coinParam.toUpperCase() },
        });
      }

      if (!coin) {
        throw new BadRequestException(`Coin not found: ${coinParam}`);
      }

      coinId = coin.coin_id;
    }

    // 2. Tìm network nếu có networkParam
    let networkId: number | null = null;
    if (networkParam) {
      const networkIdNum = parseInt(networkParam, 10);
      let network: Network | null = null;

      if (!isNaN(networkIdNum)) {
        network = await this.networkRepository.findOne({
          where: { net_id: networkIdNum },
        });
      }

      if (!network) {
        network = await this.networkRepository.findOne({
          where: { net_symbol: networkParam.toUpperCase() },
        });
      }

      if (!network) {
        throw new BadRequestException(`Network not found: ${networkParam}`);
      }

      networkId = network.net_id;
    }

    // 3. Xây dựng query builder
    const queryBuilder = this.walletHistoryRepository
      .createQueryBuilder('wh')
      .where('wh.wh_user = :userId', { userId })
      .andWhere('wh.wh_type = :type', { type: WalletHistoryType.CRYPTO });

    // 4. Filter theo coin nếu có
    if (coinId !== null) {
      queryBuilder.andWhere('wh.wh_coins = :coinId', { coinId });
    }

    // 5. Filter theo network nếu có (ưu tiên wh_wallet_netword_id, fallback wh_node)
    if (networkId !== null) {
      const network = await this.networkRepository.findOne({
        where: { net_id: networkId },
      });
      if (network) {
        // Lấy tất cả uwn_id của user cho network này
        const userWalletNetworks = await this.useWalletNetworkRepository.find({
          where: {
            uwn_user_id: userId,
            uwn_network_id: networkId,
          },
          select: ['uwn_id'],
        });
        const uwnIds = userWalletNetworks.map((uwn) => uwn.uwn_id);

        if (uwnIds.length > 0) {
          // Lọc theo wh_wallet_netword_id (chính xác) hoặc fallback về wh_node cho records cũ
          queryBuilder.andWhere(
            '(wh.wh_wallet_netword_id IN (:...uwnIds) OR (wh.wh_wallet_netword_id IS NULL AND wh.wh_node = :networkSymbol))',
            {
              uwnIds,
              networkSymbol: network.net_symbol,
            },
          );
        } else {
          // Nếu user chưa có wallet network này, chỉ lọc theo wh_node (records cũ)
          queryBuilder.andWhere('wh.wh_node = :networkSymbol', {
            networkSymbol: network.net_symbol,
          });
        }
      }
    }

    // 6. Filter theo type (withdraw hoặc deposit)
    // Nếu type không được truyền, lấy cả withdraw và deposit (không lấy admin-deposit)
    if (type) {
      if (type === 'withdraw') {
        queryBuilder.andWhere('wh.wh_option = :option', {
          option: WalletHistoryOption.WITHDRAW,
        });
      } else if (type === 'deposit') {
        queryBuilder.andWhere('wh.wh_option = :option', {
          option: WalletHistoryOption.DEPOSIT,
        });
      }
    } else {
      // Lấy cả withdraw và deposit, không lấy admin-deposit
      queryBuilder.andWhere('wh.wh_option IN (:...options)', {
        options: [WalletHistoryOption.WITHDRAW, WalletHistoryOption.DEPOSIT],
      });
    }

    // 7. Sắp xếp theo created_at DESC (mới nhất trước)
    queryBuilder.orderBy('wh.created_at', 'DESC');

    // 8. Lấy kết quả
    return await queryBuilder.getMany();
  }
}
