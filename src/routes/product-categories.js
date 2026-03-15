import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireManager } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

// GET /api/product-categories — ต้องส่ง X-Branch-Id, แยกตามสาขา
router.get('/', requireBranch, async (req, res) => {
  try {
    const bid = req.branchId;
    const [rows] = await pool.query(
      'SELECT id, name, sort_order, is_active, created_at, updated_at FROM product_categories WHERE branch_id = ? OR (branch_id IS NULL AND ? IS NULL) ORDER BY sort_order, name',
      [bid, bid]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/product-categories
router.post(
  '/',
  requireManager,
  requireBranch,
  body('name').trim().notEmpty(),
  body('sort_order').optional().isInt({ min: 0 }),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { name, sort_order = 0, is_active = true } = req.body;
      const branchId = req.branchId;
      await pool.query(
        'INSERT INTO product_categories (name, sort_order, is_active, branch_id) VALUES (?, ?, ?, ?)',
        [name, sort_order, is_active, branchId]
      );
      const [rows] = await pool.query('SELECT * FROM product_categories WHERE id = LAST_INSERT_ID()');
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/product-categories/:id
router.patch(
  '/:id',
  requireManager,
  requireBranch,
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('sort_order').optional().isInt({ min: 0 }),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const allowed = ['name', 'sort_order', 'is_active'];
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
      await pool.query(`UPDATE product_categories SET ${updates.join(', ')} WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))`, values);
      const [rows] = await pool.query('SELECT * FROM product_categories WHERE id = ?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Category not found' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
