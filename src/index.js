import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
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
import unitsRoutes from './routes/units.js';
import usersRoutes from './routes/users.js';
import shiftsRoutes from './routes/shifts.js';
import reportsRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import paymentBanksRoutes from './routes/payment-banks.js';
import uploadRoutes from './routes/upload.js';
import branchesRoutes from './routes/branches.js';
import storesRoutes from './routes/stores.js';
import membersRoutes from './routes/members.js';
import debtsRoutes from './routes/debts.js';
import incomesRoutes from './routes/incomes.js';
import expensesRoutes from './routes/expenses.js';
import stockAdjustmentsRoutes from './routes/stock-adjustments.js';
import cashDrawerRoutes from './routes/cash-drawer.js';
import rolePermissionsRoutes from './routes/role-permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/tables', tablesRoutes);
app.use('/api/rates', ratesRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/product-categories', productCategoriesRoutes);
app.use('/api/units', unitsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/payment-banks', paymentBanksRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/stores', storesRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/debts', debtsRoutes);
app.use('/api/incomes', incomesRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/stock-adjustments', stockAdjustmentsRoutes);
app.use('/api/cash-drawer', cashDrawerRoutes);
app.use('/api/role-permissions', rolePermissionsRoutes);

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
