import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/rates
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM rates ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rates
router.post(
  '/',
  requireAdmin,
  body('name').trim().notEmpty(),
  body('price_per_unit').isFloat({ min: 0 }),
  body('minimum_units').optional().isFloat({ min: 0 }),
  body('rounding_minutes').optional().isInt({ min: 0 }),
  body('rounding_mode').optional().isIn(['ceil', 'floor', 'nearest']),
  body('start_time').optional(),
  body('end_time').optional(),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const {
        name, price_per_unit, minimum_units = 0, rounding_minutes = 0,
        rounding_mode = 'ceil', start_time, end_time, is_active = true,
      } = req.body;
      await pool.query(
        `INSERT INTO rates (name, unit, price_per_unit, minimum_units, rounding_minutes, rounding_mode, start_time, end_time, is_active)
         VALUES (?, 'hour', ?, ?, ?, ?, ?, ?, ?)`,
        [name, price_per_unit, minimum_units, rounding_minutes, rounding_mode, start_time || null, end_time || null, is_active]
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
  requireAdmin,
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('price_per_unit').optional().isFloat({ min: 0 }),
  body('minimum_units').optional().isFloat({ min: 0 }),
  body('rounding_minutes').optional().isInt({ min: 0 }),
  body('rounding_mode').optional().isIn(['ceil', 'floor', 'nearest']),
  body('start_time').optional(),
  body('end_time').optional(),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const allowed = ['name', 'price_per_unit', 'minimum_units', 'rounding_minutes', 'rounding_mode', 'start_time', 'end_time', 'is_active'];
      const updates = [];
      const values = [];
      for (const k of allowed) {
        if (req.body[k] !== undefined) {
          updates.push(`${k} = ?`);
          values.push(req.body[k]);
        }
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(req.params.id);
      await pool.query(`UPDATE rates SET ${updates.join(', ')} WHERE id = ?`, values);
      const [rows] = await pool.query('SELECT * FROM rates WHERE id = ?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Rate not found' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
