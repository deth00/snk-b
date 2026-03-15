import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';
import { computeSessionAmount } from '../services/sessionCalc.js';
import { syncTableToEsp32 } from '../services/tableSyncEsp32.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

// POST /api/sessions/start { table_id } — ใช้ price จากตาราง tables ไม่ใช้ rate
router.post(
  '/start',
  requireAll,
  requireBranch,
  body('table_id').isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const conn = await pool.getConnection();
    let orderId;
    try {
      await conn.beginTransaction();
      const { table_id } = req.body;
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
      const bid = req.branchId;
      if (table.branch_id != null && Number(table.branch_id) !== Number(bid)) {
        await conn.rollback();
        conn.release();
        return res.status(403).json({ error: 'โต๊ะนี้ไม่ใช่ของสาขานี้' });
      }
      const pricePerUnit = Number(table.price_per_unit);
      if (!pricePerUnit || pricePerUnit <= 0) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'โต๊ะนี้ยังไม่มีราคา กรุณาตั้ง price_per_unit ในโต๊ะ' });
      }
      const startedAt = new Date();
      const [currentShift] = await conn.query(
        'SELECT id, branch_id FROM shifts WHERE closed_at IS NULL AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL)) LIMIT 1',
        [bid, bid]
      );
      const shift = currentShift[0];
      const shiftId = shift?.id || null;
      if (!shiftId) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'ต้องเปิดกะก่อนถึงจะเปิดโต๊ะได้', code: 'NO_OPEN_SHIFT' });
      }
      const orderBranchId = shift.branch_id ?? bid;
      const [orderResult] = await conn.query(
        'INSERT INTO orders (code, status, opened_by, opened_at, shift_id, branch_id) VALUES (?, "open", ?, ?, ?, ?)',
        ['O' + Date.now() + '-' + Math.floor(Math.random() * 10000), req.user.id, startedAt, shiftId, orderBranchId]
      );
      orderId = orderResult.insertId;
      await conn.query('UPDATE orders SET code = ? WHERE id = ?', ['O' + orderId, orderId]);
      const [sessionResult] = await conn.query(
        `INSERT INTO sessions (table_id, rate_id, order_id, status, started_at, opened_by)
         VALUES (?, NULL, ?, 'running', ?, ?)`,
        [table_id, orderId, startedAt, req.user.id]
      );
      const sessionId = sessionResult.insertId;
      await conn.query(
        'UPDATE `tables` SET status = ?, active_session_id = ? WHERE id = ?',
        ['playing', sessionId, table_id]
      );
      await conn.commit();
      console.log('[session start] table opened, syncing ESP32:', { id: table.id, code: table.code, port: table.port, status: 'playing' });
      syncTableToEsp32({ id: table.id, code: table.code, port: table.port, status: 'playing' }, bid);
      const [rows] = await pool.query(
        'SELECT s.*, t.code AS table_code, t.name AS table_name, t.price_per_unit FROM sessions s JOIN `tables` t ON t.id = s.table_id WHERE s.id = ?',
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

// GET /api/sessions/:id (ยอดวิ่ง realtime — ใช้ pricing จากตาราง tables)
router.get('/:id', requireAll, param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const [sessions] = await pool.query(
      'SELECT s.*, t.price_per_unit, t.minimum_units, t.rounding_minutes, t.rounding_mode FROM sessions s JOIN `tables` t ON t.id = s.table_id WHERE s.id = ?',
      [req.params.id]
    );
    const session = sessions[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const pricing = {
      price_per_unit: session.price_per_unit,
      minimum_units: session.minimum_units ?? 0,
      rounding_minutes: session.rounding_minutes ?? 0,
      rounding_mode: session.rounding_mode || 'ceil',
    };
    let amount_preview = null;
    if (session.status === 'running' || session.status === 'paused') {
      amount_preview = computeSessionAmount(session, pricing, new Date());
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
router.post('/:id/pause', requireAll, param('id').isInt(), async (req, res) => {
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
router.post('/:id/resume', requireAll, param('id').isInt(), async (req, res) => {
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
  requireAll,
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
      const [fromTableRows] = await pool.query('SELECT id, code, port FROM `tables` WHERE id = ?', [fromTableId]);
      const bid = req.branchId;
      if (fromTableRows[0]) syncTableToEsp32({ ...fromTableRows[0], status: 'available' }, bid);
      syncTableToEsp32({ id: toTable.id, code: toTable.code, port: toTable.port, status: 'playing' }, bid);
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
router.post('/:id/end', requireAll, param('id').isInt(), async (req, res) => {
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
    const [tables] = await conn.query('SELECT price_per_unit, minimum_units, rounding_minutes, rounding_mode FROM `tables` WHERE id = ?', [session.table_id]);
    const table = tables[0];
    if (!table || !table.price_per_unit) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'โต๊ะไม่มีราคากำหนด' });
    }
    const pricing = {
      price_per_unit: table.price_per_unit,
      minimum_units: table.minimum_units ?? 0,
      rounding_minutes: table.rounding_minutes ?? 0,
      rounding_mode: table.rounding_mode || 'ceil',
    };
    const endedAt = new Date();
    const calc = computeSessionAmount(
      { ...session, status: session.status, ended_at: endedAt },
      pricing,
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
        table_id: session.table_id,
        minutes: calc.minutes,
        units: calc.units,
        price_per_unit: pricing.price_per_unit,
      });
      await conn.query(
        `INSERT INTO order_items (order_id, item_type, ref_id, name, qty, unit_price, unit_cost, amount, meta_json)
         VALUES (?, 'table_time', ?, ?, ?, ?, 0, ?, ?)`,
        [orderId, req.params.id, itemName, calc.units, pricing.price_per_unit, calc.amount, meta]
      );
      const [sumRows] = await conn.query(
        'SELECT COALESCE(SUM(amount), 0) AS subtotal FROM order_items WHERE order_id = ?',
        [orderId]
      );
      const subtotal = Number(sumRows[0].subtotal);
      await conn.query('UPDATE orders SET subtotal = ?, total = ? WHERE id = ?', [subtotal, subtotal, orderId]);
    }
    await conn.query(
      'UPDATE `tables` SET status = ?, active_session_id = NULL WHERE id = ?',
      ['paying', session.table_id]
    );
    await conn.commit();
    const [rows] = await pool.query(
      'SELECT s.*, t.code AS table_code, t.name AS table_name, t.price_per_unit FROM sessions s JOIN `tables` t ON t.id = s.table_id WHERE s.id = ?',
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
