/**
 * Migration: สร้างตาราง member_debts และ debt_transactions
 * ใช้เก็บหนี้ลูกค้า (ผูกกับ member หรือเบอร์โทร) และประวัติหนี้/การชำระ
 * รัน: node src/db/migrations/024_member_debts.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_debts (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      member_id INT UNSIGNED NULL,
      phone VARCHAR(50) NULL,
      customer_name VARCHAR(100) NULL,
      branch_id INT UNSIGNED NOT NULL,
      balance DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_member (member_id),
      KEY idx_phone_branch (phone, branch_id),
      KEY idx_branch (branch_id),
      CONSTRAINT fk_member_debts_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      CONSTRAINT fk_member_debts_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS debt_transactions (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      member_debt_id INT UNSIGNED NOT NULL,
      type ENUM('debt','payment') NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      order_id INT UNSIGNED NULL,
      note TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INT UNSIGNED NULL,
      KEY idx_member_debt (member_debt_id),
      KEY idx_order (order_id),
      CONSTRAINT fk_debt_tx_debt FOREIGN KEY (member_debt_id) REFERENCES member_debts(id) ON DELETE CASCADE
    )
  `);
  console.log('Migration 024 (member_debts, debt_transactions) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
