import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAdmin, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(requireAll);
router.use(branchMiddleware);

// GET /api/stock-adjustments/pending-count — admin
router.get('/pending-count', requireBranch, requireAdmin, async (req, res) => {
  try {
    const bid = req.branchId;
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS n FROM stock_adjustments WHERE status = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))',
      ['pending', bid, bid]
    );
    res.json({ count: Number(rows[0]?.n || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stock-adjustments?status=pending
router.get('/', requireBranch, async (req, res) => {
  try {
    const bid = req.branchId;
    const status = req.query.status || 'pending';
    const [rows] = await pool.query(
      `SELECT s.id, s.product_id, s.old_qty, s.new_qty, s.min_stock, s.note, s.status, s.requested_at,
              u.username AS requested_by_username, p.name AS product_name, p.unit
       FROM stock_adjustments s
       JOIN users u ON u.id = s.requested_by
       JOIN products p ON p.id = s.product_id
       WHERE (s.branch_id = ? OR (s.branch_id IS NULL AND ? IS NULL))
         AND s.status = ?
       ORDER BY s.requested_at DESC, s.id DESC
       LIMIT 200`,
      [bid, bid, status]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stock-adjustments — user/manager ສົ່ງຄຳຂໍ
router.post(
  '/',
  requireBranch,
  body('product_id').isInt({ min: 1 }),
  body('new_qty').isFloat({ min: 0 }),
  body('min_stock').optional().isFloat({ min: 0 }),
  body('note').optional().trim().isLength({ max: 500 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const bid = req.branchId;
      const { product_id, new_qty, min_stock, note } = req.body;
      const [prods] = await pool.query(
        'SELECT id, stock_qty FROM products WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))',
        [product_id, bid, bid]
      );
      if (!prods[0]) return res.status(404).json({ error: 'ບໍ່ພົບສິນຄ້າ' });
      const oldQty = Number(prods[0].stock_qty) || 0;
      await pool.query(
        'INSERT INTO stock_adjustments (product_id, branch_id, old_qty, new_qty, min_stock, note, status, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [product_id, bid, oldQty, Number(new_qty), min_stock ?? null, note || null, 'pending', req.user.id]
      );
      const [rows] = await pool.query(
        `SELECT s.id, s.product_id, s.old_qty, s.new_qty, s.min_stock, s.note, s.status, s.requested_at,
                u.username AS requested_by_username, p.name AS product_name, p.unit
         FROM stock_adjustments s
         JOIN users u ON u.id = s.requested_by
         JOIN products p ON p.id = s.product_id
         WHERE s.id = LAST_INSERT_ID()`
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/stock-adjustments/:id/approve — admin
router.post(
  '/:id/approve',
  requireBranch,
  requireAdmin,
  param('id').isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const bid = req.branchId;
      const [rows] = await pool.query(
        'SELECT * FROM stock_adjustments WHERE id = ? AND status = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))',
        [req.params.id, 'pending', bid, bid]
      );
      const adj = rows[0];
      if (!adj) return res.status(404).json({ error: 'ບໍ່ພົບຄຳຂໍ ຫຼື ອະນຸມັດແລ້ວ' });
      await pool.query('UPDATE products SET stock_qty = ?, min_stock = COALESCE(?, min_stock) WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))', [
        Number(adj.new_qty),
        adj.min_stock,
        adj.product_id,
        bid,
        bid,
      ]);
      await pool.query('UPDATE stock_adjustments SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?', [
        'approved',
        req.user.id,
        req.params.id,
      ]);
      const [updated] = await pool.query(
        `SELECT s.*, u.username AS requested_by_username, p.name AS product_name, p.unit
         FROM stock_adjustments s
         JOIN users u ON u.id = s.requested_by
         JOIN products p ON p.id = s.product_id
         WHERE s.id = ?`,
        [req.params.id]
      );
      res.json(updated[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/stock-adjustments/:id/reject — admin
router.post(
  '/:id/reject',
  requireBranch,
  requireAdmin,
  param('id').isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const bid = req.branchId;
      const [r] = await pool.query(
        'UPDATE stock_adjustments SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ? AND status = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))',
        ['rejected', req.user.id, req.params.id, 'pending', bid, bid]
      );
      if (r.affectedRows === 0) return res.status(404).json({ error: 'ບໍ່ພົບຄຳຂໍ ຫຼື ອະນຸມັດແລ້ວ' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
