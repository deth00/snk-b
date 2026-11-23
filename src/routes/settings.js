import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authMiddleware, requireManager, requireAll } from '../middleware/auth.js';
import { branchMiddleware, requireBranch } from '../middleware/branch.js';

const router = Router();
router.use(authMiddleware);
router.use(branchMiddleware);

const PAYMENT_METHOD_IDS = ['cash', 'transfer', 'qr', 'card', 'mixed'];

function paymentKey (branchId) {
  return branchId ? `payment_${branchId}` : 'payment';
}

function receiptKey (branchId) {
  return branchId ? `receipt_${branchId}` : 'receipt';
}

const DEFAULT_LAYOUT = [
  { id: 'logo', show: true, align: 'center', order: 0, size: 48 },
  { id: 'headerTitle', show: true, align: 'center', order: 1 },
  { id: 'headerSubtitle', show: true, align: 'center', order: 2 },
  { id: 'receiptCode', show: true, align: 'center', order: 3 },
  { id: 'branchId', show: true, align: 'center', order: 4 },
  { id: 'dateTime', show: true, align: 'center', order: 5 },
  { id: 'items', show: true, align: 'left', order: 6 },
  { id: 'totals', show: true, align: 'left', order: 7 },
  { id: 'paymentInfo', show: true, align: 'center', order: 8 },
  { id: 'footerText', show: true, align: 'center', order: 9 },
  { id: 'qrCode', show: false, align: 'center', order: 10, size: 80 },
];

const DEFAULT_RECEIPT = {
  width: '80mm',
  headerTitle: 'Snooker POS',
  headerSubtitle: '',
  footerText: 'ຂອບໃຈທີ່ໃຊ້ບໍລິການ',
  layout: DEFAULT_LAYOUT,
};

function defaultPaymentLabel (id) {
  if (id === 'cash') return 'ເງິນສົດ';
  if (id === 'transfer') return 'ໂອນ';
  if (id === 'qr') return 'QR';
  if (id === 'card') return 'ບັດ';
  return 'ປະສົມ';
}

router.get('/payment', requireAll, requireBranch, async (req, res) => {
  try {
    const key = paymentKey(req.branchId);
    let [rows] = await pool.query('SELECT value FROM settings WHERE `key` = ?', [key]);
    if (!rows.length && req.branchId) {
      [rows] = await pool.query("SELECT value FROM settings WHERE `key` = 'payment'");
    }
    if (!rows.length) {
      return res.json({
        methods: PAYMENT_METHOD_IDS.map((id, i) => ({
          id,
          label: defaultPaymentLabel(id),
          enabled: true,
          sort_order: i,
        })),
        default_method: 'cash',
      });
    }
    const data = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch(
  '/payment',
  requireManager,
  requireBranch,
  body('methods').isArray(),
  body('methods.*.id').isIn(PAYMENT_METHOD_IDS),
  body('methods.*.label').trim().notEmpty(),
  body('methods.*.enabled').optional().isBoolean(),
  body('methods.*.sort_order').optional().isInt({ min: 0 }),
  body('default_method').isIn(PAYMENT_METHOD_IDS),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const first = errors.array()[0];
      return res.status(400).json({ error: first?.msg || 'Validation failed', errors: errors.array() });
    }
    try {
      const payload = {
        methods: req.body.methods,
        default_method: req.body.default_method,
      };
      const key = paymentKey(req.branchId);
      await pool.query(
        'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?, updated_at = CURRENT_TIMESTAMP',
        [key, JSON.stringify(payload), JSON.stringify(payload)]
      );
      const [rows] = await pool.query('SELECT value FROM settings WHERE `key` = ?', [key]);
      const data = rows[0] && (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value);
      res.json(data || payload);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get('/receipt', requireAll, requireBranch, async (req, res) => {
  try {
    const key = receiptKey(req.branchId);
    let [rows] = await pool.query('SELECT value FROM settings WHERE `key` = ?', [key]);
    if (!rows.length && req.branchId) {
      [rows] = await pool.query("SELECT value FROM settings WHERE `key` = 'receipt'");
    }
    if (!rows.length) {
      return res.json(DEFAULT_RECEIPT);
    }
    const data = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
    res.json({ ...DEFAULT_RECEIPT, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch(
  '/receipt',
  requireManager,
  requireBranch,
  body('width').optional().isIn(['58mm', '80mm']),
  body('headerTitle').optional().trim(),
  body('headerSubtitle').optional().trim(),
  body('footerText').optional().trim(),
  body('logoUrl').optional().trim(),
  body('qrImageUrl').optional().trim(),
  body('layout').optional().isArray(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const first = errors.array()[0];
      return res.status(400).json({ error: first?.msg || 'Validation failed', errors: errors.array() });
    }
    try {
      const existing = { ...DEFAULT_RECEIPT };
      let [rows] = await pool.query('SELECT value FROM settings WHERE `key` = ?', [receiptKey(req.branchId)]);
      if (rows.length) {
        const prev = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
        Object.assign(existing, prev);
      }
      const payload = {
        width: req.body.width ?? existing.width,
        headerTitle: req.body.headerTitle ?? existing.headerTitle,
        headerSubtitle: req.body.headerSubtitle ?? existing.headerSubtitle,
        footerText: req.body.footerText ?? existing.footerText,
        logoUrl: req.body.logoUrl !== undefined ? req.body.logoUrl : existing.logoUrl,
        qrImageUrl: req.body.qrImageUrl !== undefined ? req.body.qrImageUrl : existing.qrImageUrl,
        layout: Array.isArray(req.body.layout) && req.body.layout.length > 0 ? req.body.layout : (existing.layout ?? DEFAULT_LAYOUT),
      };
      const key = receiptKey(req.branchId);
      await pool.query(
        'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?, updated_at = CURRENT_TIMESTAMP',
        [key, JSON.stringify(payload), JSON.stringify(payload)]
      );
      [rows] = await pool.query('SELECT value FROM settings WHERE `key` = ?', [key]);
      const data = rows[0] && (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value);
      res.json({ ...DEFAULT_RECEIPT, ...data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
