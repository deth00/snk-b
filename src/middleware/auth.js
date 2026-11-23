import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_ACTION_OPTIONS, apiPermissionAction, apiPermissionKey, permissionStorageKey } from '../permissions.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export async function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [payload.id]);
  const user = rows[0];
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'User not found or inactive' });
  }
  req.user = user;
  next();
}

export function requireRoles(...roles) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'admin') return next();

    const permissionKey = apiPermissionKey(req);
    if (permissionKey) {
      try {
        const allowed = await hasPermission(req.user.role, permissionKey, apiPermissionAction(req));
        if (allowed) return next();
        return res.status(403).json({ error: 'Forbidden' });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

export async function hasPermission(role, permissionKey, action = 'view') {
  if (role === 'admin') return true;
  if (!(PERMISSION_ACTION_OPTIONS[permissionKey] || ['view']).includes(action)) return false;
  try {
    const [rows] = await pool.query(
      'SELECT allowed FROM role_permissions WHERE role = ? AND permission_key = ?',
      [role, permissionStorageKey(permissionKey, action)]
    );
    if (rows[0]) return Boolean(rows[0].allowed);

    if (action === 'view') {
      const [legacyRows] = await pool.query(
        'SELECT allowed FROM role_permissions WHERE role = ? AND permission_key = ?',
        [role, permissionKey]
      );
      if (legacyRows[0]) return Boolean(legacyRows[0].allowed);
    }
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
  return Boolean(DEFAULT_ROLE_PERMISSIONS[role]?.[permissionKey]?.[action]);
}

export function requirePermission(permissionKey, action = 'view') {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      if (await hasPermission(req.user.role, permissionKey, action)) return next();
      return res.status(403).json({ error: 'Forbidden' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

export const requireAdmin = requireRoles('admin');
export const requireManager = requireRoles('admin', 'manager');
export const requireAll = requireRoles('admin', 'manager', 'user');
