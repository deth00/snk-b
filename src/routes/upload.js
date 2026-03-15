import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { authMiddleware, requireManager } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, '..', 'uploads');
const productsDir = path.join(uploadsRoot, 'products');
const qrDir = path.join(uploadsRoot, 'qr');

if (!fs.existsSync(productsDir)) fs.mkdirSync(productsDir, { recursive: true });
if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

function makeStorage(dir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext.toLowerCase()) ? ext : '.jpg';
      cb(null, `${Date.now()}-${randomBytes(8).toString('hex')}${safeExt}`);
    },
  });
}

const fileFilter = (_req, file, cb) => {
  const allowed = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
  if (allowed) cb(null, true);
  else cb(new Error('อนุญาตเฉพาะไฟล์รูป (JPEG, PNG, GIF, WebP)'));
};

const upload = multer({ storage: makeStorage(productsDir), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter });
const uploadQR = multer({ storage: makeStorage(qrDir), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter });

const router = Router();
router.use(authMiddleware);
router.use(requireManager);

// POST /api/upload — อัปโหลดรูป (admin), field name: file
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่มีไฟล์รูป' });
  res.json({ url: `/uploads/products/${req.file.filename}` });
});

// POST /api/upload/qr — อัปโหลดรูป QR ธนาคาร
router.post('/qr', uploadQR.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่มีไฟล์รูป' });
  res.json({ url: `/uploads/qr/${req.file.filename}` });
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'ไฟล์ใหญ่เกิน 5 MB' });
  }
  next(err);
});

export default router;
