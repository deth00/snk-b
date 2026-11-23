import pool from '../config/db.js';

export async function branchMiddleware(req, res, next) {
  if (!req.user) return next();

  const headerBranchId = req.headers['x-branch-id'] ? parseInt(req.headers['x-branch-id'], 10) : null;
  const [rows] = await pool.query('SELECT branch_id FROM users WHERE id = ?', [req.user.id]);
  const user = rows[0];
  const userBranchId = user?.branch_id != null ? parseInt(user.branch_id, 10) : null;

  if (req.user.role === 'admin') {
    req.branchId = headerBranchId;
    return next();
  }

  if (userBranchId != null) {
    if (headerBranchId && headerBranchId !== userBranchId) {
      return res.status(403).json({ error: 'This role can access only its own branch' });
    }
    req.branchId = userBranchId;
    return next();
  }

  req.branchId = null;
  next();
}

export function requireBranch(req, res, next) {
  if (req.branchId == null) {
    return res.status(400).json({ error: 'X-Branch-Id is required' });
  }
  next();
}
