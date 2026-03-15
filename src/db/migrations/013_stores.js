/**
 * Migration: เพิ่ม Store (ร้าน) — ชื่อร้าน, logo, ข้อมูลร้าน
 * Branches ผูกกับ Store, Admin ร้านสามารถดูข้อมูลทุกสาขาได้
 * รัน: node src/db/migrations/013_stores.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      logo VARCHAR(500) NULL,
      address VARCHAR(255) NULL,
      phone VARCHAR(50) NULL,
      tax_id VARCHAR(50) NULL,
      email VARCHAR(100) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // branches.store_id
  const [brCols] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branches'"
  );
  const brNames = brCols.map((c) => c.COLUMN_NAME);
  if (!brNames.includes('store_id')) {
    await pool.query('ALTER TABLE branches ADD COLUMN store_id INT UNSIGNED NULL AFTER id');
    await pool.query('ALTER TABLE branches ADD KEY idx_store (store_id)');
    try {
      await pool.query(
        'ALTER TABLE branches ADD CONSTRAINT fk_branches_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL'
      );
    } catch (e) {
      if (!e.message?.includes('Duplicate')) console.warn('FK branches', e.message);
    }
  }

  // users.store_id (admin/manager ร้าน)
  const [uCols] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
  );
  const uNames = uCols.map((c) => c.COLUMN_NAME);
  if (!uNames.includes('store_id')) {
    const afterCol = uNames.includes('branch_id') ? 'branch_id' : 'display_name';
    await pool.query(`ALTER TABLE users ADD COLUMN store_id INT UNSIGNED NULL AFTER ${afterCol}`);
    await pool.query('ALTER TABLE users ADD KEY idx_store (store_id)');
    try {
      await pool.query(
        'ALTER TABLE users ADD CONSTRAINT fk_users_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL'
      );
    } catch (e) {
      if (!e.message?.includes('Duplicate')) console.warn('FK users store', e.message);
    }
  }

  // สร้าง store เริ่มต้นและผูก branches
  const [st] = await pool.query('SELECT id FROM stores LIMIT 1');
  if (st.length === 0) {
    await pool.query("INSERT INTO stores (name, is_active) VALUES ('ร้านหลัก', 1)");
  }
  const [firstStore] = await pool.query('SELECT id FROM stores ORDER BY id LIMIT 1');
  const storeId = firstStore[0]?.id;
  if (storeId) {
    await pool.query('UPDATE branches SET store_id = ? WHERE store_id IS NULL', [storeId]);
  }
  console.log('Migration 013 (stores) done.');
}

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
