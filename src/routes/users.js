import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import { branchMiddleware } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);
router.use(requireAdmin);

const USER_PUBLIC_FIELDS = ['id', 'username', 'role', 'display_name', 'branch_id', 'store_id', 'is_active', 'created_at', 'updated_at'];
function toPublicUser(row) {
  if (!row) return null;
  return USER_PUBLIC_FIELDS.reduce((o, k) => { o[k] = row[k]; return o; }, {});
}

// GET /api/users — แยกตามสาขา: ส่ง X-Branch-Id จะเห็นเฉพาะ users ของสาขานั้น + branch_id IS NULL
router.get('/', async (req, res) => {
  try {
    let sql = 'SELECT * FROM users';
    const params = [];
    if (req.branchId != null) {
      sql += ' WHERE branch_id = ? OR branch_id IS NULL';
      params.push(req.branchId);
    }
    sql += ' ORDER BY username';
    const [rows] = await pool.query(sql, params);
    res.json(rows.map(toPublicUser));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users
router.post(
  '/',
  body('username').trim().notEmpty().isLength({ min: 2, max: 50 }),
  body('password').notEmpty().isLength({ min: 6 }),
  body('role').optional().isIn(['admin', 'manager', 'user']),
  body('display_name').optional().trim().isLength({ max: 100 }),
  body('branch_id').optional().isInt({ min: 1 }).withMessage('branch_id must be positive integer'),
  body('store_id').optional().isInt({ min: 1 }),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { username, password, role = 'user', display_name, branch_id, store_id, is_active = true } = req.body;
      const password_hash = await bcrypt.hash(password, 10);
      const bid = branch_id != null ? Number(branch_id) : null;
      const sid = store_id != null ? Number(store_id) : null;
      try {
        await pool.query(
          'INSERT INTO users (username, password_hash, role, display_name, branch_id, store_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [username.trim(), password_hash, role, display_name?.trim() || null, bid, sid, is_active]
        );
      } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
          await pool.query(
            'INSERT INTO users (username, password_hash, role, display_name, branch_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
            [username.trim(), password_hash, role, display_name?.trim() || null, bid, is_active]
          );
        } else throw e;
      }
      const [rows] = await pool.query('SELECT * FROM users WHERE id = LAST_INSERT_ID()');
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: 'ຊື່ຜູ້ໃຊ້ນີ້ມີແລ້ວ' });
      }
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/users/:id
router.patch(
  '/:id',
  param('id').isInt(),
  body('username').optional().trim().notEmpty().isLength({ min: 2, max: 50 }),
  body('password').optional().isLength({ min: 6 }),
  body('role').optional().isIn(['admin', 'manager', 'user']),
  body('display_name').optional().trim().isLength({ max: 100 }),
  body('branch_id').optional({ nullable: true }).custom((v) => v === null || v === '' || (Number.isInteger(Number(v)) && Number(v) >= 1)),
  body('store_id').optional({ nullable: true }).custom((v) => v === null || v === '' || (Number.isInteger(Number(v)) && Number(v) >= 1)),
  body('is_active').optional().isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const id = Number(req.params.id);
      const [existing] = await pool.query('SELECT id FROM users WHERE id = ?', [id]);
      if (!existing[0]) return res.status(404).json({ error: 'User not found' });

      const updates = [];
      const values = [];
      const { username, password, role, display_name, branch_id, store_id, is_active } = req.body;

      if (username !== undefined) {
        updates.push('username = ?');
        values.push(username.trim());
      }
      if (password !== undefined && password !== '') {
        updates.push('password_hash = ?');
        values.push(await bcrypt.hash(password, 10));
      }
      if (role !== undefined) {
        updates.push('role = ?');
        values.push(role);
      }
      if (display_name !== undefined) {
        updates.push('display_name = ?');
        values.push(display_name?.trim() || null);
      }
      if (branch_id !== undefined) {
        updates.push('branch_id = ?');
        values.push(branch_id === '' || branch_id === null ? null : Number(branch_id));
      }
      if (store_id !== undefined) {
        updates.push('store_id = ?');
        values.push(store_id === '' || store_id === null ? null : Number(store_id));
      }
      if (is_active !== undefined) {
        updates.push('is_active = ?');
        values.push(is_active);
      }

      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(id);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
      const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
      res.json(toPublicUser(rows[0]));
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: 'ຊື່ຜູ້ໃຊ້ນີ້ມີແລ້ວ' });
      }
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/users/:id (ຫ້າມລົບຕົວເອງ)
router.delete('/:id', param('id').isInt(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(400).json({ error: 'ບໍ່ສາມາດລົບບັນຊີຕົວເອງໄດ້' });
    }
    const [existing] = await pool.query('SELECT id FROM users WHERE id = ?', [id]);
    if (!existing[0]) return res.status(404).json({ error: 'User not found' });
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
