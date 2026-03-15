/**
 * Migration: ตาราง settings สำหรับเก็บการตั้งค่า (key-value JSON)
 * รัน: node src/db/migrations/005_settings.js
 */
import pool from '../../config/db.js';

const DEFAULT_PAYMENT = {
  methods: [
    { id: 'cash', label: 'ເງິນສົດ', enabled: true, sort_order: 0 },
    { id: 'transfer', label: 'ໂອນ', enabled: true, sort_order: 1 },
    { id: 'qr', label: 'QR', enabled: true, sort_order: 2 },
    { id: 'card', label: 'ບັດ', enabled: true, sort_order: 3 },
    { id: 'mixed', label: 'ປະສົມ', enabled: true, sort_order: 4 },
  ],
  default_method: 'cash',
};

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\` VARCHAR(64) NOT NULL PRIMARY KEY,
      value JSON NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  const [rows] = await pool.query("SELECT 1 FROM settings WHERE `key` = 'payment'");
  if (!rows.length) {
    await pool.query(
      "INSERT INTO settings (`key`, value) VALUES ('payment', ?)",
      [JSON.stringify(DEFAULT_PAYMENT)]
    );
  }
  console.log('Migration 005 (settings) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
