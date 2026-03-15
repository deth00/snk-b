/**
 * Migration: แยก ສິນຄ້າ, ປະເພດ, ໜ່ວຍ, payment_banks, settings ตามสาขา
 * รัน: node src/db/migrations/012_branch_products_units_settings.js
 */
import pool from '../../config/db.js';

async function addBranchId(table, afterCol) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const names = cols.map((c) => c.COLUMN_NAME);
  if (names.includes('branch_id')) return;
  const sql = afterCol
    ? `ALTER TABLE \`${table}\` ADD COLUMN branch_id INT UNSIGNED NULL AFTER \`${afterCol}\``
    : `ALTER TABLE \`${table}\` ADD COLUMN branch_id INT UNSIGNED NULL`;
  await pool.query(sql);
  await pool.query(`ALTER TABLE \`${table}\` ADD KEY idx_branch (branch_id)`);
  try {
    await pool.query(
      `ALTER TABLE \`${table}\` ADD CONSTRAINT fk_${table}_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL`
    );
  } catch (e) {
    if (!e.message?.includes('Duplicate')) console.warn('FK', table, e.message);
  }
}

async function up() {
  await addBranchId('product_categories', 'id');
  await addBranchId('products', 'category_id');
  await addBranchId('units', 'id');
  await addBranchId('payment_banks', 'id');

  // settings: ใช้ key แบบ payment_1, payment_2 ฯลฯ สำหรับแต่ละสาขา (ของเดิม payment = default)
  // ไม่ต้องเปลี่ยน schema — ใช้ key = 'payment' + '_' + branchId หรือ 'payment' สำหรับ default

  // อัปเดตข้อมูลเก่าให้สาขาแรก
  const [firstBranch] = await pool.query('SELECT id FROM branches ORDER BY id LIMIT 1');
  const bid = firstBranch[0]?.id;
  if (bid) {
    await pool.query('UPDATE product_categories SET branch_id = ? WHERE branch_id IS NULL', [bid]);
    await pool.query('UPDATE products SET branch_id = ? WHERE branch_id IS NULL', [bid]);
    await pool.query('UPDATE units SET branch_id = ? WHERE branch_id IS NULL', [bid]);
    await pool.query('UPDATE payment_banks SET branch_id = ? WHERE branch_id IS NULL', [bid]);
  }
  console.log('Migration 012 done. products, categories, units, payment_banks แยกตามสาขา');
}

up().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
