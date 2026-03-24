/* eslint-disable no-console */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

const CURRENCIES = [
  // Priority markets
  {
    name: 'Vietnamese Dong',
    symbol: 'VND',
    logo: 'https://flagcdn.com/w40/vn.png',
    status: 'active',
  },
  {
    name: 'South Korean Won',
    symbol: 'KRW',
    logo: 'https://flagcdn.com/w40/kr.png',
    status: 'active',
  },
  // Additional common fiat currencies
  {
    name: 'US Dollar',
    symbol: 'USD',
    logo: 'https://flagcdn.com/w40/us.png',
    status: 'active',
  },
  {
    name: 'Euro',
    symbol: 'EUR',
    logo: 'https://flagcdn.com/w40/eu.png',
    status: 'active',
  },
  {
    name: 'Japanese Yen',
    symbol: 'JPY',
    logo: 'https://flagcdn.com/w40/jp.png',
    status: 'active',
  },
  {
    name: 'Singapore Dollar',
    symbol: 'SGD',
    logo: 'https://flagcdn.com/w40/sg.png',
    status: 'active',
  },
  {
    name: 'Thai Baht',
    symbol: 'THB',
    logo: 'https://flagcdn.com/w40/th.png',
    status: 'active',
  },
];

async function upsertNationalCurrency(client, currency) {
  const existed = await client.query(
    `
    SELECT nc_id
    FROM national_currencys
    WHERE nc_symbol = $1
    LIMIT 1
    `,
    [currency.symbol],
  );

  if (existed.rows.length > 0) {
    const currencyId = existed.rows[0].nc_id;
    await client.query(
      `
      UPDATE national_currencys
      SET nc_name = $1,
          nc_logo = COALESCE(NULLIF($2, ''), nc_logo),
          nc_status = $3
      WHERE nc_id = $4
      `,
      [currency.name, currency.logo, currency.status, currencyId],
    );
    return { id: currencyId, action: 'updated' };
  }

  const inserted = await client.query(
    `
    INSERT INTO national_currencys (nc_name, nc_symbol, nc_logo, nc_status)
    VALUES ($1, $2, $3, $4)
    RETURNING nc_id
    `,
    [currency.name, currency.symbol, currency.logo, currency.status],
  );

  return { id: inserted.rows[0].nc_id, action: 'inserted' };
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
    const results = [];
    for (const currency of CURRENCIES) {
      const result = await upsertNationalCurrency(client, currency);
      results.push({ ...currency, ...result });
    }

    await client.query('COMMIT');

    console.log('Seed success: national currencies');
    for (const r of results) {
      console.log(`- ${r.symbol} (${r.name}) -> ${r.action} [id=${r.id}]`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
