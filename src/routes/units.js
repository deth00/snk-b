import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireManager } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

// GET /api/units — ต้องส่ง X-Branch-Id, แยกตามสาขา
router.get('/', requireBranch, async (req, res) => {
  try {
    const bid = req.branchId;
    const [rows] = await pool.query(
      'SELECT id, name, symbol, sort_order, created_at, updated_at FROM units WHERE branch_id = ? OR (branch_id IS NULL AND ? IS NULL) ORDER BY sort_order, name',
      [bid, bid]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/units
router.post(
  '/',
  requireManager,
  requireBranch,
  body('name').trim().notEmpty(),
  body('symbol').optional().trim().isLength({ max: 30 }),
  body('sort_order').optional().isInt({ min: 0 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { name, symbol = null, sort_order = 0 } = req.body;
      const branchId = req.branchId;
      await pool.query(
        'INSERT INTO units (name, symbol, sort_order, branch_id) VALUES (?, ?, ?, ?)',
        [name, symbol || name, sort_order, branchId]
      );
      const [rows] = await pool.query('SELECT * FROM units WHERE id = LAST_INSERT_ID()');
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/units/:id
router.patch(
  '/:id',
  requireManager,
  requireBranch,
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('symbol').optional().trim().isLength({ max: 30 }),
  body('sort_order').optional().isInt({ min: 0 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const allowed = ['name', 'symbol', 'sort_order'];
      const updates = [];
      const values = [];
      for (const k of allowed) {
        if (req.body[k] !== undefined) {
          updates.push(`${k} = ?`);
          values.push(req.body[k]);
        }
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(req.params.id, req.branchId, req.branchId);
      await pool.query(`UPDATE units SET ${updates.join(', ')} WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))`, values);
      const [rows] = await pool.query('SELECT * FROM units WHERE id = ?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/units/:id — ลบได้เฉพาะเมื่อไม่มีสินค้าใช้หน่วยนี้
router.delete(
  '/:id',
  requireManager,
  requireBranch,
  param('id').isInt(),
  async (req, res) => {
    try {
      const [unitRows] = await pool.query('SELECT id, name FROM units WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))', [req.params.id, req.branchId, req.branchId]);
      if (!unitRows[0]) return res.status(404).json({ error: 'Unit not found' });
      const unitName = unitRows[0].name;
      const [used] = await pool.query('SELECT COUNT(*) AS n FROM products WHERE unit = ?', [unitName]);
      if (used[0].n > 0) {
        return res.status(400).json({ error: 'ບໍ່ສາມາດລົບໄດ້ ເພາະມີສິນຄ້າໃຊ້ໜ່ວຍນີ້ຢູ່' });
      }
      await pool.query('DELETE FROM units WHERE id = ?', [req.params.id]);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
