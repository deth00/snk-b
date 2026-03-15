/**
 * Migration: เพิ่ม default_rate_id ใน tables สำหรับเลือกลาคา/อัตราคิดเงินเริ่มต้นของโต๊ะ
 * รัน: node src/db/migrations/015_tables_default_rate.js
 */
import pool from '../../config/db.js';

async function up() {
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tables'"
  );
  const names = cols.map((c) => c.COLUMN_NAME);
  if (!names.includes('default_rate_id')) {
    await pool.query(`
      ALTER TABLE \`tables\` ADD COLUMN default_rate_id INT UNSIGNED NULL
      COMMENT 'อัตราคิดเงินเริ่มต้น (เรท)' AFTER port
    `);
    await pool.query(`ALTER TABLE \`tables\` ADD KEY idx_default_rate (default_rate_id)`);
    try {
      await pool.query(
        'ALTER TABLE `tables` ADD CONSTRAINT fk_tables_default_rate FOREIGN KEY (default_rate_id) REFERENCES rates(id) ON DELETE SET NULL'
      );
    } catch (e) {
      if (!e.message?.includes('Duplicate')) console.warn('FK tables default_rate', e.message);
    }
  }
  console.log('Migration 015 (tables.default_rate_id) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
