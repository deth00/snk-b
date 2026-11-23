import { Router } from 'express';
import { query, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';
import { laoTodaySql } from '../utils/time.js';

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
    const dateFrom = req.query.date_from || req.query.date || laoTodaySql();
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
                 FROM order_items oi WHERE oi.order_id = o.id) AS order_cost,
                COALESCE(
                  (SELECT t.code
                   FROM order_items ti
                   JOIN sessions s ON s.id = ti.ref_id
                   JOIN \`tables\` t ON t.id = s.table_id
                   WHERE ti.order_id = o.id AND ti.item_type = 'table_time'
                   LIMIT 1),
                  (SELECT 'ສິນຄ້າ'
                   FROM order_items pi
                   WHERE pi.order_id = o.id AND pi.item_type = 'product'
                   LIMIT 1)
                ) AS item_label,
                (SELECT COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END), 0)
                 FROM payments p WHERE p.order_id = o.id) AS cash_amount,
                (SELECT COALESCE(SUM(CASE WHEN p.method IN ('qr','transfer','card','mixed') THEN p.amount ELSE 0 END), 0)
                 FROM payments p WHERE p.order_id = o.id) AS transfer_amount
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
          COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.discount ELSE 0 END), 0) AS total_discount,
          (SELECT COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END), 0)
           FROM payments p
           JOIN orders po ON po.id = p.order_id
           WHERE po.status = 'paid'
             AND DATE(po.opened_at) >= ? AND DATE(po.opened_at) <= ?
             AND (po.branch_id = ? OR (po.branch_id IS NULL AND ? IS NULL))${userFilter.replaceAll('o.', 'po.')}) AS total_cash,
          (SELECT COALESCE(SUM(CASE WHEN p.method IN ('qr','transfer','card','mixed') THEN p.amount ELSE 0 END), 0)
           FROM payments p
           JOIN orders po ON po.id = p.order_id
           WHERE po.status = 'paid'
             AND DATE(po.opened_at) >= ? AND DATE(po.opened_at) <= ?
             AND (po.branch_id = ? OR (po.branch_id IS NULL AND ? IS NULL))${userFilter.replaceAll('o.', 'po.')}) AS total_transfer
         FROM orders o
         WHERE DATE(o.opened_at) >= ? AND DATE(o.opened_at) <= ? AND (o.branch_id = ? OR (o.branch_id IS NULL AND ? IS NULL))${userFilter}`,
        [
          dateFrom, dateTo, bid, bid, ...userParams,
          dateFrom, dateTo, bid, bid, ...userParams,
          dateFrom, dateTo, bid, bid, ...userParams,
        ]
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
    const dateFrom = req.query.date_from || req.query.date || laoTodaySql();
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
    const dateFrom = req.query.date_from || laoTodaySql();
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

// GET /api/reports/pnl?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD — รายงานผลดำเนินงาน (P&L)
router.get(
  '/pnl',
  requireBranch,
  query('date_from').optional().isDate(),
  query('date_to').optional().isDate(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;

    let orderDateCond = '';
    const orderDateParams = [];
    if (dateFrom && dateTo) {
      orderDateCond = ' AND DATE(COALESCE(o.closed_at, o.opened_at)) >= ? AND DATE(COALESCE(o.closed_at, o.opened_at)) <= ?';
      orderDateParams.push(dateFrom, dateTo);
    } else if (dateFrom) {
      orderDateCond = ' AND DATE(COALESCE(o.closed_at, o.opened_at)) >= ?';
      orderDateParams.push(dateFrom);
    } else if (dateTo) {
      orderDateCond = ' AND DATE(COALESCE(o.closed_at, o.opened_at)) <= ?';
      orderDateParams.push(dateTo);
    }

    let txDateCond = '';
    const txDateParams = [];
    if (dateFrom && dateTo) {
      txDateCond = ' AND DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?';
      txDateParams.push(dateFrom, dateTo);
    } else if (dateFrom) {
      txDateCond = ' AND DATE(t.created_at) >= ?';
      txDateParams.push(dateFrom);
    } else if (dateTo) {
      txDateCond = ' AND DATE(t.created_at) <= ?';
      txDateParams.push(dateTo);
    }

    try {
      const bid = req.branchId;
      const isUserOnly = req.user.role === 'user';
      const userFilter = isUserOnly ? ' AND o.opened_by = ?' : '';
      const userParams = isUserOnly ? [req.user.id] : [];
      const branchCond = '(o.branch_id = ? OR (o.branch_id IS NULL AND ? IS NULL))';
      const txBranchCond = '(t.branch_id = ? OR (t.branch_id IS NULL AND ? IS NULL))';

      // 1) Revenue from table time (snooker)
      const [tableTimeRows] = await pool.query(
        `SELECT COALESCE(SUM(oi.amount), 0) AS total
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.status = 'paid'
           AND ${branchCond}${orderDateCond}${userFilter}
         WHERE oi.item_type = 'table_time'`,
        [bid, bid, ...orderDateParams, ...userParams]
      );
      const tableTimeRevenue = Number(tableTimeRows[0]?.total ?? 0);

      // 2) Revenue from product sales grouped by product category
      const [productRows] = await pool.query(
        `SELECT COALESCE(pc.name, 'ບໍ່ມີໝວດ') AS category_name,
                COALESCE(pc.id, 0) AS category_id,
                SUM(oi.amount) AS revenue,
                SUM(oi.qty) AS total_qty,
                SUM(oi.qty * COALESCE(oi.unit_cost, 0)) AS cost
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.status = 'paid'
           AND ${branchCond}${orderDateCond}${userFilter}
         LEFT JOIN products p ON p.id = oi.ref_id
         LEFT JOIN product_categories pc ON pc.id = p.category_id
         WHERE oi.item_type = 'product'
         GROUP BY pc.id, pc.name
         ORDER BY revenue DESC`,
        [bid, bid, ...orderDateParams, ...userParams]
      );
      const productRevenue = productRows.reduce((s, r) => s + Number(r.revenue || 0), 0);
      const productCost = productRows.reduce((s, r) => s + Number(r.cost || 0), 0);

      // 3) Manual income entries grouped by category
      const [incomeRows] = await pool.query(
        `SELECT COALESCE(t.category, 'ອື່ນໆ') AS category_name,
                COALESCE(SUM(t.amount), 0) AS total
         FROM incomes t
         WHERE ${txBranchCond}${txDateCond}
         GROUP BY t.category
         ORDER BY total DESC`,
        [bid, bid, ...txDateParams]
      );
      const manualIncome = incomeRows.reduce((s, r) => s + Number(r.total || 0), 0);

      // 4) Expense entries grouped by category
      const [expenseRows] = await pool.query(
        `SELECT COALESCE(t.category, 'ອື່ນໆ') AS category_name,
                COALESCE(SUM(t.amount), 0) AS total
         FROM expenses t
         WHERE ${txBranchCond}${txDateCond}
         GROUP BY t.category
         ORDER BY total DESC`,
        [bid, bid, ...txDateParams]
      );
      const totalExpense = expenseRows.reduce((s, r) => s + Number(r.total || 0), 0);

      // 5) Payment method breakdown
      const [paymentRows] = await pool.query(
        `SELECT p.method,
                COALESCE(SUM(p.amount), 0) AS total
         FROM payments p
         JOIN orders o ON o.id = p.order_id AND o.status = 'paid'
           AND ${branchCond}${orderDateCond}${userFilter}
         GROUP BY p.method
         ORDER BY total DESC`,
        [bid, bid, ...orderDateParams, ...userParams]
      );

      // 6) Order count & discount
      const [orderSummary] = await pool.query(
        `SELECT COUNT(*) AS order_count,
                COALESCE(SUM(o.total), 0) AS total_sales,
                COALESCE(SUM(o.discount), 0) AS total_discount
         FROM orders o
         WHERE o.status = 'paid' AND ${branchCond}${orderDateCond}${userFilter}`,
        [bid, bid, ...orderDateParams, ...userParams]
      );

      // 7) Top selling products
      const [topProducts] = await pool.query(
        `SELECT oi.name AS product_name,
                SUM(oi.qty) AS total_qty,
                SUM(oi.amount) AS total_amount
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.status = 'paid'
           AND ${branchCond}${orderDateCond}${userFilter}
         WHERE oi.item_type = 'product'
         GROUP BY oi.ref_id, oi.name
         ORDER BY total_amount DESC
         LIMIT 10`,
        [bid, bid, ...orderDateParams, ...userParams]
      );

      // 8) Cash drawer deposits (counted as expense)
      let cdDateCond = '';
      const cdDateParams = [];
      if (dateFrom && dateTo) {
        cdDateCond = ' AND DATE(l.created_at) >= ? AND DATE(l.created_at) <= ?';
        cdDateParams.push(dateFrom, dateTo);
      } else if (dateFrom) {
        cdDateCond = ' AND DATE(l.created_at) >= ?';
        cdDateParams.push(dateFrom);
      } else if (dateTo) {
        cdDateCond = ' AND DATE(l.created_at) <= ?';
        cdDateParams.push(dateTo);
      }
      const [cashDepositRows] = await pool.query(
        `SELECT COALESCE(SUM(l.amount), 0) AS total_deposit,
                COUNT(*) AS deposit_count
         FROM cash_drawer_logs l
         WHERE l.branch_id = ? AND l.type = 'deposit'${cdDateCond}`,
        [bid, ...cdDateParams]
      );
      const cashDeposit = Number(cashDepositRows[0]?.total_deposit ?? 0);

      // 9) Cash drawer current balance
      const [cashBalanceRows] = await pool.query(
        'SELECT COALESCE(balance, 0) AS balance FROM cash_drawers WHERE branch_id = ?',
        [bid]
      );
      const cashBalance = Number(cashBalanceRows[0]?.balance ?? 0);

      const totalRevenue = tableTimeRevenue + productRevenue + manualIncome;
      const totalAllExpense = totalExpense + cashDeposit;
      const grossProfit = totalRevenue - productCost;
      const netProfit = totalRevenue - productCost - totalAllExpense;

      res.json({
        date_from: dateFrom,
        date_to: dateTo,
        revenue: {
          table_time: tableTimeRevenue,
          product_total: productRevenue,
          product_by_category: productRows.map(r => ({
            category_id: Number(r.category_id),
            category_name: r.category_name,
            revenue: Number(r.revenue),
            cost: Number(r.cost),
            qty: Number(r.total_qty),
          })),
          manual_income_total: manualIncome,
          manual_income_by_category: incomeRows.map(r => ({
            category_name: r.category_name,
            total: Number(r.total),
          })),
          total: totalRevenue,
        },
        cost_of_goods: productCost,
        expenses: {
          by_category: expenseRows.map(r => ({
            category_name: r.category_name,
            total: Number(r.total),
          })),
          total: totalExpense,
        },
        cash_drawer: {
          deposit: cashDeposit,
          deposit_count: Number(cashDepositRows[0]?.deposit_count ?? 0),
          current_balance: cashBalance,
        },
        payments: paymentRows.map(r => ({
          method: r.method,
          total: Number(r.total),
        })),
        orders: {
          count: Number(orderSummary[0]?.order_count ?? 0),
          total_sales: Number(orderSummary[0]?.total_sales ?? 0),
          total_discount: Number(orderSummary[0]?.total_discount ?? 0),
        },
        top_products: topProducts.map(r => ({
          product_name: r.product_name,
          total_qty: Number(r.total_qty),
          total_amount: Number(r.total_amount),
        })),
        summary: {
          total_revenue: totalRevenue,
          cost_of_goods: productCost,
          gross_profit: grossProfit,
          total_expense: totalExpense,
          cash_drawer_deposit: cashDeposit,
          total_all_expense: totalAllExpense,
          net_profit: netProfit,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/reports/shift/:id — ต้องส่ง X-Branch-Id; ตรวจสอบ shift เป็นของสาขานี้
// GET /api/reports/stock?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&status=all|pending|approved|rejected
router.get(
  '/stock',
  requireBranch,
  query('date_from').optional().isDate(),
  query('date_to').optional().isDate(),
  query('status').optional().isIn(['all', 'pending', 'approved', 'rejected']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const dateFrom = req.query.date_from || laoTodaySql();
    const dateTo = req.query.date_to || dateFrom;
    const status = req.query.status || 'all';

    try {
      const bid = req.branchId;
      const isUserOnly = req.user.role === 'user';
      let statusCond = '';
      const statusParams = [];
      if (status !== 'all') {
        statusCond = ' AND s.status = ?';
        statusParams.push(status);
      }
      const userFilter = isUserOnly ? ' AND s.requested_by = ?' : '';
      const userParams = isUserOnly ? [req.user.id] : [];

      const [rows] = await pool.query(
        `SELECT s.id, s.product_id, s.old_qty, s.new_qty,
                (s.new_qty - s.old_qty) AS delta_qty,
                s.min_stock, s.note, s.status, s.requested_at, s.approved_at,
                p.sku, p.name AS product_name, p.unit,
                COALESCE(c.name, '-') AS category_name,
                ru.username AS requested_by_username,
                au.username AS approved_by_username
         FROM stock_adjustments s
         JOIN products p ON p.id = s.product_id
         LEFT JOIN product_categories c ON c.id = p.category_id
         JOIN users ru ON ru.id = s.requested_by
         LEFT JOIN users au ON au.id = s.approved_by
         WHERE (s.branch_id = ? OR (s.branch_id IS NULL AND ? IS NULL))
           AND DATE(s.requested_at) >= ? AND DATE(s.requested_at) <= ?
           ${statusCond}${userFilter}
         ORDER BY s.requested_at DESC, s.id DESC
         LIMIT 1000`,
        [bid, bid, dateFrom, dateTo, ...statusParams, ...userParams]
      );

      const summary = rows.reduce((acc, row) => {
        const delta = Number(row.delta_qty || 0);
        acc.total_count += 1;
        if (row.status === 'pending') acc.pending_count += 1;
        if (row.status === 'approved') {
          acc.approved_count += 1;
          if (delta > 0) acc.total_in += delta;
          if (delta < 0) acc.total_out += Math.abs(delta);
        }
        if (row.status === 'rejected') acc.rejected_count += 1;
        return acc;
      }, {
        total_count: 0,
        approved_count: 0,
        pending_count: 0,
        rejected_count: 0,
        total_in: 0,
        total_out: 0,
      });

      res.json({
        date: dateFrom === dateTo ? dateFrom : `${dateFrom} à»€àº–àº´àº‡ ${dateTo}`,
        date_from: dateFrom,
        date_to: dateTo,
        status,
        movements: rows.map((row) => ({
          ...row,
          old_qty: Number(row.old_qty),
          new_qty: Number(row.new_qty),
          delta_qty: Number(row.delta_qty),
          min_stock: row.min_stock == null ? null : Number(row.min_stock),
        })),
        summary,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

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
