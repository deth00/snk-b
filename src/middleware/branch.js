/**
 * Branch context - ใช้ X-Branch-Id header เพื่อระบุสาขาที่ทำงาน
 * Admin: ส่ง X-Branch-Id ได้ทุกสาขา
 * Manager (store_id): เข้าถึงสาขาทั้งหมดที่อยู่ในร้านของตัวเอง
 * User (branch_id): เข้าถึงเฉพาะสาขาของตัวเอง
 */
import pool from '../config/db.js';

export async function branchMiddleware(req, res, next) {
  if (!req.user) return next();
  const headerBranchId = req.headers['x-branch-id'] ? parseInt(req.headers['x-branch-id'], 10) : null;

  let userBranchId = null;
  let userStoreId = null;
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const user = rows[0];
  if (user) {
    userBranchId = user.branch_id != null ? parseInt(user.branch_id, 10) : null;
    userStoreId = user.store_id != null ? parseInt(user.store_id, 10) : null;
  }

  if (req.user.role === 'admin') {
    req.branchId = headerBranchId;
    return next();
  }

  if (req.user.role === 'manager') {
    if (headerBranchId && userStoreId) {
      const [br] = await pool.query('SELECT id, store_id FROM branches WHERE id = ?', [headerBranchId]);
      if (br[0] && Number(br[0].store_id) !== userStoreId) {
        return res.status(403).json({ error: 'สาขานี้ไม่อยู่ในร้านของคุณ' });
      }
    }
    req.branchId = headerBranchId ?? userBranchId;
    return next();
  }

  if (userBranchId) {
    if (headerBranchId && headerBranchId !== userBranchId) {
      return res.status(403).json({ error: 'ไม่สามารถเข้าถึงสาขานี้ได้' });
    }
    req.branchId = headerBranchId || userBranchId;
  } else {
    req.branchId = headerBranchId;
  }
  next();
}

/** endpoints ที่ต้องมี branch context (เช่น ดู/จัดการข้อมูลสาขา) */
export function requireBranch(req, res, next) {
  if (req.branchId == null) {
    return res.status(400).json({ error: 'ต้องส่ง X-Branch-Id ใน header' });
  }
  next();
}
