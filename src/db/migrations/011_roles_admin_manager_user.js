/**
 * Migration: เปลี่ยน role เป็น admin, manager, user
 * - cashier → manager
 * - staff → user
 * รัน: node src/db/migrations/011_roles_admin_manager_user.js
 */
import pool from '../../config/db.js';

async function up() {
  await pool.query(`
    ALTER TABLE users MODIFY role ENUM('admin','cashier','staff','manager','user') NOT NULL DEFAULT 'user'
  `);
  await pool.query(`UPDATE users SET role = 'manager' WHERE role = 'cashier'`);
  await pool.query(`UPDATE users SET role = 'user' WHERE role = 'staff'`);
  await pool.query(`
    ALTER TABLE users MODIFY role ENUM('admin','manager','user') NOT NULL DEFAULT 'user'
  `);
  console.log('Migration 011 done. Roles: admin, manager, user');
}

up().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
