import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, permissionStorageKey } from '../../permissions.js';
import pool from '../../config/db.js';

export default async function migrate() {
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
      await pool.query(
        `INSERT IGNORE INTO role_permissions (role, permission_key, allowed)
         VALUES (?, ?, ?)`,
        [role, permissionStorageKey(permission.key, 'menu'), Boolean(DEFAULT_ROLE_PERMISSIONS[role]?.[permission.key]?.menu)]
      );
    }
  }

  console.log('Migration 030 done. Role permission menu action is ready.');
}
