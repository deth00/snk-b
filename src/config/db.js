import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '172.17.113.85',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'myuser',
  password: process.env.DB_PASSWORD || 'deth@123',
  database: process.env.DB_NAME || 'snk_b',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

export default pool;
