import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireManager } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

// GET /api/rates — ต้องส่ง X-Branch-Id
router.get('/', requireBranch, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM rates WHERE branch_id = ? OR (branch_id IS NULL AND ? IS NULL) ORDER BY name',
      [req.branchId, req.branchId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rates
router.post(
  '/',
  requireManager,
  requireBranch,
  body('name').trim().notEmpty(),
  body('price_per_unit').isFloat({ min: 0 }),
  body('minimum_units').optional().isFloat({ min: 0 }),
  body('rounding_minutes').optional().isInt({ min: 0 }),
  body('rounding_mode').optional().isIn(['ceil', 'floor', 'nearest']),
  body('start_time').optional(),
  body('end_time').optional(),
  body('is_active').optional().isBoolean(),
  body('branch_id').optional().isInt({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const {
        name, price_per_unit, minimum_units = 0, rounding_minutes = 0,
        rounding_mode = 'ceil', start_time, end_time, is_active = true, branch_id,
      } = req.body;
      const bid = branch_id != null ? Number(branch_id) : req.branchId;
      await pool.query(
        `INSERT INTO rates (name, unit, price_per_unit, minimum_units, rounding_minutes, rounding_mode, start_time, end_time, is_active, branch_id)
         VALUES (?, 'hour', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, price_per_unit, minimum_units, rounding_minutes, rounding_mode, start_time || null, end_time || null, is_active, bid]
      );
      const [rows] = await pool.query('SELECT * FROM rates WHERE id = LAST_INSERT_ID()');
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/rates/:id
router.patch(
  '/:id',
  requireManager,
  requireBranch,
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('price_per_unit').optional().isFloat({ min: 0 }),
  body('minimum_units').optional().isFloat({ min: 0 }),
  body('rounding_minutes').optional().isInt({ min: 0 }),
  body('rounding_mode').optional().isIn(['ceil', 'floor', 'nearest']),
  body('start_time').optional(),
  body('end_time').optional(),
  body('is_active').optional().isBoolean(),
  body('branch_id').optional().isInt({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const allowed = ['name', 'price_per_unit', 'minimum_units', 'rounding_minutes', 'rounding_mode', 'start_time', 'end_time', 'is_active', 'branch_id'];
      const updates = [];
      const values = [];
      for (const k of allowed) {
        if (req.body[k] !== undefined) {
          updates.push(`${k} = ?`);
          values.push(k === 'branch_id' ? Number(req.body[k]) : req.body[k]);
        }
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(req.params.id);
      await pool.query(`UPDATE rates SET ${updates.join(', ')} WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))`, [...values, req.branchId, req.branchId]);
      const [rows] = await pool.query('SELECT * FROM rates WHERE id = ?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Rate not found' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
