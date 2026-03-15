import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireManager, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

// GET /api/payment-banks — รายการธนาคารสำหรับ QR, แยกตามสาขา
router.get('/', requireAll, requireBranch, async (req, res) => {
  try {
    const bid = req.branchId;
    const [rows] = await pool.query(
      'SELECT id, name, qr_image_url, account_no, sort_order FROM payment_banks WHERE branch_id = ? OR (branch_id IS NULL AND ? IS NULL) ORDER BY sort_order ASC, id ASC',
      [bid, bid]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment-banks — เพิ่มธนาคาร
router.post(
  '/',
  requireManager,
  requireBranch,
  body('name').trim().notEmpty(),
  body('qr_image_url').trim().notEmpty(),
  body('account_no').optional().trim(),
  body('sort_order').optional().isInt({ min: 0 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const first = errors.array()[0];
      return res.status(400).json({ error: first?.msg || 'Validation failed', errors: errors.array() });
    }
    try {
      const name = req.body.name.trim();
      const qr_image_url = req.body.qr_image_url.trim();
      const account_no = req.body.account_no?.trim() || null;
      const sort_order = Number(req.body.sort_order) || 0;
      const branchId = req.branchId;
      const [r] = await pool.query(
        'INSERT INTO payment_banks (name, qr_image_url, account_no, sort_order, branch_id) VALUES (?, ?, ?, ?, ?)',
        [name, qr_image_url, account_no, sort_order, branchId]
      );
      const [rows] = await pool.query('SELECT id, name, qr_image_url, account_no, sort_order FROM payment_banks WHERE id = ?', [
        r.insertId,
      ]);
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/payment-banks/:id
router.patch(
  '/:id',
  requireManager,
  requireBranch,
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('qr_image_url').optional().trim().notEmpty(),
  body('account_no').optional().trim(),
  body('sort_order').optional().isInt({ min: 0 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const first = errors.array()[0];
      return res.status(400).json({ error: first?.msg || 'Validation failed', errors: errors.array() });
    }
    try {
      const updates = [];
      const values = [];
      if (req.body.name !== undefined) {
        updates.push('name = ?');
        values.push(req.body.name.trim());
      }
      if (req.body.qr_image_url !== undefined) {
        updates.push('qr_image_url = ?');
        values.push(req.body.qr_image_url.trim());
      }
      if (req.body.account_no !== undefined) {
        updates.push('account_no = ?');
        values.push(req.body.account_no?.trim() || null);
      }
      if (req.body.sort_order !== undefined) {
        updates.push('sort_order = ?');
        values.push(Number(req.body.sort_order));
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(req.params.id, req.branchId, req.branchId);
      await pool.query(`UPDATE payment_banks SET ${updates.join(', ')} WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))`, values);
      const [rows] = await pool.query(
        'SELECT id, name, qr_image_url, account_no, sort_order FROM payment_banks WHERE id = ?',
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/payment-banks/:id
router.delete('/:id', requireManager, requireBranch, param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const [r] = await pool.query('DELETE FROM payment_banks WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))', [req.params.id, req.branchId, req.branchId]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
