/* eslint-disable no-console */
/**
 * Tạo admin đầu tiên (bootstrap) khi DB chưa có tài khoản admin.
 * Mặc định: username admin / password admin (chỉ dùng local/dev).
 *
 * Biến môi trường (tùy chọn):
 *   INIT_ADMIN_USERNAME  (mặc định: admin)
 *   INIT_ADMIN_PASSWORD  (mặc định: admin)
 *   INIT_ADMIN_EMAIL     (mặc định: admin@localhost)
 *
 * Chạy: node scripts/init-first-admin.js
 *   hoặc: yarn seed:first-admin
 *
 * Yêu cầu: bảng admins / admin_roles đã tồn tại (synchronize TypeORM hoặc migration).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require('bcrypt');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

const SALT_ROUNDS = 10;

async function main() {
  const username = (process.env.INIT_ADMIN_USERNAME || 'admin').trim();
  const password = process.env.INIT_ADMIN_PASSWORD || 'admin';
  const email = (process.env.INIT_ADMIN_EMAIL || 'admin@localhost').trim();

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'my_project',
  });

  await client.connect();

  try {
    const existingUser = await client.query(
      `SELECT admin_id FROM admins WHERE admin_username = $1 LIMIT 1`,
      [username],
    );
    if (existingUser.rowCount > 0) {
      console.log(
        `Skip: username "${username}" already exists (admin_id=${existingUser.rows[0].admin_id}).`,
      );
      return;
    }

    const existingEmail = await client.query(
      `SELECT admin_id FROM admins WHERE admin_email = $1 LIMIT 1`,
      [email],
    );
    if (existingEmail.rowCount > 0) {
      console.log(
        `Skip: email "${email}" already in use (admin_id=${existingEmail.rows[0].admin_id}). Set INIT_ADMIN_EMAIL to another value.`,
      );
      return;
    }

    await client.query('BEGIN');

    let roleRs = await client.query(
      `SELECT role_id FROM admin_roles WHERE role_name = $1 LIMIT 1`,
      ['super_admin'],
    );
    if (roleRs.rowCount === 0) {
      await client.query(
        `
        INSERT INTO admin_roles (role_name, role_description, role_status)
        VALUES ($1, $2, $3)
        `,
        [
          'super_admin',
          'Bootstrap role for initial super admin (created by init-first-admin.js)',
          'active',
        ],
      );
      roleRs = await client.query(
        `SELECT role_id FROM admin_roles WHERE role_name = $1 LIMIT 1`,
        ['super_admin'],
      );
    }
    const roleId = roleRs.rows[0].role_id;

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const insertRs = await client.query(
      `
      INSERT INTO admins (
        admin_username,
        admin_email,
        admin_password,
        admin_fullname,
        admin_level,
        admin_role_id,
        admin_status,
        admin_originator,
        admin_two_factor_enabled
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, false)
      RETURNING admin_id, admin_username, admin_email, admin_level
      `,
      [
        username,
        email,
        hashedPassword,
        'Administrator',
        'super_admin',
        roleId,
        'active',
      ],
    );

    await client.query('COMMIT');

    const row = insertRs.rows[0];
    console.log('Bootstrap admin created:');
    console.log(`  admin_id:   ${row.admin_id}`);
    console.log(`  username:   ${row.admin_username}`);
    console.log(`  email:      ${row.admin_email}`);
    console.log(`  level:      ${row.admin_level}`);
    console.log(
      '  password:   (hidden) — default is "admin" unless INIT_ADMIN_PASSWORD is set',
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('init-first-admin failed:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
