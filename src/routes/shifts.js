import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireCashier } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// POST /api/shifts/open
router.post(
  '/open',
  requireCashier,
  body('cash_open').optional().isFloat({ min: 0 }),
  async (req, res) => {
    try {
      const [current] = await pool.query(
        "SELECT id FROM shifts WHERE closed_at IS NULL LIMIT 1"
      );
      if (current.length > 0) {
        return res.status(400).json({ error: 'A shift is already open' });
      }
      const openedAt = new Date();
      const cashOpen = req.body.cash_open != null ? Number(req.body.cash_open) : null;
      await pool.query(
        'INSERT INTO shifts (opened_by, opened_at, cash_open) VALUES (?, ?, ?)',
        [req.user.id, openedAt, cashOpen]
      );
      const [rows] = await pool.query('SELECT * FROM shifts WHERE id = LAST_INSERT_ID()');
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/shifts/current
router.get('/current', requireCashier, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, u.username AS opened_by_username
       FROM shifts s
       JOIN users u ON u.id = s.opened_by
       WHERE s.closed_at IS NULL
       LIMIT 1`
    );
    if (!rows[0]) return res.status(404).json({ error: 'No open shift' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/:id/close
router.post(
  '/:id/close',
  requireCashier,
  param('id').isInt(),
  body('cash_close').optional().isFloat({ min: 0 }),
  body('note').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [shifts] = await conn.query('SELECT * FROM shifts WHERE id = ? FOR UPDATE', [req.params.id]);
      const shift = shifts[0];
      if (!shift) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Shift not found' });
      }
      if (shift.closed_at) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Shift already closed' });
      }
      const closedAt = new Date();
      const cashClose = req.body.cash_close != null ? Number(req.body.cash_close) : null;
      const note = req.body.note || null;

      const [salesRow] = await conn.query(
        'SELECT COALESCE(SUM(total), 0) AS total_sales FROM orders WHERE shift_id = ? AND status = ?',
        [req.params.id, 'paid']
      );
      const [payRow] = await conn.query(
        `SELECT
          COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END), 0) AS total_cash,
          COALESCE(SUM(CASE WHEN p.method IN ('qr','transfer','card') THEN p.amount ELSE 0 END), 0) AS total_qr
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE o.shift_id = ? AND o.status = 'paid'`,
        [req.params.id]
      );
      const total_sales = Number(salesRow[0].total_sales);
      const total_cash = Number(payRow[0].total_cash);
      const total_qr = Number(payRow[0].total_qr);

      await conn.query(
        `UPDATE shifts SET closed_by = ?, closed_at = ?, cash_close = ?, total_sales = ?, total_cash = ?, total_qr = ?, note = ? WHERE id = ?`,
        [req.user.id, closedAt, cashClose, total_sales, total_cash, total_qr, note, req.params.id]
      );
      await conn.commit();
      const [rows] = await pool.query('SELECT * FROM shifts WHERE id = ?', [req.params.id]);
      res.json(rows[0]);
    } catch (err) {
      await conn.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  }
);

export default router;
