import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireManager, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

// GET /api/members — รายการสมาชิก (ต้องส่ง X-Branch-Id; cashier ต้องค้นหาได้เมื่อจ่ายเงิน)
router.get('/', requireAll, requireBranch, async (req, res) => {
  try {
    const bid = req.branchId;
    const q = (req.query.q || '').toString().trim();
    let sql = `SELECT m.id, m.code, m.name, m.phone, m.email, m.discount_percent, m.points, m.branch_id, m.is_active, m.created_at
               FROM members m
               WHERE m.is_active = 1 AND (m.branch_id IS NULL OR m.branch_id = ?)`;
    const params = [bid];
    if (q) {
      sql += ` AND (m.code LIKE ? OR m.name LIKE ? OR m.phone LIKE ?)`;
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY m.name';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/members (admin/cashier)
router.post(
  '/',
  requireManager,
  requireBranch,
  body('code').trim().notEmpty(),
  body('name').trim().notEmpty(),
  body('phone').optional().trim(),
  body('email').optional({ checkFalsy: true }).trim().isEmail(),
  body('discount_percent').optional().isFloat({ min: 0, max: 100 }),
  body('branch_id').optional().isInt({ min: 1 }),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { code, name, phone, email, discount_percent = 0, branch_id, is_active = true } = req.body;
      const bid = branch_id != null ? Number(branch_id) : req.branchId;
      await pool.query(
        'INSERT INTO members (code, name, phone, email, discount_percent, branch_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [code.trim(), name.trim(), phone?.trim() || null, email?.trim() || null, Number(discount_percent), bid, is_active]
      );
      const [rows] = await pool.query('SELECT * FROM members WHERE id = LAST_INSERT_ID()');
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'รหัสสมาชิกซ้ำ' });
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/members/:id
router.patch(
  '/:id',
  requireManager,
  requireBranch,
  param('id').isInt(),
  body('code').optional().trim().notEmpty(),
  body('name').optional().trim().notEmpty(),
  body('phone').optional().trim(),
  body('email').optional({ checkFalsy: true }).trim().isEmail(),
  body('discount_percent').optional().isFloat({ min: 0, max: 100 }),
  body('points').optional().isInt({ min: 0 }),
  body('branch_id').optional({ nullable: true }),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const id = Number(req.params.id);
      const [existing] = await pool.query(
        'SELECT id, branch_id FROM members WHERE id = ? AND (branch_id IS NULL OR branch_id = ?)',
        [id, req.branchId]
      );
      if (!existing[0]) return res.status(404).json({ error: 'Member not found' });

      const allowed = ['code', 'name', 'phone', 'email', 'discount_percent', 'points', 'branch_id', 'is_active'];
      const updates = [];
      const values = [];
      for (const k of allowed) {
        if (req.body[k] !== undefined) {
          updates.push(`${k} = ?`);
          if (k === 'branch_id') values.push(req.body[k] === '' || req.body[k] === null ? null : Number(req.body[k]));
          else if (k === 'discount_percent' || k === 'points') values.push(Number(req.body[k]));
          else values.push(req.body[k]);
        }
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(id);
      await pool.query(`UPDATE members SET ${updates.join(', ')} WHERE id = ?`, values);
      const [rows] = await pool.query('SELECT * FROM members WHERE id = ?', [id]);
      res.json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'รหัสสมาชิกซ้ำ' });
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/members/:id
router.get('/:id', requireAll, requireBranch, param('id').isInt(), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM members WHERE id = ? AND (branch_id IS NULL OR branch_id = ?)',
      [req.params.id, req.branchId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Member not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
