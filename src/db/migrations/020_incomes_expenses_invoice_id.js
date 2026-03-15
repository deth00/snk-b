/**
 * Migration: เพิ่มคอลัมน์ invoice_id (ID ใบบิน) ในตาราง incomes และ expenses
 * รัน: node src/db/migrations/020_incomes_expenses_invoice_id.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    ALTER TABLE incomes
    ADD COLUMN invoice_id VARCHAR(50) NULL COMMENT 'ID ใบบิน/ใบกำกับ' AFTER note
  `);

  await pool.query(`
    ALTER TABLE expenses
    ADD COLUMN invoice_id VARCHAR(50) NULL COMMENT 'ID ใบบิน/ใบกำกับ' AFTER note
  `);

  console.log('Migration 020 (invoice_id) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
