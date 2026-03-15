/**
 * Migration: สร้างตาราง cash_drawers (ยอดเงินสดคงเหลือ) และ cash_drawer_logs (log ฝาก/ถอน)
 * รัน: node src/db/migrations/026_cash_drawer.js
 */
import pool from '../../config/db.js';

async function up () {
  const [tables] = await pool.query("SHOW TABLES LIKE 'cash_drawers'");
  if (tables.length === 0) {
    await pool.query(`
      CREATE TABLE cash_drawers (
        id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        branch_id INT UNSIGNED NOT NULL,
        balance   DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'ยอดเงินสดคงเหลือ',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_branch (branch_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('Created table cash_drawers');
  }

  const [tables2] = await pool.query("SHOW TABLES LIKE 'cash_drawer_logs'");
  if (tables2.length === 0) {
    await pool.query(`
      CREATE TABLE cash_drawer_logs (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        branch_id  INT UNSIGNED NOT NULL,
        type       ENUM('deposit','withdraw') NOT NULL COMMENT 'ฝากเข้า / ถอนออก',
        amount     DECIMAL(14,2) NOT NULL,
        balance_after DECIMAL(14,2) NOT NULL COMMENT 'ยอดคงเหลือหลังทำรายการ',
        note       VARCHAR(500) NULL,
        created_by INT UNSIGNED NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_branch_date (branch_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('Created table cash_drawer_logs');
  }
}

async function down () {
  await pool.query('DROP TABLE IF EXISTS cash_drawer_logs');
  await pool.query('DROP TABLE IF EXISTS cash_drawers');
  console.log('Dropped cash_drawers + cash_drawer_logs');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
