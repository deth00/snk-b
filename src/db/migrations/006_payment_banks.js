/**
 * Migration: ตาราง payment_banks สำหรับ QR หลายธนาคาร
 * รัน: node src/db/migrations/006_payment_banks.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_banks (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      qr_image_url VARCHAR(512) NOT NULL,
      account_no VARCHAR(64) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_sort (sort_order)
    )
  `);
  console.log('Migration 006 (payment_banks) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
