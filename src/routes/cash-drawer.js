import { Router } from 'express';
import { body, query, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(requireAll);
router.use(branchMiddleware);

async function ensureDrawer (branchId) {
  const [rows] = await pool.query('SELECT * FROM cash_drawers WHERE branch_id = ?', [branchId]);
  if (rows.length > 0) return rows[0];
  await pool.query('INSERT INTO cash_drawers (branch_id, balance) VALUES (?, 0)', [branchId]);
  const [created] = await pool.query('SELECT * FROM cash_drawers WHERE branch_id = ?', [branchId]);
  return created[0];
}

// GET /all — ยอดคงเหลือทุกสาขา (admin only)
router.get('/all', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'ບໍ່ມີສິດ' });
  try {
    const [branches] = await pool.query('SELECT id, name FROM branches ORDER BY id');
    const results = [];
    for (const b of branches) {
      const drawer = await ensureDrawer(b.id);
      results.push({ branch_id: b.id, branch_name: b.name, balance: Number(drawer.balance), updated_at: drawer.updated_at });
    }
    res.json({ items: results });
  } catch (err) {
    console.error('cash-drawer GET /all', err);
    res.status(500).json({ error: 'ໂຫຼດບໍ່ສຳເລັດ' });
  }
});

// GET / — ยอดคงเหลือ
router.get('/', requireBranch, async (req, res) => {
  try {
    const drawer = await ensureDrawer(req.branchId);
    res.json({ balance: Number(drawer.balance), updated_at: drawer.updated_at });
  } catch (err) {
    console.error('cash-drawer GET /', err);
    res.status(500).json({ error: 'ໂຫຼດບໍ່ສຳເລັດ' });
  }
});

// POST /deposit — ฝากเงินเข้า
router.post('/deposit', requireBranch, [
  body('amount').isFloat({ gt: 0 }).withMessage('ຈຳນວນຕ້ອງຫຼາຍກວ່າ 0'),
  body('note').optional({ nullable: true }).isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { amount, note } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const drawer = await ensureDrawer(req.branchId);
    const newBalance = Number(drawer.balance) + Number(amount);
    await conn.query('UPDATE cash_drawers SET balance = ? WHERE branch_id = ?', [newBalance, req.branchId]);
    await conn.query(
      'INSERT INTO cash_drawer_logs (branch_id, type, amount, balance_after, note, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [req.branchId, 'deposit', amount, newBalance, note || null, req.user.id]
    );
    await conn.commit();
    res.json({ balance: newBalance, message: 'ຝາກເງິນສຳເລັດ' });
  } catch (err) {
    await conn.rollback();
    console.error('cash-drawer POST /deposit', err);
    res.status(500).json({ error: 'ບໍ່ສຳເລັດ' });
  } finally {
    conn.release();
  }
});

// POST /withdraw — ถอนเงินออก (admin only)
router.post('/withdraw', requireBranch, [
  body('amount').isFloat({ gt: 0 }).withMessage('ຈຳນວນຕ້ອງຫຼາຍກວ່າ 0'),
  body('note').optional({ nullable: true }).isString(),
], async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'ມີແຕ່ເຈົ້າຂອງຮ້ານເທົ່ານັ້ນທີ່ສາມາດຖອນເງິນໄດ້' });
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { amount, note } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const drawer = await ensureDrawer(req.branchId);
    const currentBalance = Number(drawer.balance);
    if (Number(amount) > currentBalance) {
      await conn.rollback();
      return res.status(400).json({ error: `ຍອດໃນຄັງບໍ່ພໍ (ຄົງເຫຼືອ ${currentBalance})` });
    }
    const newBalance = currentBalance - Number(amount);
    await conn.query('UPDATE cash_drawers SET balance = ? WHERE branch_id = ?', [newBalance, req.branchId]);
    await conn.query(
      'INSERT INTO cash_drawer_logs (branch_id, type, amount, balance_after, note, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [req.branchId, 'withdraw', amount, newBalance, note || null, req.user.id]
    );
    await conn.commit();
    res.json({ balance: newBalance, message: 'ຖອນເງິນສຳເລັດ' });
  } catch (err) {
    await conn.rollback();
    console.error('cash-drawer POST /withdraw', err);
    res.status(500).json({ error: 'ບໍ່ສຳເລັດ' });
  } finally {
    conn.release();
  }
});

// GET /logs/branch/:branchId — ประวัติของสาขาใดๆ (admin only)
router.get('/logs/branch/:branchId', [
  query('date_from').optional().isDate(),
  query('date_to').optional().isDate(),
], async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'ບໍ່ມີສິດ' });
  try {
    const bid = Number(req.params.branchId);
    let where = 'l.branch_id = ?';
    const params = [bid];
    if (req.query.date_from) { where += ' AND DATE(l.created_at) >= ?'; params.push(req.query.date_from); }
    if (req.query.date_to)   { where += ' AND DATE(l.created_at) <= ?'; params.push(req.query.date_to); }
    const [rows] = await pool.query(
      `SELECT l.*, u.username AS created_by_username
       FROM cash_drawer_logs l
       LEFT JOIN users u ON u.id = l.created_by
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT 500`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('cash-drawer GET /logs/branch/:branchId', err);
    res.status(500).json({ error: 'ໂຫຼດບໍ່ສຳເລັດ' });
  }
});

// GET /logs — ประวัติ
router.get('/logs', requireBranch, [
  query('date_from').optional().isDate(),
  query('date_to').optional().isDate(),
], async (req, res) => {
  try {
    let where = 'l.branch_id = ?';
    const params = [req.branchId];
    if (req.query.date_from) { where += ' AND DATE(l.created_at) >= ?'; params.push(req.query.date_from); }
    if (req.query.date_to)   { where += ' AND DATE(l.created_at) <= ?'; params.push(req.query.date_to); }
    const [rows] = await pool.query(
      `SELECT l.*, u.username AS created_by_username
       FROM cash_drawer_logs l
       LEFT JOIN users u ON u.id = l.created_by
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT 500`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('cash-drawer GET /logs', err);
    res.status(500).json({ error: 'ໂຫຼດບໍ່ສຳເລັດ' });
  }
});

export default router;
