/**
 * Migration: เพิ่ม price_per_unit ใน tables (ใส่ราคาโดยตรงแทนการเลือก rate)
 * รัน: node src/db/migrations/016_tables_price_per_unit.js
 */
import pool from '../../config/db.js';

async function up() {
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tables'"
  );
  const names = cols.map((c) => c.COLUMN_NAME);
  if (!names.includes('price_per_unit')) {
    await pool.query(`
      ALTER TABLE \`tables\` ADD COLUMN price_per_unit DECIMAL(12,2) NULL
      COMMENT 'ລາຄາ/ຊົ່ວໂມງ ກີບ (ຖ້າໃສ່ແທນການເລືອກ rate)' AFTER port
    `);
  }
  console.log('Migration 016 (tables.price_per_unit) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
