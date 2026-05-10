/** Min coin amount per transaction when orderbook has no `national_min` configured (DB `ob_national_min`). */
export const DEFAULT_ORDERBOOK_PER_TRANSACTION_AMOUNT_MIN = 10;

/**
 * SELL listing: sau `confirm_received`, coin của buyer nằm trong `uw_lock_balance` cho đến khi
 * `P2pCoinUnlockSchedulerService` chuyển sang `uw_balance`.
 */
export const P2P_SELL_LISTING_BUYER_COIN_UNLOCK_DELAY_MS = 10 * 60 * 1000;
