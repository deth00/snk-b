/**
 * Migration: รองรับหลายสาขา - สร้าง branches + เพิ่ม branch_id
 * รัน: node src/db/migrations/009_branches.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS branches (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      address VARCHAR(255) NULL,
      phone VARCHAR(50) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const addBranchId = async (table, afterCol) => {
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
      const onDelete = table === 'users' ? 'ON DELETE SET NULL' : 'ON DELETE RESTRICT';
      await pool.query(
        `ALTER TABLE \`${table}\` ADD CONSTRAINT fk_${table}_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ${onDelete}`
      );
    } catch (e) {
      if (!e.message?.includes('Duplicate')) console.warn('FK', table, e.message);
    }
  };

  await addBranchId('users', 'display_name');
  await addBranchId('tables', 'id');
  await addBranchId('rates', 'id');
  await addBranchId('shifts', 'id');
  await addBranchId('orders', 'code');

  // สร้างสาขา default และอัปเดตข้อมูลเก่า
  const [br] = await pool.query('SELECT id FROM branches LIMIT 1');
  if (br.length === 0) {
    await pool.query("INSERT INTO branches (code, name) VALUES ('001', 'สาขาหลัก')");
  }
  const [firstBranch] = await pool.query('SELECT id FROM branches ORDER BY id LIMIT 1');
  const branchId = firstBranch[0]?.id;
  if (branchId) {
    await pool.query('UPDATE `tables` SET branch_id = ? WHERE branch_id IS NULL', [branchId]);
    await pool.query('UPDATE rates SET branch_id = ? WHERE branch_id IS NULL', [branchId]);
    await pool.query('UPDATE shifts SET branch_id = ? WHERE branch_id IS NULL', [branchId]);
    await pool.query('UPDATE orders SET branch_id = ? WHERE branch_id IS NULL', [branchId]);
  }
  console.log('Migration 009 (branches) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
