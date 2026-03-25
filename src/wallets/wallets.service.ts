/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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
  JsonRpcProvider,
  parseUnits,
  Contract,
  Interface,
  Wallet,
  Network as EthersNetwork,
  getAddress,
} from 'ethers';
import * as QRCode from 'qrcode';
import { UserWalletNetwork } from './entities/user-wallet-network.entity';
import { UserWallet } from './entities/user-wallet.entity';
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
import { ActiveWalletTracker } from './entities/active-wallet-tracker.entity';
import { Coin } from '../settings/entities/coin.entity';
import { Network } from '../settings/entities/network.entity';
import {
  CoinNetwork,
  CoinNetworkStatus,
} from '../settings/entities/coin-network.entity';
import {
  AdminSetting,
  FundType,
} from '../settings/entities/admin-setting.entity';
import { WalletsSchedulerService } from './wallets-scheduler.service';
import { RpcRateLimitService } from '../common/rpc-rate-limit.service';
import { AdminSettingsConfigService } from '../settings/admin-settings-config.service';

/** Thông báo lỗi chung trả về frontend khi rút tiền thất bại (ví main thiếu dư, RPC lỗi, simulation fail, ...). */
const WITHDRAW_ERROR_MESSAGE =
  'The system is overloaded. Please try again later or try a different network.';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  private debugShortAddr(addr: string, head = 8, tail = 6): string {
    const s = (addr || '').trim();
    if (!s) return '(empty)';
    if (s.length <= head + tail + 3) return s;
    return `${s.slice(0, head)}...${s.slice(-tail)}`;
  }

  constructor(
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
    @InjectRepository(AdminSetting)
    private adminSettingRepository: Repository<AdminSetting>,
    @InjectRepository(CoinNetwork)
    private coinNetworkRepository: Repository<CoinNetwork>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(WalletTransfer)
    private walletTransferRepository: Repository<WalletTransfer>,
    private configService: ConfigService,
    private walletsSchedulerService: WalletsSchedulerService,
    private rpcRateLimitService: RpcRateLimitService,
    private adminSettingsConfigService: AdminSettingsConfigService,
  ) {}

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
   * Địa chỉ được trim để tránh trùng do khoảng trắng. Cùng địa chỉ trên hai mạng (VD: ETH và BNB) là hai ví khác nhau, có hai bản ghi.
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
   * Generate public key for ETH/BNB using BIP44 derivation path
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
    // If d is provided, use full path with d, otherwise use old format without d
    const path =
      d !== undefined
        ? `m/44'/501'/0'/${a}'/${b}'/${c}'/${d}'`
        : `m/44'/501'/0'/${a}'/${b}'/${c}'`;
    const derivedSeed = derivePath(path, seed.toString('hex'));
    const keypair = Keypair.fromSeed(derivedSeed.key);
    return keypair.publicKey.toBase58();
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

    // 2.5. Kiểm tra nếu đang tạo ví ETH hoặc BNB, xem đã có ví của mạng lưới còn lại chưa
    // Nếu có, sử dụng lại cùng public key và uwn_end_path (vì ETH và BNB dùng cùng HD Wallet derivation)
    if (network.net_symbol === 'ETH' || network.net_symbol === 'BNB') {
      const otherNetworkSymbol = network.net_symbol === 'ETH' ? 'BNB' : 'ETH';
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

    // 5. Tạo wallet tạm để lấy uwn_id
    // Sử dụng path cũ (không có d) để tạo public key tạm
    let tempPublicKey: string;

    if (network.net_symbol === 'SOL') {
      // Sử dụng ed25519 derivation cho Solana
      // Path format tạm: m/44'/501'/0'/{a}'/{b}'/{c}'
      tempPublicKey = this.generateSolAddress(mnemonic, a, b, c);
    } else {
      // Sử dụng BIP44 derivation cho ETH, BNB và các mạng EVM khác
      // Path format tạm: m/44'/60'/0'/{a}'/{b}'/{c}'
      tempPublicKey = this.generateEthAddress(mnemonic, a, b, c);
    }

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

    // 9. Generate lại public key với path mới có d
    // Path format mới: m/44'/60'/0'/{a}'/{b}'/{c}'/{d}' (ETH/BNB)
    // Path format mới: m/44'/501'/0'/{a}'/{b}'/{c}'/{d}' (SOL)
    let finalPublicKey: string;

    if (network.net_symbol === 'SOL') {
      // Sử dụng ed25519 derivation cho Solana
      // Path format: m/44'/501'/0'/{a}'/{b}'/{c}'/{d}'
      finalPublicKey = this.generateSolAddress(mnemonic, a, b, c, d);
    } else {
      // Sử dụng BIP44 derivation cho ETH, BNB và các mạng EVM khác
      // Path format: m/44'/60'/0'/{a}'/{b}'/{c}'/{d}'
      finalPublicKey = this.generateEthAddress(mnemonic, a, b, c, d);
    }

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

  /**
   * Generate exchange wallet (ví sàn) with fixed path
   * Path: m/44'/60'/0'/0'/0'/382' (ETH/BNB) or m/44'/501'/0'/0'/0'/382' (SOL)
   */
  private getExchangeWallet(
    mnemonic: string,
    networkSymbol: string,
  ): HDNodeWallet | Keypair {
    if (networkSymbol === 'SOL') {
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const derivedSeed = derivePath(
        `m/44'/501'/0'/0'/0'/382'`,
        seed.toString('hex'),
      );
      return Keypair.fromSeed(derivedSeed.key);
    } else {
      // ETH/BNB và các mạng EVM khác
      // Sử dụng bip32 để tạo ví sàn (nhất quán với generateEthAddress)
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const bip32Factory = bip32.BIP32Factory(tinysecp);
      const root = bip32Factory.fromSeed(seed);

      // Derive path: m/44'/60'/0'/0'/0'/382'
      const derivedNode = root.derivePath(`m/44'/60'/0'/0'/0'/382'`);

      // Chuyển đổi private key từ bip32 sang Wallet để lấy HDNodeWallet
      const privateKeyBuffer = derivedNode.privateKey;
      const privateKey = `0x${Buffer.from(privateKeyBuffer).toString('hex')}`;
      const wallet = new Wallet(privateKey);

      // Tạo HDNodeWallet từ private key để có thể sử dụng connect()
      // Note: Wallet trong ethers v6 không phải HDNodeWallet, nhưng có thể dùng trực tiếp
      // Hoặc tạo HDNodeWallet từ extended key
      return wallet as any as HDNodeWallet;
    }
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

  /** Chuẩn hóa địa chỉ EVM (checksum) để tránh lỗi "bad address checksum" (BNB/ETH). */
  private normalizeEvmAddress(address: string): string {
    if (!address || !address.startsWith('0x')) return address;
    try {
      return getAddress(address);
    } catch {
      return getAddress(address.toLowerCase());
    }
  }

  private async sendTransaction(
    network: Network,
    coin: Coin,
    exchangeWallet: HDNodeWallet | Keypair | Wallet,
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
        const keypair = exchangeWallet as Keypair;
        const mintPublicKey = new PublicKey(coinNetwork.cn_coin_mint);
        const toPublicKey = new PublicKey(toAddress);

        // Kiểm tra xem coin có phải native SOL không
        if (coin.coin_symbol === 'SOL') {
          // Native SOL transfer
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: toPublicKey,
              lamports: amount * 1e9, // Convert to lamports (1 SOL = 1e9 lamports)
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
          // SPL Token transfer (USDT, USDC, etc.)
          // Lấy mint info để biết decimals
          const mintInfo = await this.rpcRateLimitService.withRpcLimit(() =>
            getMint(connection, mintPublicKey),
          );
          const decimals = mintInfo.decimals;

          // Lấy associated token address của sender và receiver
          const fromTokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            keypair.publicKey,
          );
          const toTokenAccount = await getAssociatedTokenAddress(
            mintPublicKey,
            toPublicKey,
          );

          this.logger.debug(
            `[withdraw-sol-spl] rpcUrl=${rpcUrl} mint=${mintPublicKey.toBase58()} decimals=${decimals} ` +
              `fromWallet=${keypair.publicKey.toBase58()} fromATA=${fromTokenAccount.toBase58()} ` +
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
            this.logger.error(
              `[withdraw-sol-spl] sender ATA missing/invalid fromATA=${fromTokenAccount.toBase58()} err=${errMsg}`,
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
            this.logger.debug(
              `[withdraw-sol-spl] receiver ATA not found, will create ATA. toATA=${toTokenAccount.toBase58()} err=${errMsg}`,
            );
          }

          // Tạo transaction
          const transaction = new Transaction();

          // Nếu token account của receiver chưa tồn tại, thêm instruction để tạo
          if (!toTokenAccountInfo) {
            transaction.add(
              createAssociatedTokenAccountInstruction(
                keypair.publicKey, // payer
                toTokenAccount, // associatedTokenAddress
                toPublicKey, // owner
                mintPublicKey, // mint
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
              keypair.publicKey,
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
          transaction.feePayer = keypair.publicKey;

          // Simulate transaction trước khi gửi để kiểm tra lỗi
          try {
            const simulation = await this.rpcRateLimitService.withRpcLimit(() =>
              connection.simulateTransaction(transaction),
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
            connection.sendTransaction(transaction, [keypair]),
          );
          await this.rpcRateLimitService.withRpcLimit(() =>
            connection.confirmTransaction(signature, 'confirmed'),
          );
          return signature;
        }
      });
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

      const wallet = exchangeWallet as HDNodeWallet | Wallet;
      let lastEvmErr: Error | null = null;
      for (const rpcUrl of rpcUrls) {
        try {
          // Tạo provider với static network để tránh auto-detect (tránh retry liên tục)
          let provider: JsonRpcProvider;
          if (network.net_symbol === 'ETH') {
            const ethNetwork = EthersNetwork.from('mainnet');
            provider = new JsonRpcProvider(rpcUrl, ethNetwork, {
              staticNetwork: ethNetwork,
            });
          } else if (
            network.net_symbol === 'BNB' ||
            network.net_symbol === 'BSC'
          ) {
            const bscNetwork = new EthersNetwork('bsc', 56);
            provider = new JsonRpcProvider(rpcUrl, bscNetwork, {
              staticNetwork: bscNetwork,
            });
          } else {
            provider = new JsonRpcProvider(rpcUrl);
          }

          const connectedWallet = wallet.connect(provider);
          const normalizedToAddressEvm = this.normalizeEvmAddress(toAddress);

          // Kiểm tra xem coin có phải native token không (ETH hoặc BNB)
          const isNativeToken =
            coin.coin_symbol === network.net_symbol ||
            (network.net_symbol === 'ETH' && coin.coin_symbol === 'ETH') ||
            (network.net_symbol === 'BNB' && coin.coin_symbol === 'BNB');

          if (isNativeToken) {
            // Native token transfer (ETH hoặc BNB)
            // Kiểm tra balance của sender trước khi transfer
            const transferAmount = parseUnits(amount.toString(), 18);
            const senderBalance = await this.rpcRateLimitService.withRpcLimit(
              () => provider.getBalance(connectedWallet.address),
            );

            // Ước tính gas fee (có thể lấy từ feeData)
            const feeData = await this.rpcRateLimitService.withRpcLimit(() =>
              provider.getFeeData(),
            );
            const estimatedGasLimit = 21000; // Gas limit cho native token transfer
            const estimatedGasFee = feeData.gasPrice
              ? feeData.gasPrice * BigInt(estimatedGasLimit)
              : BigInt(0);

            // Kiểm tra balance có đủ cho cả transfer amount và gas fee không
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
            // Chuẩn hóa địa chỉ checksum (tránh lỗi "bad address checksum" trên BNB/ETH)
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
    // 1. Lấy giá trị as_fund_amount từ admin_settings
    const adminSettings = await this.adminSettingRepository.find({
      order: { as_id: 'ASC' }, // Lấy record đầu tiên nếu có nhiều
      take: 1,
    });
    const adminSetting = adminSettings.length > 0 ? adminSettings[0] : null;

    // Nếu không tồn tại hoặc as_fund_amount <= 0 thì bỏ qua
    if (
      !adminSetting ||
      !adminSetting.as_fund_amount ||
      adminSetting.as_fund_amount <= 0
    ) {
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

    // 4. Tính max_withdraw dựa trên as_fund_type
    let maxWithdraw: number;

    if (adminSetting.as_fund_type === FundType.GAIN_LOSS) {
      // gain_loss: max_withdraw = total_deposit + as_fund_amount - total_withdraw
      maxWithdraw = totalDeposit + adminSetting.as_fund_amount - totalWithdraw;
    } else if (adminSetting.as_fund_type === FundType.ALWAYS_PROFITABLE) {
      // always_profitable: max_withdraw = total_deposit - as_fund_amount - total_withdraw
      maxWithdraw = totalDeposit - adminSetting.as_fund_amount - totalWithdraw;
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

    // 2. Lấy giá trị as_turn_withdraw_free từ admin_settings
    const adminSettings = await this.adminSettingRepository.find({
      order: { as_id: 'ASC' },
      take: 1,
    });
    const adminSetting = adminSettings.length > 0 ? adminSettings[0] : null;

    let turnWithdrawFree = 0;
    if (
      adminSetting &&
      adminSetting.as_turn_withdraw_free !== null &&
      adminSetting.as_turn_withdraw_free !== undefined &&
      adminSetting.as_turn_withdraw_free > 0
    ) {
      turnWithdrawFree = adminSetting.as_turn_withdraw_free;
    }

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
   * Đồng bộ TẤT CẢ networks của user (SOL, ETH, BNB) để đảm bảo tính chính xác
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
          uw_balance_gift: 0,
          uw_balance_reward: 0,
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
            console.error(
              `Error syncing balance for network ${networkObj.net_symbol}: ${error.message}`,
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
      console.error(`Error checking and syncing balance: ${error.message}`);
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
   * Tổng uw_balance_reward trên các ví của user (không còn nguồn mission/staking/referral).
   */
  async calculateBalanceReward(userId: number): Promise<number> {
    const rows = await this.userWalletRepository.find({
      where: { uw_user_id: userId },
    });
    const sum = rows.reduce(
      (s, r) => s + parseFloat(String(r.uw_balance_reward ?? 0)),
      0,
    );
    return sum < 0 ? 0 : sum;
  }

  /**
   * Transfer reward balance to main balance
   * Tính toán số dư reward thực và cộng vào uw_balance
   * Sử dụng hàm calculateBalanceReward để đảm bảo tính nhất quán
   */
  async transferReward(userId: number): Promise<{
    message: string;
    newBalanceReward: number;
    updatedCoins: number[];
  }> {
    // 1. Tính newBalanceReward từ hàm helper để đảm bảo tính nhất quán
    const newBalanceReward = await this.calculateBalanceReward(userId);

    // 5. Kiểm tra newBalanceReward > 0
    if (newBalanceReward <= 0) {
      throw new BadRequestException(
        `Cannot transfer reward: calculated balance is ${newBalanceReward} (must be > 0)`,
      );
    }

    // 6. Lấy tất cả coins của user
    const userWallets = await this.userWalletRepository.find({
      where: {
        uw_user_id: userId,
      },
    });

    if (userWallets.length === 0) {
      throw new BadRequestException('User has no wallets');
    }

    // 7. Đồng bộ uw_balance_reward với newBalanceReward trước khi transfer
    // Đảm bảo uw_balance_reward trong database khớp với giá trị tính toán
    // Sau đó cộng newBalanceReward vào uw_balance và set uw_balance_reward = 0
    const updatedCoins: number[] = [];
    for (const userWallet of userWallets) {
      const oldBalance = parseFloat(userWallet.uw_balance.toString());
      const currentBalanceReward = parseFloat(
        userWallet.uw_balance_reward?.toString() || '0',
      );

      // Đồng bộ uw_balance_reward với newBalanceReward nếu có sự khác biệt
      // Điều này đảm bảo tính nhất quán giữa giá trị trong database và giá trị tính toán
      if (Math.abs(currentBalanceReward - newBalanceReward) > 0.00000001) {
        // Nếu có sự khác biệt, cập nhật uw_balance_reward = newBalanceReward
        // Điều này đảm bảo số tiền transfer chính xác
        userWallet.uw_balance_reward = newBalanceReward;
      }

      const newBalance = oldBalance + newBalanceReward;

      userWallet.uw_balance = newBalance as any;
      userWallet.uw_balance_reward = 0;

      await this.userWalletRepository.save(userWallet);

      if (userWallet.uw_wallet_coins) {
        updatedCoins.push(userWallet.uw_wallet_coins);
      }
    }

    // 8. Tạo record trong wallet_transfers để ghi nhận việc transfer từ reward sang main
    const walletTransfer = this.walletTransferRepository.create({
      wt_user_id: userId,
      wt_from: WalletTransferFrom.REWARD,
      wt_to: WalletTransferTo.MAIN,
      wt_amount: newBalanceReward,
      wt_status: WalletTransferStatus.SUCCESS,
    });

    await this.walletTransferRepository.save(walletTransfer);

    return {
      message: 'Reward transferred to main balance successfully',
      newBalanceReward,
      updatedCoins,
    };
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

  async withdraw(
    userId: number,
    networkParam: string,
    coinParam: string,
    address: string,
    amount: number,
  ): Promise<any> {
    // Normalize address: trim whitespace để tránh lỗi do người dùng nhập nhầm
    address = address.trim();

    this.logger.debug(
      `[withdraw] start userId=${userId} networkParam=${networkParam} coinParam=${coinParam} ` +
        `to=${address} amount=${amount}`,
    );

    // 0. Kiểm tra user đã xác minh danh tính và status = active
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      select: ['uid', 'uverify', 'ustatus'],
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.uverify) {
      throw new BadRequestException('Identity not verified');
    }

    if (user.ustatus !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        'System is overloaded! Please try again later',
      );
    }

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

      // Với EVM chains (ETH, BNB): so sánh case-insensitive (lowercase)
      // Với Solana: so sánh case-sensitive
      let isMatch = false;

      if (network.net_symbol === 'SOL') {
        // Solana: so sánh case-sensitive
        isMatch = address === normalizedPublicKey;
      } else {
        // EVM (ETH, BNB): so sánh case-insensitive
        isMatch = address.toLowerCase() === normalizedPublicKey.toLowerCase();
      }

      if (isMatch) {
        throw new BadRequestException(
          'Cannot withdraw to your own wallet address',
        );
      }
    }

    // 2. Tìm coin theo coin_id hoặc coin_symbol
    const coinId = parseInt(coinParam, 10);
    let coin: Coin | null = null;

    if (!isNaN(coinId)) {
      coin = await this.coinRepository.findOne({
        where: { coin_id: coinId },
      });
    }

    if (!coin) {
      coin = await this.coinRepository.findOne({
        where: { coin_symbol: coinParam.toUpperCase() },
      });
    }

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
      `[withdraw] coinNetwork active mint/contract=${this.debugShortAddr(coinNetwork.cn_coin_mint, 10, 8)}`,
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

    // 7. Tạo ví sàn với path: m/44'/60'/0'/0'/0'/382' (ETH/BNB) hoặc m/44'/501'/0'/0'/0'/382' (SOL)
    const exchangeWallet = this.getExchangeWallet(mnemonic, network.net_symbol);

    // 7.5. Lấy wallet network của user để lấy uwn_id cho wh_wallet_netword_id
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
      // 9. Gửi transaction từ ví sàn đến address
      // Sử dụng onchainAmount (đã trừ phí nếu không phải free withdraw)
      const txHash = await this.sendTransaction(
        network,
        coin,
        exchangeWallet,
        address,
        onchainAmount, // Rút onchain với số tiền đã trừ phí (nếu có)
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
