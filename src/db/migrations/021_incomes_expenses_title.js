/**
 * Migration: เพิ่มคอลัมน์ title (ຫົວຂໍ້) ในตาราง incomes และ expenses
 * รัน: node src/db/migrations/021_incomes_expenses_title.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    ALTER TABLE incomes
    ADD COLUMN title VARCHAR(200) NULL COMMENT 'ຫົວຂໍ້' AFTER amount
  `);

  await pool.query(`
    ALTER TABLE expenses
    ADD COLUMN title VARCHAR(200) NULL COMMENT 'ຫົວຂໍ້' AFTER amount
  `);

  console.log('Migration 021 (title) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
