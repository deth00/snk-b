import { Router } from 'express';
import { query, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(requireAll);
router.use(branchMiddleware);

// GET /api/reports/daily?date=YYYY-MM-DD | date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get(
  '/daily',
  requireBranch,
  query('date').optional().isDate(),
  query('date_from').optional().isDate(),
  query('date_to').optional().isDate(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const dateFrom = req.query.date_from || req.query.date || new Date().toISOString().slice(0, 10);
    const dateTo = req.query.date_to || dateFrom;
    try {
      const bid = req.branchId;
      const isUserOnly = req.user.role === 'user';
      const userFilter = isUserOnly ? ' AND o.opened_by = ?' : '';
      const userParams = isUserOnly ? [req.user.id] : [];

      const [orders] = await pool.query(
        `SELECT o.id, o.code, o.status, o.subtotal, o.discount, o.total, o.opened_at, o.closed_at,
                u.username AS opened_by_username,
                (SELECT COALESCE(SUM(oi.qty * COALESCE(oi.unit_cost, 0)), 0)
                 FROM order_items oi WHERE oi.order_id = o.id) AS order_cost
         FROM orders o
         JOIN users u ON u.id = o.opened_by
         WHERE DATE(o.opened_at) >= ? AND DATE(o.opened_at) <= ? AND (o.branch_id = ? OR (o.branch_id IS NULL AND ? IS NULL))${userFilter}
         ORDER BY o.opened_at`,
        [dateFrom, dateTo, bid, bid, ...userParams]
      );
      const [summary] = await pool.query(
        `SELECT
          COUNT(*) AS order_count,
          COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.total ELSE 0 END), 0) AS total_sales,
          COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.discount ELSE 0 END), 0) AS total_discount
         FROM orders o
         WHERE DATE(o.opened_at) >= ? AND DATE(o.opened_at) <= ? AND (o.branch_id = ? OR (o.branch_id IS NULL AND ? IS NULL))${userFilter}`,
        [dateFrom, dateTo, bid, bid, ...userParams]
      );
      const [costRow] = await pool.query(
        `SELECT COALESCE(SUM(oi.qty * COALESCE(oi.unit_cost, 0)), 0) AS total_cost
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.status = 'paid'
           AND DATE(o.opened_at) >= ? AND DATE(o.opened_at) <= ?
           AND (o.branch_id = ? OR (o.branch_id IS NULL AND ? IS NULL))${userFilter}`,
        [dateFrom, dateTo, bid, bid, ...userParams]
      );
      const total_cost = Number(costRow[0]?.total_cost ?? 0);
      res.json({
        date: dateFrom === dateTo ? dateFrom : `${dateFrom} ເຖິງ ${dateTo}`,
        date_from: dateFrom,
        date_to: dateTo,
        orders,
        summary: { ...summary[0], total_cost },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/reports/by-table?date=YYYY-MM-DD | date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get(
  '/by-table',
  requireBranch,
  query('date').optional().isDate(),
  query('date_from').optional().isDate(),
  query('date_to').optional().isDate(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const dateFrom = req.query.date_from || req.query.date || new Date().toISOString().slice(0, 10);
    const dateTo = req.query.date_to || dateFrom;
    try {
      const bid = req.branchId;
      const isUserOnly = req.user.role === 'user';
      const sessionUserFilter = isUserOnly ? ' AND s.opened_by = ?' : '';
      const sessionUserParams = isUserOnly ? [req.user.id] : [];

      const [rows] = await pool.query(
        `SELECT t.id AS table_id, t.code, t.name, COALESCE(t.port, 0) AS port,
                COUNT(DISTINCT s.id) AS session_count,
                COALESCE(SUM(s.computed_amount), 0) AS table_revenue
         FROM \`tables\` t
         LEFT JOIN sessions s ON s.table_id = t.id AND s.status = 'ended' AND DATE(s.ended_at) >= ? AND DATE(s.ended_at) <= ?${sessionUserFilter}
         WHERE (t.branch_id = ? OR (t.branch_id IS NULL AND ? IS NULL))
         GROUP BY t.id, t.code, t.name, t.port
         ORDER BY table_revenue DESC, t.code ASC`,
        [dateFrom, dateTo, ...sessionUserParams, bid, bid]
      );
      const total_sessions = rows.reduce((sum, r) => sum + Number(r.session_count || 0), 0);
      const total_revenue = rows.reduce((sum, r) => sum + Number(r.table_revenue || 0), 0);
      const tables_with_sessions = rows.filter((r) => Number(r.session_count || 0) > 0).length;
      res.json({
        date: dateFrom === dateTo ? dateFrom : `${dateFrom} ເຖິງ ${dateTo}`,
        date_from: dateFrom,
        date_to: dateTo,
        tables: rows,
        summary: { total_sessions, total_revenue, tables_with_sessions },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/reports/by-product?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD — ยอดขายแยกตามสินค้า
router.get(
  '/by-product',
  requireBranch,
  query('date_from').optional().isDate(),
  query('date_to').optional().isDate(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const dateFrom = req.query.date_from || new Date().toISOString().slice(0, 10);
    const dateTo = req.query.date_to || dateFrom;
    try {
      const bid = req.branchId;
      const isUserOnly = req.user.role === 'user';
      const userFilter = isUserOnly ? ' AND o.opened_by = ?' : '';
      const userParams = isUserOnly ? [req.user.id] : [];

      const [rows] = await pool.query(
        `SELECT oi.ref_id AS product_id, oi.name AS product_name,
                SUM(oi.qty) AS total_qty,
                SUM(oi.qty * COALESCE(oi.unit_cost, 0)) AS total_cost,
                SUM(oi.amount) AS total_amount
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.status = 'paid'
           AND DATE(COALESCE(o.closed_at, o.opened_at)) >= ? AND DATE(COALESCE(o.closed_at, o.opened_at)) <= ?
           AND (o.branch_id = ? OR (o.branch_id IS NULL AND ? IS NULL))${userFilter}
         WHERE oi.item_type = 'product'
         GROUP BY oi.ref_id, oi.name
         ORDER BY total_amount DESC`,
        [dateFrom, dateTo, bid, bid, ...userParams]
      );
      const total_amount = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
      const total_cost = rows.reduce((sum, r) => sum + Number(r.total_cost || 0), 0);
      res.json({
        date: dateFrom === dateTo ? dateFrom : `${dateFrom} ເຖິງ ${dateTo}`,
        date_from: dateFrom,
        date_to: dateTo,
        products: rows,
        summary: { total_amount, total_cost },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/reports/shift/:id — ต้องส่ง X-Branch-Id; ตรวจสอบ shift เป็นของสาขานี้
router.get('/shift/:id', requireBranch, param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const [shifts] = await pool.query(
      `SELECT s.*, u1.username AS opened_by_username, u2.username AS closed_by_username
       FROM shifts s
       LEFT JOIN users u1 ON u1.id = s.opened_by
       LEFT JOIN users u2 ON u2.id = s.closed_by
       WHERE s.id = ?`,
      [req.params.id]
    );
    const shift = shifts[0];
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    if (shift.branch_id != null && Number(shift.branch_id) !== Number(req.branchId)) {
      return res.status(403).json({ error: 'กะนี้ไม่ใช่ของสาขานี้' });
    }
    const isUserOnly = req.user.role === 'user';
    const userFilter = isUserOnly ? ' AND o.opened_by = ?' : '';
    const userParams = isUserOnly ? [req.user.id] : [];

    const [orders] = await pool.query(
      `SELECT o.id, o.code, o.total, o.opened_at, o.closed_at
       FROM orders o
       WHERE o.shift_id = ? AND o.status = 'paid'${userFilter}
       ORDER BY o.closed_at`,
      [req.params.id, ...userParams]
    );
    const shiftRow = { ...shift };
    if (!shift.closed_at) {
      const [salesRow] = await pool.query(
        `SELECT COALESCE(SUM(total), 0) AS total_sales FROM orders WHERE shift_id = ? AND status = ?${userFilter}`,
        [req.params.id, 'paid', ...userParams]
      );
      const [payRow] = await pool.query(
        `SELECT
          COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END), 0) AS total_cash,
          COALESCE(SUM(CASE WHEN p.method IN ('qr','transfer','card','mixed') THEN p.amount ELSE 0 END), 0) AS total_qr
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE o.shift_id = ? AND o.status = 'paid'${userFilter}`,
        [req.params.id, ...userParams]
      );
      shiftRow.total_sales = Number(salesRow[0].total_sales);
      shiftRow.total_cash = Number(payRow[0].total_cash);
      shiftRow.total_qr = Number(payRow[0].total_qr);
    }
    res.json({ shift: shiftRow, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
