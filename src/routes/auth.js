import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { signToken, authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /api/auth/setup-available — ใช้ได้เมื่อยังไม่มี user (ไม่ต้อง auth)
router.get('/setup-available', async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM users');
    res.json({ setupAvailable: row.n === 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/setup — สร้างผู้ใช้คนแรก (admin) ได้เฉพาะเมื่อยังไม่มี user
router.post(
  '/setup',
  body('username').trim().notEmpty().isLength({ min: 2, max: 50 }),
  body('password').notEmpty().isLength({ min: 6 }),
  body('display_name').optional().trim().isLength({ max: 100 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM users');
      if (count.n > 0) {
        return res.status(403).json({ error: 'ລະບົບມີຜູ້ໃຊ້ແລ້ວ' });
      }
      const { username, password, display_name } = req.body;
      const password_hash = await bcrypt.hash(password, 10);
      await pool.query(
        'INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)',
        [username.trim(), password_hash, 'admin', display_name?.trim() || username.trim()]
      );
      const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username.trim()]);
      const user = rows[0];
      const token = signToken(user);
      res.status(201).json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          display_name: user.display_name,
          branch_id: user.branch_id,
        },
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: 'ຊື່ຜູ້ໃຊ້ນີ້ມີແລ້ວ' });
      }
      res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  '/login',
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { username, password } = req.body;
    const [rows] = await pool.query(
      'SELECT id, username, password_hash, role, display_name FROM users WHERE username = ? AND is_active = 1',
      [username]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = signToken(user);
    const [u] = await pool.query('SELECT * FROM users WHERE id = ?', [user.id]);
    res.json({
      token,
      user: {
        id: u[0].id,
        username: u[0].username,
        role: u[0].role,
        display_name: u[0].display_name,
        branch_id: u[0].branch_id,
      },
    });
  }
);

router.get('/me', authMiddleware, (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id,
      username: u.username,
      role: u.role,
      display_name: u.display_name ?? null,
      branch_id: u.branch_id != null ? Number(u.branch_id) : null,
    },
  });
});

export default router;
