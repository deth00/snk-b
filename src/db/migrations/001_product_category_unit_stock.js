/**
 * Migration: เพิ่ม product_categories, products.category_id, products.unit
 * รัน: node src/db/migrations/001_product_category_unit_stock.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_categories (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_sort (sort_order)
    )
  `);
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'"
  );
  const names = cols.map((c) => c.COLUMN_NAME);
  if (!names.includes('category_id')) {
    await pool.query('ALTER TABLE products ADD COLUMN category_id INT UNSIGNED NULL AFTER name');
    await pool.query('ALTER TABLE products ADD KEY idx_category (category_id)');
    try {
      await pool.query('ALTER TABLE products ADD CONSTRAINT products_category_id_fk FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL');
    } catch (e) {
      if (!e.message?.includes('Duplicate')) throw e;
    }
  }
  if (!names.includes('unit')) {
    await pool.query("ALTER TABLE products ADD COLUMN unit VARCHAR(30) NOT NULL DEFAULT 'ชิ้น' AFTER category_id");
  }
  console.log('Migration 001 done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
