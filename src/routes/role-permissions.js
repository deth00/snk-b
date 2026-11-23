import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_ACTION_OPTIONS,
  PERMISSION_ACTIONS,
  PERMISSIONS,
  ROLE_NAMES,
  isKnownPermission,
  isKnownPermissionAction,
  permissionStorageKey,
  splitPermissionStorageKey,
} from '../permissions.js';

const router = Router();
router.use(authMiddleware);

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role ENUM('manager','user') NOT NULL,
      permission_key VARCHAR(80) NOT NULL,
      allowed BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (role, permission_key)
    )
  `);
}

async function getRolePermissions(role) {
  const permissions = {};
  for (const permission of PERMISSIONS) {
    permissions[permission.key] = {};
    for (const action of PERMISSION_ACTIONS) {
      permissions[permission.key][action.key] = Boolean(DEFAULT_ROLE_PERMISSIONS[role]?.[permission.key]?.[action.key]);
    }
  }

  try {
    const [rows] = await pool.query('SELECT permission_key, allowed FROM role_permissions WHERE role = ?', [role]);
    for (const row of rows) {
      const parsed = splitPermissionStorageKey(row.permission_key);
      if (parsed) {
        const allowedActions = PERMISSION_ACTION_OPTIONS[parsed.permissionKey] || ['view'];
        permissions[parsed.permissionKey][parsed.action] = allowedActions.includes(parsed.action) && Boolean(row.allowed);
      } else if (isKnownPermission(row.permission_key)) {
        permissions[row.permission_key].view = Boolean(row.allowed);
      }
    }
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }

  if (role === 'admin') {
    for (const permission of PERMISSIONS) {
      for (const action of PERMISSION_ACTIONS) {
        permissions[permission.key][action.key] = true;
      }
    }
  }

  return permissions;
}

router.get('/', async (req, res) => {
  try {
    await ensureTable();
    const roles = {};
    for (const role of ROLE_NAMES) {
      roles[role] = await getRolePermissions(role);
    }
    res.json({ permissions: PERMISSIONS, actions: PERMISSION_ACTIONS, roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put(
  '/:role',
  requireAdmin,
  body('permissions').isObject(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const role = req.params.role;
    if (role === 'admin') return res.status(400).json({ error: 'Admin always has all permissions' });
    if (!['manager', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const entries = [];
    for (const [permissionKey, actions] of Object.entries(req.body.permissions || {})) {
      if (!isKnownPermission(permissionKey) || typeof actions !== 'object' || actions == null) continue;
      for (const [action, allowed] of Object.entries(actions)) {
        if (isKnownPermissionAction(action)) entries.push([permissionKey, action, allowed]);
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureTable();
      await conn.beginTransaction();
      for (const [key, action, allowed] of entries) {
        await conn.query(
          `INSERT INTO role_permissions (role, permission_key, allowed)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE allowed = VALUES(allowed)`,
          [role, permissionStorageKey(key, action), Boolean(allowed)]
        );
      }
      await conn.commit();
      const roles = {};
      for (const name of ROLE_NAMES) {
        roles[name] = await getRolePermissions(name);
      }
      res.json({ permissions: PERMISSIONS, actions: PERMISSION_ACTIONS, roles });
    } catch (err) {
      await conn.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  }
);

export default router;
