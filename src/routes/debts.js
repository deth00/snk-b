import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

/**
 * GET /api/debts/balance
 * ดึงยอดหนี้ค้างชำระของลูกค้า (ส่ง member_id หรือ phone)
 * ต้องมี X-Branch-Id
 */
router.get(
  '/balance',
  requireAll,
  requireBranch,
  query('member_id').optional().isInt({ min: 1 }),
  query('phone').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { member_id, phone } = req.query;
    const branchId = req.branchId;
    if (!member_id && !phone) return res.status(400).json({ error: 'ต้องส่ง member_id หรือ phone' });

    try {
      let row = null;
      if (member_id) {
        const [rows] = await pool.query(
          `SELECT d.id, d.member_id, d.phone, d.customer_name, d.balance, m.name as member_name, m.phone as member_phone
           FROM member_debts d
           LEFT JOIN members m ON m.id = d.member_id
           WHERE d.member_id = ? AND d.branch_id = ? AND d.balance > 0`,
          [member_id, branchId]
        );
        row = rows[0];
      } else {
        const [rows] = await pool.query(
          `SELECT d.id, d.member_id, d.phone, d.customer_name, d.balance, m.name as member_name
           FROM member_debts d
           LEFT JOIN members m ON m.id = d.member_id
           WHERE d.phone = ? AND d.branch_id = ? AND d.balance > 0`,
          [phone.trim(), branchId]
        );
        row = rows[0];
      }
      if (!row || Number(row.balance) <= 0) {
        return res.json({ balance: 0, member_debt_id: null, customer_name: null });
      }
      res.json({
        balance: Number(row.balance),
        member_debt_id: row.id,
        member_id: row.member_id,
        customer_name: row.member_name || row.customer_name || (row.phone ? `ลูกค้า ${row.phone}` : null),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /api/debts
 * รายการลูกค้าที่มีหนี้ค้าง (balance > 0) สำหรับสาขา
 * ?include_paid=1 — รวมผู้ที่ชำระหมดแล้ว (balance = 0) ด้วย
 * ?date_from=YYYY-MM-DD — กรองตามวันที่มีกิจกรรม (หนี้เพิ่ม/ชำระ) >= วันที่นี้
 * ?date_to=YYYY-MM-DD — กรองตามวันที่มีกิจกรรม <= วันที่นี้
 * ?status=all|outstanding|paid — all=ทั้งหมด, outstanding=ยังค้างชำระ, paid=ชำระแล้ว
 */
router.get('/', requireAll, requireBranch, async (req, res) => {
  const includePaid = req.query.include_paid === '1';
  const dateFrom = req.query.date_from ? String(req.query.date_from).trim() : null;
  const dateTo = req.query.date_to ? String(req.query.date_to).trim() : null;
  const status = req.query.status ? String(req.query.status).toLowerCase() : 'all';

  const conditions = ['d.branch_id = ?'];
  const params = [req.branchId];

  if (!includePaid && status === 'all') {
    conditions.push('d.balance > 0');
  } else if (status === 'outstanding') {
    conditions.push('d.balance > 0');
  } else if (status === 'paid') {
    conditions.push('d.balance <= 0');
  }

  const lastPaymentSubquery = "(SELECT MAX(t.created_at) FROM debt_transactions t WHERE t.member_debt_id = d.id AND t.type = 'payment')";
  // ใช้ "วันที่กิจกรรมล่าสุด" = วันที่ทำธุรกรรมล่าสุด (หนี้/ชำระ) หรือ updated_at เพื่อให้หนี้ที่ยังไม่เคยชำระก็โผล่ด้วย
  const lastActivitySubquery = "COALESCE((SELECT MAX(t.created_at) FROM debt_transactions t WHERE t.member_debt_id = d.id), d.updated_at)";
  if (dateFrom || dateTo) {
    if (dateFrom && dateTo) {
      conditions.push(`${lastActivitySubquery} BETWEEN ? AND ?`);
      params.push(`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`);
    } else if (dateFrom) {
      conditions.push(`${lastActivitySubquery} >= ?`);
      params.push(`${dateFrom} 00:00:00`);
    } else {
      conditions.push(`${lastActivitySubquery} <= ?`);
      params.push(`${dateTo} 23:59:59`);
    }
  }

  const whereClause = conditions.join(' AND ');
  try {
    const [rows] = await pool.query(
      `SELECT d.id, d.member_id, d.phone, d.customer_name, d.balance, d.created_at, d.updated_at,
              m.name as member_name, m.phone as member_phone,
              ${lastPaymentSubquery} as last_payment_at
       FROM member_debts d
       LEFT JOIN members m ON m.id = d.member_id
       WHERE ${whereClause}
       ORDER BY d.balance DESC, d.updated_at DESC`,
      params
    );
    const list = rows.map((r) => ({
      id: r.id,
      member_id: r.member_id,
      phone: r.phone,
      customer_name: r.member_name || r.customer_name || (r.phone ? `ลูกค้า ${r.phone}` : null),
      balance: Number(r.balance),
      created_at: r.created_at,
      updated_at: r.updated_at,
      last_payment_at: r.last_payment_at,
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debts/:id
 * รายละเอียดหนี้ + ประวัติ transactions + รายการสินค้าจากออเดอร์ที่ติดหนี้
 */
router.get('/:id', requireAll, requireBranch, param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const [debtRows] = await pool.query(
      `SELECT d.*, m.name as member_name, m.phone as member_phone
       FROM member_debts d
       LEFT JOIN members m ON m.id = d.member_id
       WHERE d.id = ? AND d.branch_id = ?`,
      [req.params.id, req.branchId]
    );
    const debt = debtRows[0];
    if (!debt) return res.status(404).json({ error: 'ไม่พบหนี้นี้' });

    const [txRows] = await pool.query(
      `SELECT id, type, amount, order_id, note, created_at, created_by
       FROM debt_transactions WHERE member_debt_id = ? ORDER BY created_at DESC`,
      [req.params.id]
    );

    const debtOrders = txRows.filter((t) => t.type === 'debt' && t.order_id);
    const debtOrderItems = [];
    for (const tx of debtOrders) {
      const [[orderRow]] = await pool.query(
        `SELECT o.code, o.subtotal, o.discount, o.total, o.closed_at, o.branch_id, b.name AS branch_name
         FROM orders o
         LEFT JOIN branches b ON b.id = o.branch_id
         WHERE o.id = ?`,
        [tx.order_id]
      );
      const [itemRows] = await pool.query(
        'SELECT id, name, qty, unit_price, amount FROM order_items WHERE order_id = ? ORDER BY id',
        [tx.order_id]
      );
      debtOrderItems.push({
        order_id: tx.order_id,
        order_code: orderRow?.code || String(tx.order_id),
        order_subtotal: Number(orderRow?.subtotal || 0),
        order_discount: Number(orderRow?.discount || 0),
        order_total: Number(orderRow?.total || 0),
        order_closed_at: orderRow?.closed_at || null,
        order_branch_id: orderRow?.branch_id ?? null,
        order_branch_name: orderRow?.branch_name || null,
        transaction_id: tx.id,
        transaction_date: tx.created_at,
        debt_amount: Number(tx.amount),
        items: itemRows.map((i) => ({
          id: i.id,
          name: i.name,
          qty: Number(i.qty),
          unit_price: Number(i.unit_price),
          amount: Number(i.amount),
        })),
      });
    }

    res.json({
      ...debt,
      balance: Number(debt.balance),
      customer_name: debt.member_name || debt.customer_name || (debt.phone ? `ลูกค้า ${debt.phone}` : null),
      transactions: txRows.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        order_id: t.order_id,
        note: t.note,
        created_at: t.created_at,
      })),
      debt_order_items: debtOrderItems,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/debts — สร้างหรือเพิ่มหนี้
 * body: { member_id?, phone?, customer_name?, amount, order_id?, note? }
 * ใช้เมื่อลูกค้าจ่ายไม่ครบ
 */
router.post(
  '/',
  requireAll,
  requireBranch,
  body('amount').isFloat({ min: 0.01 }),
  body('member_id').optional().isInt({ min: 1 }),
  body('phone').optional().trim(),
  body('customer_name').optional().trim(),
  body('order_id').optional().isInt({ min: 1 }),
  body('note').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { member_id, phone, customer_name, amount, order_id, note } = req.body;
    if (!member_id && !phone) return res.status(400).json({ error: 'ต้องส่ง member_id หรือ phone' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const branchId = req.branchId;
      let debtId = null;

      let [existing] = [];
      if (member_id) {
        [existing] = await conn.query(
          'SELECT id, balance FROM member_debts WHERE member_id = ? AND branch_id = ?',
          [member_id, branchId]
        );
      } else {
        [existing] = await conn.query(
          'SELECT id, balance FROM member_debts WHERE phone = ? AND branch_id = ? AND member_id IS NULL',
          [phone.trim(), branchId]
        );
      }

      const amt = Number(amount);
      if (existing[0]) {
        debtId = existing[0].id;
        await conn.query(
          'UPDATE member_debts SET balance = balance + ?, updated_at = NOW() WHERE id = ?',
          [amt, debtId]
        );
      } else {
        const [r] = await conn.query(
          `INSERT INTO member_debts (member_id, phone, customer_name, branch_id, balance)
           VALUES (?, ?, ?, ?, ?)`,
          [member_id || null, phone?.trim() || null, customer_name?.trim() || null, branchId, amt]
        );
        debtId = r.insertId;
      }

      await conn.query(
        `INSERT INTO debt_transactions (member_debt_id, type, amount, order_id, note, created_by)
         VALUES (?, 'debt', ?, ?, ?, ?)`,
        [debtId, amt, order_id || null, note || null, req.user?.id || null]
      );

      await conn.commit();
      const [rows] = await pool.query('SELECT * FROM member_debts WHERE id = ?', [debtId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      await conn.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  }
);

/**
 * POST /api/debts/:id/pay — ชำระหนี้
 * body: { amount, order_id?, note? }
 */
router.post(
  '/:id/pay',
  requireAll,
  requireBranch,
  param('id').isInt(),
  body('amount').isFloat({ min: 0.01 }),
  body('order_id').optional().isInt({ min: 1 }),
  body('note').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { amount, order_id, note } = req.body;
    const amt = Number(amount);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [debts] = await conn.query(
        'SELECT * FROM member_debts WHERE id = ? AND branch_id = ? FOR UPDATE',
        [req.params.id, req.branchId]
      );
      const debt = debts[0];
      if (!debt) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'ไม่พบหนี้นี้' });
      }
      const balance = Number(debt.balance);
      const payAmount = Math.min(amt, balance);
      if (payAmount <= 0) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'ยอดหนี้เป็น 0 แล้ว' });
      }

      await conn.query(
        'UPDATE member_debts SET balance = balance - ?, updated_at = NOW() WHERE id = ?',
        [payAmount, req.params.id]
      );
      await conn.query(
        `INSERT INTO debt_transactions (member_debt_id, type, amount, order_id, note, created_by)
         VALUES (?, 'payment', ?, ?, ?, ?)`,
        [req.params.id, payAmount, order_id || null, note || null, req.user?.id || null]
      );

      await conn.commit();
      const [rows] = await pool.query('SELECT * FROM member_debts WHERE id = ?', [req.params.id]);
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
