/**
 * Migration: เพิ่มสถานะ 'paying' (กำลังจ่ายเงิน) ให้ตาราง tables
 * รัน: node src/db/migrations/007_table_status_paying.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    ALTER TABLE \`tables\`
    MODIFY COLUMN status ENUM('available','playing','reserved','maintenance','paying') NOT NULL DEFAULT 'available'
  `);
  console.log('Migration 007 (table status paying) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
