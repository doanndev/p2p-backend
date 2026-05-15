-- Seed: networks (ETH, BSC, SOL, TRX) + coin USDT + coin_networks (USDT trên từng mạng).
-- Địa chỉ contract/mint: MAINNET. Chạy lại an toàn (UPSERT / NOT EXISTS).
-- PostgreSQL; enum cột phải khớp DB TypeORM (thường 'active', 'erc20', 'bep20', 'spl', 'trc20').

BEGIN;

-- ---------------------------------------------------------------------------
-- networks (net_symbol dùng trong code: ETH, BSC, SOL, TRX)
-- ---------------------------------------------------------------------------
INSERT INTO networks (net_name, net_symbol, net_logo, net_scan, net_status)
VALUES
  ('Ethereum', 'ETH', '', 'https://etherscan.io', 'active'),
  ('BNB Smart Chain', 'BSC', '', 'https://bscscan.com', 'active'),
  ('Solana', 'SOL', '', 'https://solscan.io', 'active'),
  ('Tron', 'TRX', '', 'https://tronscan.org', 'active')
ON CONFLICT (net_symbol) DO UPDATE SET
  net_name   = EXCLUDED.net_name,
  net_logo   = EXCLUDED.net_logo,
  net_scan   = EXCLUDED.net_scan,
  net_status = 'active';

-- ---------------------------------------------------------------------------
-- coin: USDT
-- ---------------------------------------------------------------------------
INSERT INTO coins (coin_name, coin_symbol, coin_logo, coin_website, coin_status)
VALUES (
  'Tether USD',
  'USDT',
  '',
  'https://tether.to',
  'active'
)
ON CONFLICT (coin_symbol) DO UPDATE SET
  coin_name    = EXCLUDED.coin_name,
  coin_logo    = EXCLUDED.coin_logo,
  coin_website = EXCLUDED.coin_website,
  coin_status  = 'active';

-- ---------------------------------------------------------------------------
-- coin_networks: USDT trên ETH (ERC20), BSC (BEP20), SOL (SPL), TRX (TRC20)
-- Contract/mint mainnet (Tether / chuẩn cộng đồng)
-- ---------------------------------------------------------------------------
INSERT INTO coin_networks (cn_network_id, cn_coin_id, cn_coin_mint, cn_coin_type, cn_status)
SELECT n.net_id, c.coin_id, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'erc20', 'active'
FROM networks n
JOIN coins c ON c.coin_symbol = 'USDT'
WHERE n.net_symbol = 'ETH'
  AND NOT EXISTS (
    SELECT 1 FROM coin_networks z
    WHERE z.cn_network_id = n.net_id AND z.cn_coin_id = c.coin_id
  );

INSERT INTO coin_networks (cn_network_id, cn_coin_id, cn_coin_mint, cn_coin_type, cn_status)
SELECT n.net_id, c.coin_id, '0x55d398326f99059fF775485246999027B3197955', 'bep20', 'active'
FROM networks n
JOIN coins c ON c.coin_symbol = 'USDT'
WHERE n.net_symbol = 'BSC'
  AND NOT EXISTS (
    SELECT 1 FROM coin_networks z
    WHERE z.cn_network_id = n.net_id AND z.cn_coin_id = c.coin_id
  );

INSERT INTO coin_networks (cn_network_id, cn_coin_id, cn_coin_mint, cn_coin_type, cn_status)
SELECT n.net_id, c.coin_id, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'spl', 'active'
FROM networks n
JOIN coins c ON c.coin_symbol = 'USDT'
WHERE n.net_symbol = 'SOL'
  AND NOT EXISTS (
    SELECT 1 FROM coin_networks z
    WHERE z.cn_network_id = n.net_id AND z.cn_coin_id = c.coin_id
  );

INSERT INTO coin_networks (cn_network_id, cn_coin_id, cn_coin_mint, cn_coin_type, cn_status)
SELECT n.net_id, c.coin_id, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'trc20', 'active'
FROM networks n
JOIN coins c ON c.coin_symbol = 'USDT'
WHERE n.net_symbol = 'TRX'
  AND NOT EXISTS (
    SELECT 1 FROM coin_networks z
    WHERE z.cn_network_id = n.net_id AND z.cn_coin_id = c.coin_id
  );

COMMIT;
