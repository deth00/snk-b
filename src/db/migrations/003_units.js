/**
 * Migration: สร้างตาราง units สำหรับໜ່ວຍສິນຄ້າ
 * รัน: node src/db/migrations/003_units.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS units (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      symbol VARCHAR(30) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_sort (sort_order)
    )
  `);
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM units');
  if (rows[0].n === 0) {
    await pool.query(`
      INSERT INTO units (name, symbol, sort_order) VALUES
      ('ຊີ້ນ', 'ຊີ້ນ', 0),
      ('ຂວດ', 'ຂວດ', 1),
      ('ກະປ໋ອງ', 'ກະປ໋ອງ', 2),
      ('ແພັກ', 'ແພັກ', 3),
      ('ຈານ', 'ຈານ', 4),
      ('ອື່ນໆ', 'ອື່ນໆ', 5)
    `);
  }
  console.log('Migration 003 (units) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
