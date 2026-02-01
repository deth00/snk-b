import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { signToken, authMiddleware } from '../middleware/auth.js';

const router = Router();

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
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
      },
    });
  }
);

router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

export default router;
