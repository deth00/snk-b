import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAdmin, requireCashier } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/tables (พร้อม status + session summary)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.id, t.code, t.name, t.status, t.active_session_id, t.created_at, t.updated_at,
             s.id AS session_id, s.status AS session_status, s.started_at, s.rate_id,
             r.name AS rate_name, r.price_per_unit
      FROM \`tables\` t
      LEFT JOIN sessions s ON s.id = t.active_session_id AND s.status IN ('running','paused')
      LEFT JOIN rates r ON r.id = s.rate_id
      ORDER BY t.code
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tables (admin)
router.post(
  '/',
  requireAdmin,
  body('code').trim().notEmpty(),
  body('name').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const [r] = await pool.query(
        'INSERT INTO `tables` (code, name) VALUES (?, ?)',
        [req.body.code, req.body.name || req.body.code]
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
  requireAdmin,
  param('id').isInt(),
  body('code').optional().trim().notEmpty(),
  body('name').optional().trim(),
  body('status').optional().isIn(['available', 'playing', 'reserved', 'maintenance']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const updates = [];
      const values = [];
      if (req.body.code !== undefined) { updates.push('code = ?'); values.push(req.body.code); }
      if (req.body.name !== undefined) { updates.push('name = ?'); values.push(req.body.name); }
      if (req.body.status !== undefined) { updates.push('status = ?'); values.push(req.body.status); }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(req.params.id);
      await pool.query(`UPDATE \`tables\` SET ${updates.join(', ')} WHERE id = ?`, values);
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
