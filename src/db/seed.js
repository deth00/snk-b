import bcrypt from 'bcryptjs';
import pool from '../config/db.js';

async function seed() {
  const passwordHash = await bcrypt.hash('admin123', 10);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'admin', 'Admin')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    ['admin', passwordHash]
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'cashier', 'Cashier')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    ['cashier', await bcrypt.hash('cashier123', 10)]
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'staff', 'Staff')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    ['staff', await bcrypt.hash('staff123', 10)]
  );

  const tables = [
    { code: 'T01', name: 'โต๊ะ 1' },
    { code: 'T02', name: 'โต๊ะ 2' },
    { code: 'T03', name: 'โต๊ะ 3' },
  ];
  for (const t of tables) {
    await pool.query(
      'INSERT INTO `tables` (code, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
      [t.code, t.name]
    );
  }

  const [rateCount] = await pool.query('SELECT COUNT(*) AS c FROM rates');
  if (rateCount[0].c === 0) {
    await pool.query(
      `INSERT INTO rates (name, unit, price_per_unit, minimum_units, rounding_minutes, rounding_mode, is_active)
       VALUES ('Day', 'hour', 80, 1, 10, 'ceil', 1), ('Night', 'hour', 120, 1, 10, 'ceil', 1)`
    );
  }

  const [catCount] = await pool.query('SELECT COUNT(*) AS c FROM product_categories');
  if (catCount[0].c === 0) {
    await pool.query(
      `INSERT INTO product_categories (name, sort_order, is_active) VALUES
       ('เครื่องดื่ม', 0, 1),
       ('ขนม/ของว่าง', 1, 1)`
    );
  }

  const [productCount] = await pool.query('SELECT COUNT(*) AS c FROM products');
  if (productCount[0].c === 0) {
    const [cats] = await pool.query('SELECT id FROM product_categories ORDER BY sort_order');
    const drinkId = cats[0]?.id ?? null;
    const snackId = cats[1]?.id ?? null;
    await pool.query(
      `INSERT INTO products (sku, name, category_id, unit, price, stock_qty, is_active) VALUES
       ('DRINK-01', 'น้ำเปล่า', ?, 'ขวด', 10, 100, 1),
       ('DRINK-02', 'น้ำอัดลม', ?, 'ขวด', 20, 50, 1),
       ('SNACK-01', 'ขนมขบเคี้ยว', ?, 'ถุง', 25, 30, 1)`,
      [drinkId, drinkId, snackId]
    );
  }

  console.log('Seed done. Users: admin/admin123, cashier/cashier123, staff/staff123');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
