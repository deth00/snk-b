/**
 * Migration: เพิ่มคอลัมน์ status (รออนุมัติ/อนุมัติแล้ว) ในตาราง incomes และ expenses
 * รัน: node src/db/migrations/022_incomes_expenses_status.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    ALTER TABLE incomes
    ADD COLUMN status ENUM('pending','approved') NOT NULL DEFAULT 'pending' COMMENT 'รออนุมัติ/อนุมัติแล้ว' AFTER invoice_id
  `);

  await pool.query(`
    ALTER TABLE expenses
    ADD COLUMN status ENUM('pending','approved') NOT NULL DEFAULT 'pending' COMMENT 'รออนุมัติ/อนุมัติแล้ว' AFTER invoice_id
  `);

  console.log('Migration 022 (status) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
