/**
 * Migration: สร้าง user admin คนแรกเมื่อตาราง users ยังว่าง
 * รัน: node src/db/migrations/004_seed_admin_if_empty.js
 */
import bcrypt from 'bcryptjs';
import pool from '../../config/db.js';

async function up() {
  const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM users');
  if (row.n > 0) {
    console.log('Migration 004 skipped: already has users.');
    return;
  }
  const passwordHash = await bcrypt.hash('admin123', 10);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'admin', 'Admin')`,
    ['admin', passwordHash]
  );
  console.log('Migration 004 done. Created admin / admin123');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
