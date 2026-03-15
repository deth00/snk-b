/**
 * Migration: เพิ่ม unit_cost ใน order_items เก็บต้นทุนต่อหน่วย ณ เวลาขาย
 * รัน: node src/db/migrations/025_order_items_unit_cost.js
 */
import pool from '../../config/db.js';

async function up() {
  const [cols] = await pool.query("SHOW COLUMNS FROM order_items LIKE 'unit_cost'");
  if (cols.length === 0) {
    await pool.query(`
      ALTER TABLE order_items
      ADD COLUMN unit_cost DECIMAL(12,2) NULL DEFAULT 0
      COMMENT 'ต้นทุนต่อหน่วย ณ เวลาขาย (product เท่านั้น, table_time = 0)'
      AFTER amount
    `);
    console.log('Added order_items.unit_cost');
  }
}

async function down() {
  await pool.query('ALTER TABLE order_items DROP COLUMN IF EXISTS unit_cost');
  console.log('Dropped order_items.unit_cost');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
