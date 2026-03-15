/**
 * Migration: เพิ่ม minimum_units, rounding_minutes, rounding_mode ใน tables
 * เพื่อให้โต๊ะกำหนดราคา/การปัดเศษได้เอง โดยไม่ใช้ rate
 * รัน: node src/db/migrations/017_tables_pricing.js
 */
import pool from '../../config/db.js';

async function up() {
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tables'"
  );
  const names = cols.map((c) => c.COLUMN_NAME);
  const add = async (col, def, type) => {
    if (!names.includes(col)) {
      await pool.query(`ALTER TABLE \`tables\` ADD COLUMN ${col} ${type} DEFAULT ${def}`);
    }
  };
  await add('minimum_units', '0', 'DECIMAL(8,2)');
  await add('rounding_minutes', '0', 'INT');
  if (!names.includes('rounding_mode')) {
    await pool.query("ALTER TABLE `tables` ADD COLUMN rounding_mode ENUM('ceil','floor','nearest') DEFAULT 'ceil'");
  }
  // sessions.rate_id เป็น nullable (ใช้ price จาก table แทน)
  const [sessCols] = await pool.query(
    "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'rate_id'"
  );
  if (sessCols.length) {
    await pool.query('ALTER TABLE sessions MODIFY COLUMN rate_id INT UNSIGNED NULL');
  }
  console.log('Migration 017 (tables pricing) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
