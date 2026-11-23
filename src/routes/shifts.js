import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';
import { laoNowSql } from '../utils/time.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

// GET /api/shifts — รายการกะ (ต้องส่ง X-Branch-Id)
router.get('/', requireAll, requireBranch, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.opened_at, s.closed_at, s.branch_id, u.username AS opened_by_username
       FROM shifts s
       LEFT JOIN users u ON u.id = s.opened_by
       WHERE s.branch_id = ? OR (s.branch_id IS NULL AND ? IS NULL)
       ORDER BY s.id DESC
       LIMIT 200`,
      [req.branchId, req.branchId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/open
router.post(
  '/open',
  requireAll,
  requireBranch,
  body('cash_open').optional().isFloat({ min: 0 }),
  async (req, res) => {
    try {
      const [current] = await pool.query(
        'SELECT id FROM shifts WHERE closed_at IS NULL AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL)) LIMIT 1',
        [req.branchId, req.branchId]
      );
      if (current.length > 0) {
        return res.status(400).json({ error: 'สาขานี้มีกะเปิดอยู่แล้ว' });
      }
      const openedAt = laoNowSql();
      const cashOpen = req.body.cash_open != null ? Number(req.body.cash_open) : null;
      await pool.query(
        'INSERT INTO shifts (opened_by, opened_at, cash_open, branch_id) VALUES (?, ?, ?, ?)',
        [req.user.id, openedAt, cashOpen, req.branchId]
      );
      const [rows] = await pool.query('SELECT * FROM shifts WHERE id = LAST_INSERT_ID()');
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/shifts/current
router.get('/current', requireBranch, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, u.username AS opened_by_username
       FROM shifts s
       LEFT JOIN users u ON u.id = s.opened_by
       WHERE s.closed_at IS NULL AND (s.branch_id = ? OR (s.branch_id IS NULL AND ? IS NULL))
       LIMIT 1`,
      [req.branchId, req.branchId]
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
  requireAll,
  requireBranch,
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
      if (shift.branch_id != null && Number(shift.branch_id) !== Number(req.branchId)) {
        await conn.rollback();
        conn.release();
        return res.status(403).json({ error: 'กะนี้ไม่ใช่ของสาขานี้' });
      }
      const shiftBranchId = shift.branch_id != null ? Number(shift.branch_id) : null;
      const [busyTables] = await conn.query(
        `SELECT id, code, name, status, active_session_id
         FROM \`tables\`
         WHERE (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
           AND (status <> 'available' OR active_session_id IS NOT NULL)
         ORDER BY code
         LIMIT 50`,
        [shiftBranchId, shiftBranchId]
      );
      if (busyTables.length > 0) {
        await conn.rollback();
        const tableNames = busyTables.map((table) => table.name || table.code).join(', ');
        return res.status(400).json({
          error: `ປິດກະບໍ່ໄດ້ ຕ້ອງໃຫ້ໂຕະວ່າງທັງໝົດກ່ອນ: ${tableNames}`,
          code: 'TABLES_NOT_AVAILABLE',
          tables: busyTables,
        });
      }

      const closedAt = laoNowSql();
      const cashClose = req.body.cash_close != null ? Number(req.body.cash_close) : null;
      const note = req.body.note || null;

      const [salesRow] = await conn.query(
        'SELECT COALESCE(SUM(total), 0) AS total_sales FROM orders WHERE shift_id = ? AND status = ?',
        [req.params.id, 'paid']
      );
      const [payRow] = await conn.query(
        `SELECT
          COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END), 0) AS total_cash,
          COALESCE(SUM(CASE WHEN p.method IN ('qr','transfer','card','mixed') THEN p.amount ELSE 0 END), 0) AS total_qr
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
