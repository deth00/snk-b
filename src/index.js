import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pool from './config/db.js';
import authRoutes from './routes/auth.js';
import tablesRoutes from './routes/tables.js';
import ratesRoutes from './routes/rates.js';
import sessionsRoutes from './routes/sessions.js';
import ordersRoutes from './routes/orders.js';
import productsRoutes from './routes/products.js';
import productCategoriesRoutes from './routes/product-categories.js';
import shiftsRoutes from './routes/shifts.js';
import reportsRoutes from './routes/reports.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/tables', tablesRoutes);
app.use('/api/rates', ratesRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/product-categories', productCategoriesRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/reports', reportsRoutes);

app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  try {
    const conn = await pool.getConnection();
    await conn.query('SELECT 1');
    conn.release();
    console.log('[DB] Database connected OK');
  } catch (err) {
    console.error('[DB] Database connection FAIL:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start();
