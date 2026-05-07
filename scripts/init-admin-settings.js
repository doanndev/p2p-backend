/* eslint-disable no-console */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

const DEFAULT_SETTINGS = [
  { name: 'reward.percent_day', type: 'number', value: '0.2' },
  { name: 'reward.percent_week', type: 'number', value: '2.5' },
  { name: 'reward.percent_month', type: 'number', value: '20' },
  { name: 'ref.smart_ref_level', type: 'number', value: '2' },
  { name: 'withdraw.fund_type', type: 'string', value: 'gain_loss' },
  { name: 'withdraw.fund_amount', type: 'number', value: '0' },
  { name: 'withdraw.turn_free', type: 'number', value: '5' },
  { name: 'difficulty.mode', type: 'string', value: 'default' },
  { name: 'config.zerion_key', type: 'string', value: null },
  { name: 'config.rpc.sol', type: 'string', value: null },
  { name: 'config.rpc.eth', type: 'string', value: null },
  { name: 'config.rpc.bsc', type: 'string', value: null },
  {
    name: 'config.tron.delegate_energy_stake_trx',
    type: 'number',
    value: '30',
  },
  {
    name: 'config.tron.delegate_bandwidth_stake_trx',
    type: 'number',
    value: '0',
  },
  { name: 'config.rpc.rate_limit', type: 'number', value: '50' },
  { name: 'transaction.time_lock_balance', type: 'number', value: null },
  {
    name: 'transaction.fee_percent',
    type: 'number',
    value: process.env.FEE_PERCENT || '0',
  },
  { name: 'smartref.fee', type: 'number', value: '0.5' },
  {
    name: 'wallet.sweep.ceo_wallet_percent',
    type: 'number',
    value: '70',
  },
];

async function hasColumn(client, columnName) {
  const rs = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_settings'
      AND column_name = $1
    LIMIT 1
    `,
    [columnName],
  );
  return rs.rowCount > 0;
}

async function readLegacyRow(client) {
  const hasLegacy = await hasColumn(client, 'as_turn_watch_default');
  if (!hasLegacy) return null;
  const rs = await client.query(
    `
    SELECT *
    FROM admin_settings
    ORDER BY as_id ASC
    LIMIT 1
    `,
  );
  return rs.rows[0] || null;
}

async function ensureFlexibleSchema(client) {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_settings_setting_type_enum') THEN
        CREATE TYPE admin_settings_setting_type_enum AS ENUM ('string', 'number', 'boolean', 'json');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_settings_status_enum') THEN
        CREATE TYPE admin_settings_status_enum AS ENUM ('active', 'inactive');
      END IF;
    END
    $$;
  `);

  await client.query(`
    ALTER TABLE admin_settings
    ADD COLUMN IF NOT EXISTS setting_name varchar,
    ADD COLUMN IF NOT EXISTS setting_type admin_settings_setting_type_enum DEFAULT 'string',
    ADD COLUMN IF NOT EXISTS setting_value text,
    ADD COLUMN IF NOT EXISTS status admin_settings_status_enum DEFAULT 'active';
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_admin_settings_setting_name'
      ) THEN
        ALTER TABLE admin_settings
        ADD CONSTRAINT uq_admin_settings_setting_name UNIQUE (setting_name);
      END IF;
    END
    $$;
  `);
}

function mergeFromLegacy(defaults, legacy) {
  if (!legacy) return defaults;
  const map = new Map(defaults.map((d) => [d.name, { ...d }]));

  const setIfPresent = (name, raw) => {
    if (raw === undefined || raw === null) return;
    map.get(name).value = String(raw);
  };

  setIfPresent('video.turn_watch_default', legacy.as_turn_watch_default);
  setIfPresent('video.devices_default', legacy.as_devices_default);
  setIfPresent('video.time_gap', legacy.as_time_gap);
  setIfPresent('reward.percent_day', legacy.as_percent_day);
  setIfPresent('reward.percent_week', legacy.as_percent_week);
  setIfPresent('reward.percent_month', legacy.as_percent_month);
  setIfPresent('ref.smart_ref_level', legacy.as_smart_ref_level);
  setIfPresent('withdraw.fund_type', legacy.as_fund_type);
  setIfPresent('withdraw.fund_amount', legacy.as_fund_amount);
  setIfPresent('withdraw.turn_free', legacy.as_turn_withdraw_free);
  setIfPresent('difficulty.mode', legacy.as_difficulty);
  setIfPresent('config.zerion_key', legacy.as_config_zerion_key);
  setIfPresent('config.rpc.sol', legacy.as_config_rps_sol);
  setIfPresent('config.rpc.eth', legacy.as_config_rps_eth);
  setIfPresent('config.rpc.bsc', legacy.as_config_rps_bnb);
  setIfPresent('config.rpc.rate_limit', legacy.as_config_rps_rate_limit);
  setIfPresent(
    'transaction.time_lock_balance',
    legacy.as_time_lock_transaction_balance,
  );
  setIfPresent('transaction.fee_percent', legacy.as_transaction_fee);
  setIfPresent('transaction.fee', legacy.as_transaction_fee);

  return Array.from(map.values());
}

async function upsertSetting(client, row) {
  await client.query(
    `
    INSERT INTO admin_settings (setting_name, setting_type, setting_value, status)
    VALUES ($1, $2, $3, 'active')
    ON CONFLICT (setting_name)
    DO UPDATE SET
      setting_type = EXCLUDED.setting_type,
      setting_value = EXCLUDED.setting_value,
      status = 'active'
    `,
    [row.name, row.type, row.value],
  );
}

async function main() {
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
    await ensureFlexibleSchema(client);
    const legacyRow = await readLegacyRow(client);
    const rows = mergeFromLegacy(DEFAULT_SETTINGS, legacyRow);

    for (const row of rows) {
      await upsertSetting(client, row);
    }

    await client.query('COMMIT');
    console.log('Init admin settings success');
    rows.forEach((r) => {
      console.log(`- ${r.name} [${r.type}] = ${r.value ?? 'null'}`);
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Init admin settings failed:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
