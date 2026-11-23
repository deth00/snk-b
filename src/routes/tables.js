import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requirePermission } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();

// GET /api/tables/public — list โต๊ะ + สถานะ แบบ public (ไม่ต้อง login)
// Query: ?branch_id=1 (จำเป็น เพื่อระบุสาขา)
router.get('/public', async (req, res) => {
  try {
    const branchId = req.query.branch_id ? parseInt(req.query.branch_id, 10) : null;
    if (!branchId) return res.status(400).json({ error: 'ต้องส่ง branch_id ใน query (?branch_id=1)' });
    const [rows] = await pool.query(`
      SELECT t.id, t.code, t.name, t.port, t.price_per_unit, t.status, t.active_session_id,
             s.id AS session_id, s.status AS session_status, s.started_at
      FROM \`tables\` t
      LEFT JOIN sessions s ON s.id = t.active_session_id AND s.status IN ('running','paused')
      WHERE t.branch_id = ?
      ORDER BY t.code
    `, [branchId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use(authMiddleware);
router.use(branchMiddleware);

// GET /api/tables (พร้อม status + session summary) — ต้องส่ง X-Branch-Id
router.get('/', requirePermission('tables', 'view'), requireBranch, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.id, t.code, t.name, t.port, t.price_per_unit, t.branch_id, t.status, t.active_session_id, t.created_at, t.updated_at,
             s.id AS session_id, s.status AS session_status, s.started_at,
             (SELECT o.id FROM sessions s2
              JOIN orders o ON o.id = s2.order_id AND o.status = 'open'
              WHERE s2.table_id = t.id AND s2.status = 'ended'
              ORDER BY s2.ended_at DESC LIMIT 1) AS open_order_id
      FROM \`tables\` t
      LEFT JOIN sessions s ON s.id = t.active_session_id AND s.status IN ('running','paused')
      WHERE (t.branch_id = ? OR (t.branch_id IS NULL AND ? IS NULL))
      ORDER BY t.code
    `, [req.branchId, req.branchId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tables (admin)
router.post(
  '/',
  requirePermission('tables', 'create'),
  requireBranch,
  body('code').trim().notEmpty(),
  body('name').optional().trim(),
  body('port').optional().isInt({ min: 0, max: 65535 }),
  body('price_per_unit').optional({ nullable: true }).isFloat({ min: 0 }),
  body('branch_id').optional().isInt({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const port = req.body.port != null ? Number(req.body.port) : 0;
      const branchId = req.body.branch_id != null ? Number(req.body.branch_id) : req.branchId;
      const pricePerUnit = req.body.price_per_unit != null ? Number(req.body.price_per_unit) : null;
      const [r] = await pool.query(
        'INSERT INTO `tables` (code, name, port, price_per_unit, branch_id) VALUES (?, ?, ?, ?, ?)',
        [req.body.code, req.body.name || req.body.code, port, pricePerUnit, branchId]
      );
      const [rows] = await pool.query('SELECT * FROM `tables` WHERE id = ?', [r.insertId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Code already exists' });
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/tables/:id
router.patch(
  '/:id',
  requirePermission('tables', 'edit'),
  requireBranch,
  param('id').isInt(),
  body('code').optional().trim().notEmpty(),
  body('name').optional().trim(),
  body('port').optional().isInt({ min: 0, max: 65535 }),
  body('price_per_unit').optional({ nullable: true }),
  body('status').optional().isIn(['available', 'playing', 'reserved', 'maintenance', 'paying']),
  body('branch_id').optional().isInt({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const updates = [];
      const values = [];
      if (req.body.code !== undefined) { updates.push('code = ?'); values.push(req.body.code); }
      if (req.body.name !== undefined) { updates.push('name = ?'); values.push(req.body.name); }
      if (req.body.port !== undefined) { updates.push('port = ?'); values.push(Number(req.body.port)); }
      if (req.body.price_per_unit !== undefined) { updates.push('price_per_unit = ?'); values.push(req.body.price_per_unit != null ? Number(req.body.price_per_unit) : null); }
      if (req.body.status !== undefined) { updates.push('status = ?'); values.push(req.body.status); }
      if (req.body.branch_id !== undefined) { updates.push('branch_id = ?'); values.push(Number(req.body.branch_id)); }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(req.params.id);
      await pool.query(`UPDATE \`tables\` SET ${updates.join(', ')} WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))`, [...values, req.branchId, req.branchId]);
      const [rows] = await pool.query('SELECT * FROM `tables` WHERE id = ?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Table not found' });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Code already exists' });
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
