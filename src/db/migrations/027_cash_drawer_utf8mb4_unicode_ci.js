/**
 * Migration: เปลี่ยน collation ของ cash_drawers และ cash_drawer_logs เป็น utf8mb4_unicode_ci
 * รัน: node src/db/migrations/027_cash_drawer_utf8mb4_unicode_ci.js
 */
import pool from '../../config/db.js';

async function up() {
  const [t1] = await pool.query("SHOW TABLES LIKE 'cash_drawers'");
  if (t1.length > 0) {
    await pool.query('ALTER TABLE cash_drawers CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    console.log('Altered cash_drawers to utf8mb4_unicode_ci');
  }
  const [t2] = await pool.query("SHOW TABLES LIKE 'cash_drawer_logs'");
  if (t2.length > 0) {
    await pool.query('ALTER TABLE cash_drawer_logs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    console.log('Altered cash_drawer_logs to utf8mb4_unicode_ci');
  }
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
