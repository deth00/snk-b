/**
 * Migration: ตาราง transactions สำหรับบันทึกรายรับ-รายจ่าย
 * รัน: node src/db/migrations/018_transactions.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      type ENUM('income','expense') NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      category VARCHAR(100) NULL COMMENT 'เช่น ວັດສຸດ ຄ່າພາກອນ ຄ່າສິນຄ້າ',
      note TEXT NULL,
      branch_id INT UNSIGNED NULL,
      created_by INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_type (type),
      KEY idx_branch (branch_id),
      KEY idx_created (created_at)
    )
  `);
  console.log('Migration 018 (transactions) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
