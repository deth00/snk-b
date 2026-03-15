import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireManager } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

// GET /api/products — ต้องส่ง X-Branch-Id, แยกตามสาขา
router.get('/', requireBranch, async (req, res) => {
  try {
    const bid = req.branchId;
    let sql = `
      SELECT p.id, p.sku, p.name, p.image_url, p.category_id, p.unit, p.price, p.cost, p.stock_qty, p.min_stock, p.is_active, p.created_at, p.updated_at,
             c.name AS category_name
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id AND (c.branch_id = ? OR (c.branch_id IS NULL AND ? IS NULL))
      WHERE (p.branch_id = ? OR (p.branch_id IS NULL AND ? IS NULL))
    `;
    const params = [bid, bid, bid, bid];
    if (req.query.category_id != null && req.query.category_id !== '') {
      sql += ' AND p.category_id = ?';
      params.push(req.query.category_id);
    }
    if (req.query.unit != null && req.query.unit !== '') {
      sql += ' AND p.unit = ?';
      params.push(req.query.unit);
    }
    if (req.query.include_inactive !== '1') {
      sql += ' AND (p.is_active = 1 OR p.is_active IS NULL)';
    }
    sql += ' ORDER BY c.sort_order, c.name, p.name';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products
router.post(
  '/',
  requireManager,
  requireBranch,
  body('name').trim().notEmpty(),
  body('price').isFloat({ min: 0 }),
  body('sku').optional().trim(),
  body('category_id').optional().isInt(),
  body('unit').optional().trim().notEmpty(),
  body('cost').optional().isFloat({ min: 0 }),
  body('stock_qty').optional().isFloat({ min: 0 }),
  body('is_active').optional().isBoolean(),
  body('image_url').optional().trim().isLength({ max: 500 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { name, price, sku, category_id, unit, cost, stock_qty, min_stock, is_active = true, image_url } = req.body;
      const unitVal = (unit && String(unit).trim()) || 'ชิ้น';
      const branchId = req.branchId;
      await pool.query(
        'INSERT INTO products (name, image_url, category_id, unit, price, sku, cost, stock_qty, min_stock, is_active, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, image_url || null, category_id || null, unitVal, price, sku || null, cost ?? null, stock_qty ?? null, min_stock ?? 5, is_active, branchId]
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
  requireManager,
  requireBranch,
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('price').optional().isFloat({ min: 0 }),
  body('sku').optional().trim(),
  body('category_id').optional().isInt(),
  body('unit').optional().trim().notEmpty(),
  body('cost').optional().isFloat({ min: 0 }),
  body('stock_qty').optional().isFloat({ min: 0 }),
  body('min_stock').optional().isFloat({ min: 0 }),
  body('is_active').optional().isBoolean(),
  body('image_url').optional().trim().isLength({ max: 500 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const allowed = ['name', 'price', 'sku', 'category_id', 'unit', 'cost', 'stock_qty', 'min_stock', 'is_active', 'image_url'];
      const updates = [];
      const values = [];
      for (const k of allowed) {
        if (req.body[k] !== undefined) {
          updates.push(`${k} = ?`);
          values.push(req.body[k]);
        }
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(req.params.id, req.branchId, req.branchId);
      await pool.query(`UPDATE products SET ${updates.join(', ')} WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))`, values);
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

// PATCH /api/products/:id/stock — ปรับสต็อก
router.patch(
  '/:id/stock',
  requireManager,
  requireBranch,
  param('id').isInt(),
  body('adjust').isFloat(),
  body('note').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const [products] = await pool.query('SELECT id, stock_qty FROM products WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))', [req.params.id, req.branchId, req.branchId]);
      const product = products[0];
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const current = Number(product.stock_qty) || 0;
      const adjust = Number(req.body.adjust);
      const newQty = Math.max(0, current + adjust);
      await pool.query('UPDATE products SET stock_qty = ? WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))', [newQty, req.params.id, req.branchId, req.branchId]);
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
