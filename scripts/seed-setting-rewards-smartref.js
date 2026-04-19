/* eslint-disable no-console */
/**
 * Seed / upsert 7 cấp trong setting_rewards_smartref.
 * Tổng srs_percentage = 100 (có thể chỉnh lại DISTRIBUTION bên dưới).
 *
 * Chạy: node scripts/seed-setting-rewards-smartref.js
 * (cần .env: DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE)
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

/** 7 cấp — phần trăm phải cộng đúng 100 */
const DISTRIBUTION = [
  { level: 1, percentage: 25 },
  { level: 2, percentage: 20 },
  { level: 3, percentage: 16 },
  { level: 4, percentage: 14 },
  { level: 5, percentage: 12 },
  { level: 6, percentage: 8 },
  { level: 7, percentage: 5 },
];

function assertSum100(rows) {
  const sum = rows.reduce((acc, r) => acc + Number(r.percentage), 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(
      `PERCENTAGES must sum to 100, got ${sum}. Fix DISTRIBUTION in this script.`,
    );
  }
}

async function upsertLevel(client, { level, percentage }) {
  await client.query(
    `
    INSERT INTO setting_rewards_smartref (srs_level, srs_percentage, srs_is_active)
    VALUES ($1, $2, true)
    ON CONFLICT (srs_level)
    DO UPDATE SET
      srs_percentage = EXCLUDED.srs_percentage,
      srs_is_active = EXCLUDED.srs_is_active
    `,
    [level, String(percentage)],
  );
}

async function main() {
  assertSum100(DISTRIBUTION);

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
    for (const row of DISTRIBUTION) {
      await upsertLevel(client, row);
      console.log(
        `Level ${row.level}: srs_percentage = ${row.percentage}% (upserted)`,
      );
    }
    await client.query('COMMIT');
    console.log('seed-setting-rewards-smartref: success (total 100%)');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('seed-setting-rewards-smartref failed:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
