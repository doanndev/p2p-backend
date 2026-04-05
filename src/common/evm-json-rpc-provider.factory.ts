import { JsonRpcProvider } from 'ethers';

/**
 * Provider RPC EVM: không gắn static mainnet/BSC để Sepolia, BSC testnet, Arbitrum…
 * khớp đúng chainId từ node (đổi RPC/env là đủ, không đổi logic).
 */
export function createEvmJsonRpcProvider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl.trim());
}
