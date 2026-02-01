import { Router } from 'express';
import { query, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireCashier } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);
router.use(requireCashier);

// GET /api/reports/daily?date=YYYY-MM-DD
router.get(
  '/daily',
  query('date').optional().isDate(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    try {
      const [orders] = await pool.query(
        `SELECT o.id, o.code, o.status, o.subtotal, o.discount, o.total, o.opened_at, o.closed_at,
                u.username AS opened_by_username
         FROM orders o
         JOIN users u ON u.id = o.opened_by
         WHERE DATE(o.opened_at) = ?
         ORDER BY o.opened_at`,
        [date]
      );
      const [summary] = await pool.query(
        `SELECT
          COUNT(*) AS order_count,
          COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.total ELSE 0 END), 0) AS total_sales,
          COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.discount ELSE 0 END), 0) AS total_discount
         FROM orders o
         WHERE DATE(o.opened_at) = ?`,
        [date]
      );
      res.json({ date, orders, summary: summary[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/reports/by-table?date=YYYY-MM-DD
router.get(
  '/by-table',
  query('date').optional().isDate(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    try {
      const [rows] = await pool.query(
        `SELECT t.id AS table_id, t.code, t.name,
                COUNT(DISTINCT s.id) AS session_count,
                COALESCE(SUM(s.computed_amount), 0) AS table_revenue
         FROM \`tables\` t
         LEFT JOIN sessions s ON s.table_id = t.id AND s.status = 'ended' AND DATE(s.ended_at) = ?
         GROUP BY t.id, t.code, t.name
         ORDER BY t.code`,
        [date]
      );
      res.json({ date, tables: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/reports/shift/:id
router.get('/shift/:id', param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const [shifts] = await pool.query(
      `SELECT s.*, u1.username AS opened_by_username, u2.username AS closed_by_username
       FROM shifts s
       JOIN users u1 ON u1.id = s.opened_by
       LEFT JOIN users u2 ON u2.id = s.closed_by
       WHERE s.id = ?`,
      [req.params.id]
    );
    const shift = shifts[0];
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    const [orders] = await pool.query(
      `SELECT o.id, o.code, o.total, o.opened_at, o.closed_at
       FROM orders o
       WHERE o.shift_id = ? AND o.status = 'paid'
       ORDER BY o.closed_at`,
      [req.params.id]
    );
    res.json({ shift, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
