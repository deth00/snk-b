/**
 * Migration: แยก transactions เป็นตาราง incomes และ expenses
 * รัน: node src/db/migrations/019_incomes_expenses_split.js
 */
import pool from '../../config/db.js';

async function up() {
  // สร้างตาราง incomes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incomes (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      amount DECIMAL(12,2) NOT NULL,
      category VARCHAR(100) NULL COMMENT 'เช่น ວັດສຸດ ລາຍຮັບອື່ນ',
      note TEXT NULL,
      branch_id INT UNSIGNED NULL,
      created_by INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_branch (branch_id),
      KEY idx_created (created_at)
    )
  `);

  // สร้างตาราง expenses
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      amount DECIMAL(12,2) NOT NULL,
      category VARCHAR(100) NULL COMMENT 'เช่น ຄ່າພາກອນ ຄ່າສິນຄ້າ',
      note TEXT NULL,
      branch_id INT UNSIGNED NULL,
      created_by INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_branch (branch_id),
      KEY idx_created (created_at)
    )
  `);

  // ย้ายข้อมูลจาก transactions (ถ้ามี)
  const [tables] = await pool.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions'"
  );
  if (tables.length > 0) {
    const [txRows] = await pool.query('SELECT * FROM transactions');
    for (const row of txRows) {
      if (row.type === 'income') {
        await pool.query(
          'INSERT INTO incomes (amount, category, note, branch_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [row.amount, row.category, row.note, row.branch_id, row.created_by, row.created_at]
        );
      } else {
        await pool.query(
          'INSERT INTO expenses (amount, category, note, branch_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [row.amount, row.category, row.note, row.branch_id, row.created_by, row.created_at]
        );
      }
    }
    await pool.query('DROP TABLE IF EXISTS transactions');
  }

  console.log('Migration 019 (incomes + expenses) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
