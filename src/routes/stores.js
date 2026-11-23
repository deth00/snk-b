import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAdmin, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/stores — admin เห็นทั้งหมด, manager เห็นเฉพาะร้านของตัวเอง
router.get('/', async (req, res) => {
  try {
    let sql = 'SELECT id, name, logo, address, phone, tax_id, email, is_active, created_at FROM stores WHERE 1=1';
    const params = [];
    if (req.user.role === 'manager' && req.user.store_id) {
      sql += ' AND id = ?';
      params.push(req.user.store_id);
    }
    sql += ' ORDER BY name';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stores/:id
router.get('/:id', param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    let sql = 'SELECT * FROM stores WHERE id = ?';
    const params = [req.params.id];
    if (req.user.role === 'manager' && req.user.store_id) {
      sql += ' AND id = ?';
      params.push(req.user.store_id);
    }
    const [rows] = await pool.query(sql, params);
    if (!rows[0]) return res.status(404).json({ error: 'Store not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stores/:id/branches — สาขาทั้งหมดของร้าน (สำหรับ admin ร้านกวดสอ)
router.get('/:id/branches', param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    let sql = 'SELECT id, code, name, address, phone, is_active FROM branches WHERE store_id = ?';
    const params = [req.params.id];
    if (req.user.role === 'manager' && req.user.store_id) {
      if (Number(req.params.id) !== Number(req.user.store_id)) {
        return res.status(403).json({ error: 'ไม่สามารถเข้าถึงร้านนี้ได้' });
      }
    }
    sql += ' ORDER BY code';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stores (admin เท่านั้น)
router.post(
  '/',
  requireAdmin,
  body('name').trim().notEmpty(),
  body('logo').optional().trim(),
  body('address').optional().trim(),
  body('phone').optional().trim(),
  body('tax_id').optional().trim(),
  body('email').optional().trim().isEmail(),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { name, logo, address, phone, tax_id, email, is_active = true } = req.body;
      await pool.query(
        'INSERT INTO stores (name, logo, address, phone, tax_id, email, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, logo || null, address || null, phone || null, tax_id || null, email || null, is_active]
      );
      const [rows] = await pool.query('SELECT * FROM stores WHERE id = LAST_INSERT_ID()');
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/stores/:id
router.patch(
  '/:id',
  requirePermission('stores', 'edit'),
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('logo').optional().trim(),
  body('address').optional().trim(),
  body('phone').optional().trim(),
  body('tax_id').optional().trim(),
  body('email').optional().trim().isEmail(),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      if (req.user.role === 'manager' && req.user.store_id && Number(req.params.id) !== Number(req.user.store_id)) {
        return res.status(403).json({ error: 'ไม่สามารถแก้ไขร้านนี้ได้' });
      }
      if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
      const allowed = ['name', 'logo', 'address', 'phone', 'tax_id', 'email', 'is_active'];
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
      await pool.query(`UPDATE stores SET ${updates.join(', ')} WHERE id = ?`, values);
      const [rows] = await pool.query('SELECT * FROM stores WHERE id = ?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Store not found' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
