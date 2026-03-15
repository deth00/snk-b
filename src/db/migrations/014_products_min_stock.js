/**
 * Migration: เพิ่ม min_stock ใน products สำหรับแจ้งเตือนสินค้าใกล้หมด
 * รัน: node src/db/migrations/014_products_min_stock.js
 */
import pool from '../../config/db.js';

async function up() {
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'"
  );
  const names = cols.map((c) => c.COLUMN_NAME);
  if (!names.includes('min_stock')) {
    await pool.query(`
      ALTER TABLE products ADD COLUMN min_stock DECIMAL(12,2) NULL DEFAULT 5
      COMMENT 'ค่าต่ำสุด แจ้งเตือนเมื่อสต็อกต่ำกว่านี้' AFTER stock_qty
    `);
  }
  console.log('Migration 014 (products.min_stock) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
