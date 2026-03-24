/* eslint-disable no-console */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

const DEFAULT_SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEFAULT_USDT_MINT = 'Gr5D54dHC8neoFBQQuy8ni6S19E5ygg7Ewr3i1x6RRP5';

function parseArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function upsertCoin(client, { symbol, name, logo = '', website = '' }) {
  const existed = await client.query(
    `SELECT coin_id FROM coins WHERE coin_symbol = $1 LIMIT 1`,
    [symbol],
  );

  if (existed.rows.length > 0) {
    const coinId = existed.rows[0].coin_id;
    await client.query(
      `
      UPDATE coins
      SET coin_name = $1,
          coin_logo = COALESCE(NULLIF($2, ''), coin_logo),
          coin_website = COALESCE(NULLIF($3, ''), coin_website),
          coin_status = 'active'
      WHERE coin_id = $4
      `,
      [name, logo, website, coinId],
    );
    return coinId;
  }

  const inserted = await client.query(
    `
    INSERT INTO coins (coin_name, coin_symbol, coin_logo, coin_website, coin_status)
    VALUES ($1, $2, $3, $4, 'active')
    RETURNING coin_id
    `,
    [name, symbol, logo, website || null],
  );
  return inserted.rows[0].coin_id;
}

async function upsertSolNetwork(client) {
  const existed = await client.query(
    `SELECT net_id FROM networks WHERE net_symbol = 'SOL' LIMIT 1`,
  );

  if (existed.rows.length > 0) {
    const networkId = existed.rows[0].net_id;
    await client.query(
      `
      UPDATE networks
      SET net_status = 'active'
      WHERE net_id = $1
      `,
      [networkId],
    );
    return networkId;
  }

  const inserted = await client.query(
    `
    INSERT INTO networks (net_name, net_symbol, net_logo, net_scan, net_status)
    VALUES ('Solana', 'SOL', '', 'https://solscan.io', 'active')
    RETURNING net_id
    `,
  );
  return inserted.rows[0].net_id;
}

async function upsertCoinNetwork(client, networkId, coinId, mint) {
  const existed = await client.query(
    `
    SELECT cn_id
    FROM coin_networks
    WHERE cn_network_id = $1 AND cn_coin_id = $2
    LIMIT 1
    `,
    [networkId, coinId],
  );

  if (existed.rows.length > 0) {
    await client.query(
      `
      UPDATE coin_networks
      SET cn_coin_mint = $1,
          cn_status = 'active'
      WHERE cn_id = $2
      `,
      [mint, existed.rows[0].cn_id],
    );
    return;
  }

  await client.query(
    `
    INSERT INTO coin_networks (cn_network_id, cn_coin_id, cn_coin_mint, cn_status)
    VALUES ($1, $2, $3, 'active')
    `,
    [networkId, coinId, mint],
  );
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(
      'Usage: node scripts/seed-sol-usdt-mints.js [--usdt-mint=<mint>] [--sol-mint=<mint>]',
    );
    console.log('You can also set env vars: USDT_MINT, SOL_MINT');
    return;
  }

  const usdtMint =
    parseArg('usdt-mint') || process.env.USDT_MINT || DEFAULT_USDT_MINT;
  const solMint =
    parseArg('sol-mint') || process.env.SOL_MINT || DEFAULT_SOL_MINT;

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'my_project',
  });

  await client.connect();
  await client.query('BEGIN');

  try {
    const networkId = await upsertSolNetwork(client);
    const solCoinId = await upsertCoin(client, {
      symbol: 'SOL',
      name: 'Solana',
    });
    const usdtCoinId = await upsertCoin(client, {
      symbol: 'USDT',
      name: 'Tether USD',
    });

    await upsertCoinNetwork(client, networkId, solCoinId, solMint);
    await upsertCoinNetwork(client, networkId, usdtCoinId, usdtMint);

    await client.query('COMMIT');

    console.log('Seed success: SOL + USDT on SOL network');
    console.log(`SOL mint : ${solMint}`);
    console.log(`USDT mint: ${usdtMint}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
