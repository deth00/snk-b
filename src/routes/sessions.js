import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireCashier } from '../middleware/auth.js';
import { computeSessionAmount } from '../services/sessionCalc.js';

const router = Router();
router.use(authMiddleware);

// POST /api/sessions/start { table_id, rate_id }
router.post(
  '/start',
  requireCashier,
  body('table_id').isInt(),
  body('rate_id').isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const conn = await pool.getConnection();
    let orderId;
    try {
      await conn.beginTransaction();
      const { table_id, rate_id } = req.body;
      const [tables] = await conn.query('SELECT * FROM `tables` WHERE id = ? FOR UPDATE', [table_id]);
      const table = tables[0];
      if (!table) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Table not found' });
      }
      if (table.status !== 'available') {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Table is not available' });
      }
      const [rates] = await conn.query('SELECT * FROM rates WHERE id = ? AND is_active = 1', [rate_id]);
      if (!rates[0]) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Rate not found or inactive' });
      }
      const startedAt = new Date();
      const [currentShift] = await conn.query('SELECT id FROM shifts WHERE closed_at IS NULL LIMIT 1');
      const shiftId = currentShift[0]?.id || null;
      const [orderResult] = await conn.query(
        'INSERT INTO orders (code, status, opened_by, opened_at, shift_id) VALUES (?, "open", ?, ?, ?)',
        ['O' + Date.now() + '-' + Math.floor(Math.random() * 10000), req.user.id, startedAt, shiftId]
      );
      orderId = orderResult.insertId;
      await conn.query('UPDATE orders SET code = ? WHERE id = ?', ['O' + orderId, orderId]);
      const [sessionResult] = await conn.query(
        `INSERT INTO sessions (table_id, rate_id, order_id, status, started_at, opened_by)
         VALUES (?, ?, ?, 'running', ?, ?)`,
        [table_id, rate_id, orderId, startedAt, req.user.id]
      );
      const sessionId = sessionResult.insertId;
      await conn.query(
        'UPDATE `tables` SET status = ?, active_session_id = ? WHERE id = ?',
        ['playing', sessionId, table_id]
      );
      await conn.commit();
      const [rows] = await pool.query(
        'SELECT s.*, r.name AS rate_name, r.price_per_unit FROM sessions s JOIN rates r ON r.id = s.rate_id WHERE s.id = ?',
        [sessionId]
      );
      res.status(201).json({ session: rows[0], order_id: orderId });
    } catch (err) {
      await conn.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  }
);

// GET /api/sessions/:id (ยอดวิ่ง realtime: minutes, units, amount_preview)
router.get('/:id', requireCashier, param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const [sessions] = await pool.query(
      'SELECT s.*, r.name AS rate_name, r.price_per_unit, r.minimum_units, r.rounding_minutes, r.rounding_mode FROM sessions s JOIN rates r ON r.id = s.rate_id WHERE s.id = ?',
      [req.params.id]
    );
    const session = sessions[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    let amount_preview = null;
    if (session.status === 'running' || session.status === 'paused') {
      amount_preview = computeSessionAmount(session, session, new Date());
    } else if (session.computed_minutes != null) {
      amount_preview = {
        minutes: session.computed_minutes,
        units: Number(session.computed_units),
        amount: Number(session.computed_amount),
      };
    }
    res.json({ ...session, amount_preview });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/:id/pause — บันทึกแค่ paused_at
router.post('/:id/pause', requireCashier, param('id').isInt(), async (req, res) => {
  try {
    const [sessions] = await pool.query('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
    const session = sessions[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'running') return res.status(400).json({ error: 'Session is not running' });
    const pausedAt = new Date();
    await pool.query(
      'UPDATE sessions SET status = ?, paused_at = ? WHERE id = ?',
      ['paused', pausedAt, req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/:id/resume — บวก (now - paused_at) เข้า paused_seconds แล้ว clear paused_at
router.post('/:id/resume', requireCashier, param('id').isInt(), async (req, res) => {
  try {
    const [sessions] = await pool.query('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
    const session = sessions[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'paused') return res.status(400).json({ error: 'Session is not paused' });
    const now = new Date();
    const pausedAt = new Date(session.paused_at);
    const extraPaused = Math.floor((now - pausedAt) / 1000);
    const newPausedSeconds = (Number(session.paused_seconds) || 0) + extraPaused;
    await pool.query(
      'UPDATE sessions SET status = ?, paused_at = NULL, paused_seconds = ? WHERE id = ?',
      ['running', newPausedSeconds, req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/:id/move { to_table_id }
router.post(
  '/:id/move',
  requireCashier,
  param('id').isInt(),
  body('to_table_id').isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const { id } = req.params;
      const { to_table_id } = req.body;
      const [sessions] = await conn.query('SELECT * FROM sessions WHERE id = ? FOR UPDATE', [id]);
      const session = sessions[0];
      if (!session) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Session not found' });
      }
      if (session.status !== 'running' && session.status !== 'paused') {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Session cannot be moved' });
      }
      const fromTableId = session.table_id;
      const [toTables] = await conn.query('SELECT * FROM `tables` WHERE id = ? FOR UPDATE', [to_table_id]);
      const toTable = toTables[0];
      if (!toTable) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Target table not found' });
      }
      if (toTable.id === fromTableId) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Same table' });
      }
      if (toTable.status !== 'available') {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Target table is not available' });
      }
      await conn.query(
        'UPDATE `tables` SET status = ?, active_session_id = NULL WHERE id = ?',
        ['available', fromTableId]
      );
      await conn.query(
        'UPDATE `tables` SET status = ?, active_session_id = ? WHERE id = ?',
        ['playing', id, to_table_id]
      );
      await conn.query('UPDATE sessions SET table_id = ? WHERE id = ?', [to_table_id, id]);
      await conn.commit();
      const [rows] = await pool.query('SELECT * FROM sessions WHERE id = ?', [id]);
      res.json(rows[0]);
    } catch (err) {
      await conn.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  }
);

// POST /api/sessions/:id/end — คำนวณ + lock + สร้าง table_time item
router.post('/:id/end', requireCashier, param('id').isInt(), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [sessions] = await conn.query('SELECT * FROM sessions WHERE id = ? FOR UPDATE', [req.params.id]);
    const session = sessions[0];
    if (!session) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Session not found' });
    }
    if (session.status === 'ended' || session.status === 'void') {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'Session already ended or void' });
    }
    const [rates] = await conn.query('SELECT * FROM rates WHERE id = ?', [session.rate_id]);
    const rate = rates[0];
    const endedAt = new Date();
    const calc = computeSessionAmount(
      { ...session, status: session.status, ended_at: endedAt },
      rate,
      endedAt
    );
    await conn.query(
      `UPDATE sessions SET status = 'ended', ended_at = ?, ended_by = ?, computed_minutes = ?, computed_units = ?, computed_amount = ? WHERE id = ?`,
      [endedAt, req.user.id, calc.minutes, calc.units, calc.amount, req.params.id]
    );
    const orderId = session.order_id;
    if (orderId) {
      const itemName = `โต๊ะ (${calc.minutes} นาที / ${calc.units} ชม.)`;
      const meta = JSON.stringify({
        rate_name: rate.name,
        minutes: calc.minutes,
        units: calc.units,
        price_per_unit: rate.price_per_unit,
      });
      await conn.query(
        `INSERT INTO order_items (order_id, item_type, ref_id, name, qty, unit_price, amount, meta_json)
         VALUES (?, 'table_time', ?, ?, ?, ?, ?, ?)`,
        [orderId, req.params.id, itemName, calc.units, rate.price_per_unit, calc.amount, meta]
      );
      const [sumRows] = await conn.query(
        'SELECT COALESCE(SUM(amount), 0) AS subtotal FROM order_items WHERE order_id = ?',
        [orderId]
      );
      const subtotal = Number(sumRows[0].subtotal);
      await conn.query(
        'UPDATE orders SET subtotal = ?, total = ? WHERE id = ?',
        [subtotal, subtotal, orderId]
      );
    }
    await conn.query(
      'UPDATE `tables` SET status = ?, active_session_id = NULL WHERE id = ?',
      ['available', session.table_id]
    );
    await conn.commit();
    const [rows] = await pool.query(
      'SELECT s.*, r.name AS rate_name FROM sessions s JOIN rates r ON r.id = s.rate_id WHERE s.id = ?',
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

export default router;
