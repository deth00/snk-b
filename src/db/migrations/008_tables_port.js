/**
 * Migration: เพิ่มคอลัมน์ port (default 0) ในตาราง tables
 * รัน: node src/db/migrations/008_tables_port.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    ALTER TABLE \`tables\`
    ADD COLUMN port INT NOT NULL DEFAULT 0
  `);
  console.log('Migration 008 (tables.port) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
