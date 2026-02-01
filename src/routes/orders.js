import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireCashier } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// POST /api/orders/open
router.post('/open', requireCashier, async (req, res) => {
  try {
    const openedAt = new Date();
    const [currentShift] = await pool.query('SELECT id FROM shifts WHERE closed_at IS NULL LIMIT 1');
    const shiftId = currentShift[0]?.id || null;
    const [r] = await pool.query(
      'INSERT INTO orders (code, status, opened_by, opened_at, shift_id) VALUES (?, "open", ?, ?, ?)',
      ['O' + Date.now() + '-' + Math.floor(Math.random() * 10000), req.user.id, openedAt, shiftId]
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
router.get('/:id', requireCashier, param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
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
  requireCashier,
  param('id').isInt(),
  body('product_id').isInt(),
  body('qty').isFloat({ min: 0.01 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
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
        `INSERT INTO order_items (order_id, item_type, ref_id, name, qty, unit_price, amount, meta_json)
         VALUES (?, 'product', ?, ?, ?, ?, ?, NULL)`,
        [req.params.id, product.id, product.name, qty, unit_price, amount]
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

// PATCH /api/orders/:id/items/:item_id
router.patch(
  '/:id/items/:item_id',
  requireCashier,
  param('id').isInt(),
  param('item_id').isInt(),
  body('qty').optional().isFloat({ min: 0.01 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
      const order = orders[0];
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (order.status !== 'open') return res.status(400).json({ error: 'Order is not open' });
      const [itemRows] = await pool.query('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [req.params.item_id, req.params.id]);
      const orderItem = itemRows[0];
      if (!orderItem) return res.status(404).json({ error: 'Item not found' });
      if (orderItem.item_type === 'table_time') return res.status(400).json({ error: 'Cannot edit table_time item' });
      const qty = req.body.qty !== undefined ? Number(req.body.qty) : Number(orderItem.qty);
      const amount = Math.round(qty * Number(orderItem.unit_price) * 100) / 100;
      await pool.query(
        'UPDATE order_items SET qty = ?, amount = ? WHERE id = ? AND order_id = ?',
        [qty, amount, req.params.item_id, req.params.id]
      );
      const [sumRows] = await pool.query(
        'SELECT COALESCE(SUM(amount), 0) AS subtotal FROM order_items WHERE order_id = ?',
        [req.params.id]
      );
      const subtotal = Number(sumRows[0].subtotal);
      await pool.query('UPDATE orders SET subtotal = ?, total = ? WHERE id = ?', [subtotal, subtotal, req.params.id]);
      const [rows] = await pool.query('SELECT * FROM order_items WHERE id = ?', [req.params.item_id]);
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/orders/:id/items/:item_id
router.delete(
  '/:id/items/:item_id',
  requireCashier,
  param('id').isInt(),
  param('item_id').isInt(),
  async (req, res) => {
    try {
      const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
      const order = orders[0];
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (order.status !== 'open') return res.status(400).json({ error: 'Order is not open' });
      const [itemRows] = await pool.query('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [req.params.item_id, req.params.id]);
      const orderItem = itemRows[0];
      if (!orderItem) return res.status(404).json({ error: 'Item not found' });
      if (orderItem.item_type === 'table_time') return res.status(400).json({ error: 'Cannot delete table_time item' });
      await pool.query('DELETE FROM order_items WHERE id = ? AND order_id = ?', [req.params.item_id, req.params.id]);
      const [sumRows] = await pool.query(
        'SELECT COALESCE(SUM(amount), 0) AS subtotal FROM order_items WHERE order_id = ?',
        [req.params.id]
      );
      const subtotal = Number(sumRows[0].subtotal);
      await pool.query('UPDATE orders SET subtotal = ?, total = ? WHERE id = ?', [subtotal, subtotal, req.params.id]);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/orders/:id/checkout { discount, payments:[{method,amount,ref_no}] }
router.post(
  '/:id/checkout',
  requireCashier,
  param('id').isInt(),
  body('discount').optional().isFloat({ min: 0 }),
  body('payments').isArray(),
  body('payments.*.method').isIn(['cash', 'transfer', 'qr', 'card', 'mixed']),
  body('payments.*.amount').isFloat({ min: 0.01 }),
  body('payments.*.ref_no').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
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
      const total = Math.max(0, Number(order.subtotal) - discount);
      const payments = req.body.payments || [];
      const payTotal = payments.reduce((s, p) => s + Number(p.amount), 0);
      if (Math.abs(payTotal - total) > 0.01) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Payment total does not match order total' });
      }
      const paidAt = new Date();
      for (const p of payments) {
        await conn.query(
          'INSERT INTO payments (order_id, method, amount, ref_no, paid_at, paid_by) VALUES (?, ?, ?, ?, ?, ?)',
          [req.params.id, p.method, p.amount, p.ref_no || null, paidAt, req.user.id]
        );
      }
      await conn.query(
        'UPDATE orders SET status = ?, discount = ?, total = ?, closed_by = ?, closed_at = ? WHERE id = ?',
        ['paid', discount, total, req.user.id, paidAt, req.params.id]
      );
      await conn.commit();
      const [rows] = await pool.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
      const [payRows] = await pool.query('SELECT * FROM payments WHERE order_id = ?', [req.params.id]);
      res.json({ order: rows[0], payments: payRows });
    } catch (err) {
      await conn.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  }
);

export default router;
