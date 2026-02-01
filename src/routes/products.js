import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAdmin, requireCashier } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/products (รองรับ query ?category_id= & ?unit=)
router.get('/', async (req, res) => {
  try {
    let sql = `
      SELECT p.id, p.sku, p.name, p.category_id, p.unit, p.price, p.cost, p.stock_qty, p.is_active, p.created_at, p.updated_at,
             c.name AS category_name
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE 1=1
    `;
    const params = [];
    if (req.query.category_id != null && req.query.category_id !== '') {
      sql += ' AND p.category_id = ?';
      params.push(req.query.category_id);
    }
    if (req.query.unit != null && req.query.unit !== '') {
      sql += ' AND p.unit = ?';
      params.push(req.query.unit);
    }
    sql += ' ORDER BY c.sort_order, c.name, p.name';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products (admin)
router.post(
  '/',
  requireAdmin,
  body('name').trim().notEmpty(),
  body('price').isFloat({ min: 0 }),
  body('sku').optional().trim(),
  body('category_id').optional().isInt(),
  body('unit').optional().trim().notEmpty(),
  body('cost').optional().isFloat({ min: 0 }),
  body('stock_qty').optional().isFloat({ min: 0 }),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { name, price, sku, category_id, unit, cost, stock_qty, is_active = true } = req.body;
      const unitVal = (unit && String(unit).trim()) || 'ชิ้น';
      await pool.query(
        'INSERT INTO products (name, category_id, unit, price, sku, cost, stock_qty, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name, category_id || null, unitVal, price, sku || null, cost ?? null, stock_qty ?? null, is_active]
      );
      const [rows] = await pool.query(
        'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN product_categories c ON c.id = p.category_id WHERE p.id = LAST_INSERT_ID()'
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/products/:id
router.patch(
  '/:id',
  requireAdmin,
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('price').optional().isFloat({ min: 0 }),
  body('sku').optional().trim(),
  body('category_id').optional().isInt(),
  body('unit').optional().trim().notEmpty(),
  body('cost').optional().isFloat({ min: 0 }),
  body('stock_qty').optional().isFloat({ min: 0 }),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const allowed = ['name', 'price', 'sku', 'category_id', 'unit', 'cost', 'stock_qty', 'is_active'];
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
      await pool.query(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, values);
      const [rows] = await pool.query(
        'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN product_categories c ON c.id = p.category_id WHERE p.id = ?',
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/products/:id/stock — ปรับสต็อก (admin) เช่น +10, -5
router.patch(
  '/:id/stock',
  requireAdmin,
  param('id').isInt(),
  body('adjust').isFloat(),
  body('note').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const [products] = await pool.query('SELECT id, stock_qty FROM products WHERE id = ?', [req.params.id]);
      const product = products[0];
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const current = Number(product.stock_qty) || 0;
      const adjust = Number(req.body.adjust);
      const newQty = Math.max(0, current + adjust);
      await pool.query('UPDATE products SET stock_qty = ? WHERE id = ?', [newQty, req.params.id]);
      const [rows] = await pool.query(
        'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN product_categories c ON c.id = p.category_id WHERE p.id = ?',
        [req.params.id]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
