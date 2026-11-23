import pool from '../../config/db.js';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_ACTIONS, PERMISSIONS, permissionStorageKey } from '../../permissions.js';

async function up() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role ENUM('manager','user') NOT NULL,
      permission_key VARCHAR(80) NOT NULL,
      allowed BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (role, permission_key)
    )
  `);

  for (const role of ['manager', 'user']) {
    for (const permission of PERMISSIONS) {
      for (const action of PERMISSION_ACTIONS) {
        await pool.query(
          `INSERT IGNORE INTO role_permissions (role, permission_key, allowed)
           VALUES (?, ?, ?)`,
          [role, permissionStorageKey(permission.key, action.key), Boolean(DEFAULT_ROLE_PERMISSIONS[role]?.[permission.key]?.[action.key])]
        );
      }
    }
  }

  console.log('Migration 028 done. Role permissions table is ready.');
}

up().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
