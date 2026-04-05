export interface OnchainTransaction {
  hash: string;
  amount: number;
  timestamp: Date;
  from?: string;
  to: string;
}
