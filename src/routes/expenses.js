import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireManager, requireAdmin, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(requireAll); // admin, manager, user ເຂົ້າເຖິງໄດ້
router.use(branchMiddleware); // ອ່ານ X-Branch-Id ແລະຕັ້ງ req.branchId

// GET /api/expenses/pending-count — ຈຳນວນທີ່ລໍຖ້າອະນຸມັດ (admin)
router.get('/pending-count', requireBranch, requireAdmin, async (req, res) => {
  try {
    const bid = req.branchId;
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS n FROM expenses WHERE status = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))',
      ['pending', bid, bid]
    );
    res.json({ count: Number(rows[0]?.n || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/expenses?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get(
  '/',
  requireBranch,
  query('date_from').optional().isDate(),
  query('date_to').optional().isDate(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const bid = req.branchId;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;

    let dateCondition = '';
    const dateParams = [];
    if (dateFrom && dateTo) {
      dateCondition = ' AND DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?';
      dateParams.push(dateFrom, dateTo);
    } else if (dateFrom) {
      dateCondition = ' AND DATE(t.created_at) >= ?';
      dateParams.push(dateFrom);
    } else if (dateTo) {
      dateCondition = ' AND DATE(t.created_at) <= ?';
      dateParams.push(dateTo);
    }

    try {
      const [rows] = await pool.query(
        `SELECT t.id, t.amount, t.title, t.category, t.note, t.invoice_id, t.status, t.created_at, u.username AS created_by_username
         FROM expenses t
         JOIN users u ON u.id = t.created_by
         WHERE (t.branch_id = ? OR (t.branch_id IS NULL AND ? IS NULL))${dateCondition}
         ORDER BY t.created_at DESC, t.id DESC LIMIT 500`,
        [bid, bid, ...dateParams]
      );

      let sumDateCondition = dateCondition.replace(/t\.created_at/g, 'created_at');
      const [summary] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM expenses
         WHERE (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))${sumDateCondition}`,
        [bid, bid, ...dateParams]
      );

      res.json({
        items: rows,
        summary: { total: Number(summary[0].total || 0) },
        date_from: dateFrom,
        date_to: dateTo,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/expenses
router.post(
  '/',
  requireBranch,
  body('amount').isFloat({ min: 0.01 }),
  body('title').optional().trim(),
  body('category').optional().trim(),
  body('note').optional().trim(),
  body('invoice_id').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { amount, title, category, note, invoice_id: reqInvoiceId } = req.body;
      const bid = req.branchId;
      let invoiceId = reqInvoiceId?.trim() || null;
      if (!invoiceId && bid != null) {
        const [branchRows] = await pool.query('SELECT code FROM branches WHERE id = ?', [bid]);
        const branchCode = (branchRows[0]?.code || `B${bid}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || `B${bid}`;
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const [countRows] = await pool.query(
          'SELECT COUNT(*) AS n FROM expenses WHERE branch_id = ? AND DATE(created_at) = CURDATE()',
          [bid]
        );
        const seq = (countRows[0]?.n || 0) + 1;
        invoiceId = `${branchCode}-EXP-${today}-${String(seq).padStart(4, '0')}`;
      }
      await pool.query(
        'INSERT INTO expenses (amount, title, category, note, invoice_id, branch_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [Number(amount), title || null, category || null, note || null, invoiceId, bid, req.user.id]
      );
      const [rows] = await pool.query(
        'SELECT t.*, u.username AS created_by_username FROM expenses t JOIN users u ON u.id = t.created_by WHERE t.id = LAST_INSERT_ID()'
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/expenses/:id
router.patch(
  '/:id',
  requireBranch,
  param('id').isInt(),
  body('amount').optional().isFloat({ min: 0.01 }),
  body('title').optional().trim(),
  body('category').optional().trim(),
  body('note').optional().trim(),
  body('invoice_id').optional().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const bid = req.branchId;
      const [existing] = await pool.query(
        'SELECT id FROM expenses WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))',
        [req.params.id, bid, bid]
      );
      if (!existing[0]) return res.status(404).json({ error: 'Not found' });

      const updates = [];
      const values = [];
      if (req.body.amount !== undefined) { updates.push('amount = ?'); values.push(Number(req.body.amount)); }
      if (req.body.title !== undefined) { updates.push('title = ?'); values.push(req.body.title || null); }
      if (req.body.category !== undefined) { updates.push('category = ?'); values.push(req.body.category || null); }
      if (req.body.note !== undefined) { updates.push('note = ?'); values.push(req.body.note || null); }
      if (req.body.invoice_id !== undefined) { updates.push('invoice_id = ?'); values.push(req.body.invoice_id || null); }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

      values.push(req.params.id);
      await pool.query(`UPDATE expenses SET ${updates.join(', ')} WHERE id = ?`, values);

      const [rows] = await pool.query(
        'SELECT t.*, u.username AS created_by_username FROM expenses t JOIN users u ON u.id = t.created_by WHERE t.id = ?',
        [req.params.id]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/expenses/:id/approve — admin เท่านั้น
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
      const [r] = await pool.query(
        `UPDATE expenses SET status = 'approved'
         WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))`,
        [req.params.id, bid, bid]
      );
      if (r.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
      const [rows] = await pool.query(
        'SELECT t.*, u.username AS created_by_username FROM expenses t JOIN users u ON u.id = t.created_by WHERE t.id = ?',
        [req.params.id]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/expenses/:id
router.delete('/:id', requireBranch, param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const bid = req.branchId;
    const [r] = await pool.query(
      'DELETE FROM expenses WHERE id = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))',
      [req.params.id, bid, bid]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
