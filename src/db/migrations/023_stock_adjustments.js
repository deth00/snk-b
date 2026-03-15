/**
 * Migration: stock_adjustments — ຄຳຂໍປັບສະຕ໋ອກ (user ສົ່ງ, admin ອະນຸມັດ)
 * รัน: node src/db/migrations/023_stock_adjustments.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      product_id INT UNSIGNED NOT NULL,
      branch_id INT UNSIGNED NULL,
      old_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
      new_qty DECIMAL(12,2) NOT NULL,
      min_stock DECIMAL(12,2) NULL,
      note TEXT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      requested_by INT UNSIGNED NOT NULL,
      requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_by INT UNSIGNED NULL,
      approved_at DATETIME NULL,
      KEY idx_branch (branch_id),
      KEY idx_status (status),
      KEY idx_product (product_id),
      KEY idx_requested (requested_at)
    )
  `);
  console.log('Migration 023 (stock_adjustments) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
