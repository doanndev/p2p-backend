/**
 * Ngữ cảnh tài sản nạp trên chain: native (SOL/ETH/...) hoặc token (mint/contract).
 * networkSymbol: ký hiệu mạng (SOL, ETH, BSC, …) — bắt buộc cho router đa chuỗi (EVM dùng để RPC + explorer).
 */
export type ChainDepositAssetContext =
  | { mode: 'native'; networkSymbol: string }
  | { mode: 'fungible'; mintOrContract: string; networkSymbol: string };
