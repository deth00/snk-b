import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';
import { syncTableToEsp32 } from '../services/tableSyncEsp32.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

// กติกาข้อมูลการเงิน: order.subtotal = SUM(order_items.amount) เสมอ; order.total = subtotal ก่อน checkout, = subtotal - discount ตอน checkout (ที่เดียว)
// GET /api/orders — รายการบิล (ต้องส่ง X-Branch-Id), query: status=paid|open|void|all, limit
router.get('/', requireAll, requireBranch, async (req, res) => {
  try {
    const status = req.query.status || 'paid';
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    let sql = `SELECT id, code, status, subtotal, discount, total, opened_at, closed_at, opened_by, shift_id
       FROM orders`;
    const params = [];
    const branchFilter = ' (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))';
    if (status && status !== 'all') {
      sql += ' WHERE status = ? AND' + branchFilter;
      params.push(status, req.branchId, req.branchId);
    } else {
      sql += ' WHERE' + branchFilter;
      params.push(req.branchId, req.branchId);
    }
    sql += ' ORDER BY COALESCE(closed_at, opened_at) DESC, id DESC LIMIT ?';
    params.push(limit);
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/open — ต้องส่ง X-Branch-Id
router.post('/open', requireAll, requireBranch, async (req, res) => {
  try {
    const openedAt = new Date();
    const [currentShift] = await pool.query(
      'SELECT id, branch_id FROM shifts WHERE closed_at IS NULL AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL)) LIMIT 1',
      [req.branchId, req.branchId]
    );
    const shift = currentShift[0];
    const shiftId = shift?.id || null;
    if (!shiftId) return res.status(400).json({ error: 'ต้องเปิดกะก่อนเปิดบิลได้', code: 'NO_OPEN_SHIFT' });
    const branchId = shift.branch_id ?? req.branchId;
    const [r] = await pool.query(
      'INSERT INTO orders (code, status, opened_by, opened_at, shift_id, branch_id) VALUES (?, "open", ?, ?, ?, ?)',
      ['O' + Date.now() + '-' + Math.floor(Math.random() * 10000), req.user.id, openedAt, shiftId, branchId]
    );
    const orderId = r.insertId;
    await pool.query('UPDATE orders SET code = ? WHERE id = ?', ['O' + orderId, orderId]);
    const [rows] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/:id
router.get('/:id', requireAll, requireBranch, param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const [orders] = await pool.query(
      'SELECT * FROM orders WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))',
      [req.params.id, req.branchId, req.branchId]
    );
    const order = orders[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [req.params.id]);
    res.json({ ...order, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/:id/items (เพิ่มสินค้า)
router.post(
  '/:id/items',
  requireAll,
  requireBranch,
  param('id').isInt(),
  body('product_id').isInt(),
  body('qty').isFloat({ min: 0.01 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [orders] = await conn.query(
        'SELECT * FROM orders WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL)) FOR UPDATE',
        [req.params.id, req.branchId, req.branchId]
      );
      const order = orders[0];
      if (!order) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Order not found' });
      }
      if (order.status !== 'open') {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Order is not open' });
      }
      const [products] = await conn.query('SELECT * FROM products WHERE id = ? AND is_active = 1 FOR UPDATE', [req.body.product_id]);
      const product = products[0];
      if (!product) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Product not found or inactive' });
      }
      const qty = Number(req.body.qty);
      const unit_price = Number(product.price);
      const unit_cost = Number(product.cost) || 0;
      const amount = Math.round(qty * unit_price * 100) / 100;
      if (product.stock_qty != null) {
        const stockQty = Number(product.stock_qty);
        if (stockQty < qty) {
          await conn.rollback();
          conn.release();
          return res.status(400).json({ error: `สต็อกไม่พอ (คงเหลือ ${stockQty} ${product.unit || 'หน่วย'})` });
        }
        await conn.query('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?', [qty, product.id]);
      }
      await conn.query(
        `INSERT INTO order_items (order_id, item_type, ref_id, name, qty, unit_price, unit_cost, amount, meta_json)
         VALUES (?, 'product', ?, ?, ?, ?, ?, ?, NULL)`,
        [req.params.id, product.id, product.name, qty, unit_price, unit_cost, amount]
      );
      const [sumRows] = await conn.query(
        'SELECT COALESCE(SUM(amount), 0) AS subtotal FROM order_items WHERE order_id = ?',
        [req.params.id]
      );
      const subtotal = Number(sumRows[0].subtotal);
      await conn.query(
        'UPDATE orders SET subtotal = ?, total = ? WHERE id = ?',
        [subtotal, subtotal, req.params.id]
      );
      await conn.commit();
      const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id DESC LIMIT 1', [req.params.id]);
      res.status(201).json(items[0]);
    } catch (err) {
      await conn.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  }
);

// PATCH /api/orders/:id/items/:item_id — แก้จำนวน; คืนสต็อกเมื่อลด qty / ตัดสต็อกเมื่อเพิ่ม qty
router.patch(
  '/:id/items/:item_id',
  requireAll,
  requireBranch,
  param('id').isInt(),
  param('item_id').isInt(),
  body('qty').optional().isFloat({ min: 0.01 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const conn = await pool.getConnection();
    try {
      const [orders] = await conn.query(
        'SELECT * FROM orders WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))',
        [req.params.id, req.branchId, req.branchId]
      );
      const order = orders[0];
      if (!order) {
        conn.release();
        return res.status(404).json({ error: 'Order not found' });
      }
      if (order.status !== 'open') {
        conn.release();
        return res.status(400).json({ error: 'Order is not open' });
      }
      const [itemRows] = await conn.query('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [req.params.item_id, req.params.id]);
      const orderItem = itemRows[0];
      if (!orderItem) {
        conn.release();
        return res.status(404).json({ error: 'Item not found' });
      }
      if (orderItem.item_type === 'table_time') {
        conn.release();
        return res.status(400).json({ error: 'Cannot edit table_time item' });
      }
      const oldQty = Number(orderItem.qty) || 0;
      const newQty = req.body.qty !== undefined ? Number(req.body.qty) : oldQty;
      if (orderItem.item_type === 'product' && orderItem.ref_id != null) {
        const diff = newQty - oldQty;
        if (diff > 0) {
          const [products] = await conn.query('SELECT id, stock_qty FROM products WHERE id = ? AND is_active = 1', [orderItem.ref_id]);
          const product = products[0];
          if (product && product.stock_qty != null) {
            const stockQty = Number(product.stock_qty);
            if (stockQty < diff) {
              conn.release();
              return res.status(400).json({ error: `สต็อกไม่พอ (คงเหลือ ${stockQty})` });
            }
            await conn.query('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?', [diff, orderItem.ref_id]);
          }
        } else if (diff < 0) {
          await conn.query(
            'UPDATE products SET stock_qty = COALESCE(stock_qty, 0) + ? WHERE id = ? AND stock_qty IS NOT NULL',
            [-diff, orderItem.ref_id]
          );
        }
      }
      const amount = Math.round(newQty * Number(orderItem.unit_price) * 100) / 100;
      await conn.query(
        'UPDATE order_items SET qty = ?, amount = ? WHERE id = ? AND order_id = ?',
        [newQty, amount, req.params.item_id, req.params.id]
      );
      const [sumRows] = await conn.query(
        'SELECT COALESCE(SUM(amount), 0) AS subtotal FROM order_items WHERE order_id = ?',
        [req.params.id]
      );
      const subtotal = Number(sumRows[0].subtotal);
      await conn.query('UPDATE orders SET subtotal = ?, total = ? WHERE id = ?', [subtotal, subtotal, req.params.id]);
      const [rows] = await conn.query('SELECT * FROM order_items WHERE id = ?', [req.params.item_id]);
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  }
);

// DELETE /api/orders/:id/items/:item_id — ลบรายการและคืนสต็อก; order.subtotal/total อัปเดตจาก SUM(order_items.amount) เท่านั้น
router.delete(
  '/:id/items/:item_id',
  requireAll,
  requireBranch,
  param('id').isInt(),
  param('item_id').isInt(),
  async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [orders] = await conn.query(
        'SELECT * FROM orders WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL)) FOR UPDATE',
        [req.params.id, req.branchId, req.branchId]
      );
      const order = orders[0];
      if (!order) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Order not found' });
      }
      if (order.status !== 'open') {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Order is not open' });
      }
      const [itemRows] = await conn.query('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [req.params.item_id, req.params.id]);
      const orderItem = itemRows[0];
      if (!orderItem) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Item not found' });
      }
      if (orderItem.item_type === 'table_time') {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Cannot delete table_time item' });
      }
      if (orderItem.item_type === 'product' && orderItem.ref_id != null) {
        const qty = Number(orderItem.qty) || 0;
        if (qty > 0) {
          await conn.query(
            'UPDATE products SET stock_qty = COALESCE(stock_qty, 0) + ? WHERE id = ? AND stock_qty IS NOT NULL',
            [qty, orderItem.ref_id]
          );
        }
      }
      await conn.query('DELETE FROM order_items WHERE id = ? AND order_id = ?', [req.params.item_id, req.params.id]);
      const [sumRows] = await conn.query(
        'SELECT COALESCE(SUM(amount), 0) AS subtotal FROM order_items WHERE order_id = ?',
        [req.params.id]
      );
      const subtotal = Number(sumRows[0].subtotal);
      await conn.query('UPDATE orders SET subtotal = ?, total = ? WHERE id = ?', [subtotal, subtotal, req.params.id]);
      await conn.commit();
      res.status(204).send();
    } catch (err) {
      await conn.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  }
);

// POST /api/orders/:id/checkout — แหล่งเดียวที่ตั้ง order.discount + order.total (total = subtotal - discount); ยอดขายในรายงานใช้ order.total
router.post(
  '/:id/checkout',
  requireAll,
  requireBranch,
  param('id').isInt(),
  body('discount').optional().isFloat({ min: 0 }),
  body('member_id').optional().isInt({ min: 1 }),
  body('phone').optional().trim(),
  body('customer_name').optional().trim(),
  body('payments').isArray(),
  body('payments.*.method').isIn(['cash', 'transfer', 'qr', 'card', 'mixed']),
  body('payments.*.amount').isFloat({ min: 0 }),
  body('payments.*.ref_no').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const first = errors.array()[0];
      return res.status(400).json({ error: first?.msg || 'Validation failed', errors: errors.array() });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [orders] = await conn.query(
        'SELECT * FROM orders WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL)) FOR UPDATE',
        [req.params.id, req.branchId, req.branchId]
      );
      const order = orders[0];
      if (!order) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Order not found' });
      }
      if (order.status !== 'open') {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Order is not open' });
      }
      const discount = Number(req.body.discount) || 0;
      const orderTotal = Math.max(0, Number(order.subtotal) - discount);

      let debtBalance = 0;
      let debtId = null;
      const memberId = req.body.member_id ? Number(req.body.member_id) : null;
      const phone = (req.body.phone || '').trim();
      if (memberId || phone) {
        if (memberId) {
          const [dr] = await conn.query(
            'SELECT id, balance FROM member_debts WHERE member_id = ? AND branch_id = ? AND balance > 0',
            [memberId, req.branchId]
          );
          if (dr[0]) {
            debtBalance = Number(dr[0].balance);
            debtId = dr[0].id;
          }
        } else {
          const [dr] = await conn.query(
            'SELECT id, balance FROM member_debts WHERE phone = ? AND branch_id = ? AND balance > 0',
            [phone, req.branchId]
          );
          if (dr[0]) {
            debtBalance = Number(dr[0].balance);
            debtId = dr[0].id;
          }
        }
      }

      const totalRequired = orderTotal + debtBalance;
      const payments = req.body.payments || [];
      const payTotal = payments.reduce((s, p) => s + Number(p.amount), 0);
      const isPartialPay = payTotal < totalRequired - 0.01;

      if (isPartialPay) {
        if (!memberId && !phone) {
          await conn.rollback();
          conn.release();
          return res.status(400).json({ error: 'ການຈ່າຍບໍ່ຄົບຕ້ອງເລືອກສະມາຊິກ ຫຼື ປ້ອນເບີໂທເພື່ອບັນທຶກຫນີ' });
        }
        if (payTotal < 0) {
          await conn.rollback();
          conn.release();
          return res.status(400).json({ error: 'ຈຳນວນຈ່າຍບໍ່ຖືກຕ້ອງ' });
        }
      } else if (Math.abs(payTotal - totalRequired) > 0.01) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({
          error: totalRequired > orderTotal
            ? `ยอดที่จ่ายต้องเท่ากับ บิล (${orderTotal}) + หนี้ค้าง (${debtBalance}) = ${totalRequired}`
            : 'Payment total does not match order total',
        });
      }

      const paidAt = new Date();
      const firstPay = payments[0];

      // คำนวณยอดจ่ายหนี้เก่า vs ยอดจ่ายบิล (ทั้งจ่ายเต็มและจ่ายไม่ครบ)
      // orderPaid = ยอดที่จ่ายเข้าบิล; payTotal = ยอดที่จ่ายรวม; debtPaid = ยอดที่ชำระหนี้เก่า
      let debtPaid = 0;
      let orderPaid = payTotal; // เริ่มจากยอดที่จ่ายทั้งหมดไปเข้าบิล
      if (debtId != null && debtBalance > 0 && payTotal > 0) {
        debtPaid = Math.min(debtBalance, payTotal);
        orderPaid = payTotal - debtPaid;
      }

      // ชำระหนี้เก่า (ถ้ามี)
      if (debtId != null && debtPaid > 0) {
        await conn.query(
          'UPDATE member_debts SET balance = balance - ?, updated_at = NOW() WHERE id = ?',
          [debtPaid, debtId]
        );
        await conn.query(
          'INSERT INTO debt_transactions (member_debt_id, type, amount, order_id, note, created_by) VALUES (?, ?, ?, ?, ?, ?)',
          [debtId, 'payment', debtPaid, req.params.id, 'ชำระหนี้รวมกับบิล', req.user.id]
        );
      }

      // สร้างหนี้ใหม่ (กรณีຈ່າຍບໍ່ຄົບ)
      const newDebtAmount = Math.max(0, orderTotal - orderPaid);
      const customerName = (req.body.customer_name || '').trim() || null;
      if (newDebtAmount > 0 && (memberId || phone)) {
        let newDebtId = null;
        let [existingDebt] = [];
        if (memberId) {
          [existingDebt] = await conn.query(
            'SELECT id FROM member_debts WHERE member_id = ? AND branch_id = ?',
            [memberId, req.branchId]
          );
        } else {
          [existingDebt] = await conn.query(
            'SELECT id FROM member_debts WHERE phone = ? AND branch_id = ? AND member_id IS NULL',
            [phone, req.branchId]
          );
        }
        if (existingDebt[0]) {
          newDebtId = existingDebt[0].id;
          await conn.query(
            'UPDATE member_debts SET balance = balance + ?, updated_at = NOW() WHERE id = ?',
            [newDebtAmount, newDebtId]
          );
        } else {
          const [r] = await conn.query(
            'INSERT INTO member_debts (member_id, phone, customer_name, branch_id, balance) VALUES (?, ?, ?, ?, ?)',
            [memberId || null, phone || null, customerName || null, req.branchId, newDebtAmount]
          );
          newDebtId = r.insertId;
        }
        await conn.query(
          'INSERT INTO debt_transactions (member_debt_id, type, amount, order_id, note, created_by) VALUES (?, ?, ?, ?, ?, ?)',
          [newDebtId, 'debt', newDebtAmount, req.params.id, 'ບິນ #' + order.code + ' ຈ່າຍບໍ່ຄົບ', req.user.id]
        );
      }

      // บันทึกการจ่ายบิล (ยอดที่จ่ายจริง)
      await conn.query(
        'INSERT INTO payments (order_id, method, amount, ref_no, paid_at, paid_by) VALUES (?, ?, ?, ?, ?, ?)',
        [req.params.id, firstPay?.method || 'cash', orderPaid, firstPay?.ref_no || null, paidAt, req.user.id]
      );

      await conn.query(
        'UPDATE orders SET status = ?, discount = ?, total = ?, closed_by = ?, closed_at = ? WHERE id = ?',
        ['paid', discount, orderTotal, req.user.id, paidAt, req.params.id]
      );
      const [sessionsWithTable] = await conn.query(
        'SELECT table_id FROM sessions WHERE order_id = ? AND table_id IS NOT NULL',
        [req.params.id]
      );
      const tableIdsToSync = [];
      for (const row of sessionsWithTable) {
        await conn.query(
          'UPDATE `tables` SET status = ?, active_session_id = NULL WHERE id = ?',
          ['available', row.table_id]
        );
        tableIdsToSync.push(row.table_id);
      }
      await conn.commit();
      const branchId = req.branchId;
      for (const tid of tableIdsToSync) {
        pool.query('SELECT id, code, port FROM `tables` WHERE id = ?', [tid]).then(([tRows]) => {
          if (tRows[0]) syncTableToEsp32({ ...tRows[0], status: 'available' }, branchId);
        }).catch(() => {});
      }
      const [rows] = await pool.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
      const [payRows] = await pool.query('SELECT * FROM payments WHERE order_id = ?', [req.params.id]);
      res.json({ order: rows[0], payments: payRows });
    } catch (err) {
      await conn.rollback();
      console.error('[orders checkout]', err.message);
      res.status(500).json({ error: err.message || 'ຈ່າຍບໍ່ສຳເລັດ' });
    } finally {
      conn.release();
    }
  }
);

export default router;
