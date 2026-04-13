/* eslint-disable no-console */
/**
 * In ra public key (địa chỉ / pubkey) và private key của ví main (path 382) và ví fee (path 369),
 * cùng logic với AdminsWalletOpsService (WALLET_SEED trong .env).
 * EVM: một bộ key cho cả ETH và BSC (m/44'/60'/...).
 *
 * ⚠️ Chỉ chạy trên máy tin cậy; không log output, không commit .env. Private key = toàn quyền ví.
 *
 * Chạy từ thư mục gốc project:
 *   node scripts/export-fee-main-wallet-keys.js
 *   yarn export:wallet-keys
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bip39 = require('bip39');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bip32 = require('bip32');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tinysecp = require('tiny-secp256k1');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { derivePath } = require('ed25519-hd-key');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Keypair } = require('@solana/web3.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Wallet } = require('ethers');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TronWeb } = require('tronweb');

const PATHS = {
  evm: {
    main: `m/44'/60'/0'/0'/0'/382'`,
    fee: `m/44'/60'/0'/0'/0'/369'`,
  },
  sol: {
    main: `m/44'/501'/0'/0'/0'/382'`,
    fee: `m/44'/501'/0'/0'/0'/369'`,
  },
  trx: {
    main: `m/44'/195'/0'/0'/0'/382'`,
    fee: `m/44'/195'/0'/0'/0'/369'`,
  },
};

function deriveEvmAtPath(mnemonic, path) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.BIP32Factory(tinysecp).fromSeed(seed);
  const node = root.derivePath(path);
  if (!node.privateKey) {
    throw new Error(`EVM derive failed at ${path}`);
  }
  const privateKey = `0x${Buffer.from(node.privateKey).toString('hex')}`;
  const wallet = new Wallet(privateKey);
  return {
    path,
    public_key: wallet.address,
    private_key: privateKey,
  };
}

function deriveSolAtPath(mnemonic, path) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const { key } = derivePath(path, seed.toString('hex'));
  const keypair = Keypair.fromSeed(key);
  return {
    path,
    public_key: keypair.publicKey.toBase58(),
    /** 64-byte secret (Solana JSON keypair format = JSON.stringify(Array.from(secretKey))) */
    private_key_hex: Buffer.from(keypair.secretKey).toString('hex'),
    private_key_json_array: `[${Array.from(keypair.secretKey).join(',')}]`,
  };
}

function deriveTronAtPath(mnemonic, path) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.BIP32Factory(tinysecp).fromSeed(seed);
  const node = root.derivePath(path);
  if (!node.privateKey) {
    throw new Error(`Tron derive failed at ${path}`);
  }
  const privateKeyHex = Buffer.from(node.privateKey).toString('hex');
  const address = TronWeb.address.fromPrivateKey(privateKeyHex);
  if (!address || typeof address !== 'string') {
    throw new Error(`Tron address from key failed at ${path}`);
  }
  return {
    path,
    public_key: address,
    private_key: privateKeyHex,
  };
}

function main() {
  const mnemonic = (process.env.WALLET_SEED || '').trim();
  if (!mnemonic) {
    console.error('Thiếu WALLET_SEED trong .env (hoặc môi trường).');
    process.exit(1);
  }
  if (!bip39.validateMnemonic(mnemonic)) {
    console.error('WALLET_SEED không phải mnemonic BIP39 hợp lệ.');
    process.exit(1);
  }

  const evmMain = deriveEvmAtPath(mnemonic, PATHS.evm.main);
  const evmFee = deriveEvmAtPath(mnemonic, PATHS.evm.fee);

  const out = {
    note:
      'EVM (ETH + BSC): public_key = địa chỉ 0x — một ví dùng cho cả hai mạng. TRX: địa chỉ base58. SOL: pubkey base58; private_key_hex = secret 64 byte (128 hex).',
    evm: {
      note:
        'BSC không có path riêng: cùng BIP44 coin type 60 với Ethereum (giống AdminsWalletOpsService). Địa chỉ và private key trên BSC = ETH.',
      bip44_coin_type: 60,
      networks: ['ETH', 'BSC'],
      main_wallet_path_382: evmMain,
      fee_wallet_path_369: evmFee,
    },
    sol: {
      main_wallet_path_382: deriveSolAtPath(mnemonic, PATHS.sol.main),
      fee_wallet_path_369: deriveSolAtPath(mnemonic, PATHS.sol.fee),
    },
    trx: {
      main_wallet_path_382: deriveTronAtPath(mnemonic, PATHS.trx.main),
      fee_wallet_path_369: deriveTronAtPath(mnemonic, PATHS.trx.fee),
    },
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
