/**
 * Migration: สร้างตาราง members (สมาชิก)
 * รัน: node src/db/migrations/010_members.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(30) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(50) NULL,
      email VARCHAR(100) NULL,
      discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      points INT UNSIGNED NOT NULL DEFAULT 0,
      branch_id INT UNSIGNED NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_branch (branch_id),
      KEY idx_code (code),
      KEY idx_phone (phone),
      CONSTRAINT fk_members_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    )
  `);
  console.log('Migration 010 (members) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
