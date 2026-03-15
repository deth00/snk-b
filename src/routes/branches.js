import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/branches — admin เห็นทั้งหมด, manager เห็นสาขาของร้าน, user เห็นเฉพาะสาขาของตัวเอง
router.get('/', async (req, res) => {
  try {
    let sql = 'SELECT b.id, b.code, b.name, b.address, b.phone, b.store_id, b.is_active, b.created_at FROM branches b WHERE b.is_active = 1';
    const params = [];
    if (req.user.role === 'manager' && req.user.store_id) {
      sql += ' AND b.store_id = ?';
      params.push(req.user.store_id);
    } else if (req.user.role === 'user' && req.user.branch_id != null) {
      sql += ' AND b.id = ?';
      params.push(req.user.branch_id);
    }
    sql += ' ORDER BY b.code';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/branches (admin เท่านั้น)
router.post(
  '/',
  requireAdmin,
  body('code').trim().notEmpty(),
  body('name').trim().notEmpty(),
  body('address').optional().trim(),
  body('phone').optional().trim(),
  body('store_id').optional().isInt(),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { code, name, address, phone, store_id, is_active = true } = req.body;
      try {
        await pool.query(
          'INSERT INTO branches (code, name, address, phone, store_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
          [code, name, address || null, phone || null, store_id || null, is_active]
        );
      } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
          await pool.query(
            'INSERT INTO branches (code, name, address, phone, is_active) VALUES (?, ?, ?, ?, ?)',
            [code, name, address || null, phone || null, is_active]
          );
        } else throw e;
      }
      const [rows] = await pool.query('SELECT * FROM branches WHERE id = LAST_INSERT_ID()');
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'รหัสสาขาซ้ำ' });
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/branches/:id
router.patch(
  '/:id',
  requireAdmin,
  param('id').isInt(),
  body('code').optional().trim().notEmpty(),
  body('name').optional().trim().notEmpty(),
  body('address').optional().trim(),
  body('phone').optional().trim(),
  body('store_id').optional().isInt(),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const allowed = ['code', 'name', 'address', 'phone', 'store_id', 'is_active'];
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
      await pool.query(`UPDATE branches SET ${updates.join(', ')} WHERE id = ?`, values);
      const [rows] = await pool.query('SELECT * FROM branches WHERE id = ?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Branch not found' });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'รหัสสาขาซ้ำ' });
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
