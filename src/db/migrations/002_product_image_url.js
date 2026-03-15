/**
 * Migration: เพิ่ม products.image_url
 * รัน: node src/db/migrations/002_product_image_url.js
 */
import pool from '../../config/db.js';

async function up() {
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'"
  );
  const names = cols.map((c) => c.COLUMN_NAME);
  if (!names.includes('image_url')) {
    await pool.query('ALTER TABLE products ADD COLUMN image_url VARCHAR(500) NULL AFTER name');
  }
  console.log('Migration 002 done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
