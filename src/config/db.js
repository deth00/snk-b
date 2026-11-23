import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { LAO_DB_TIMEZONE } from '../utils/time.js';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'dev8050Dbs@123',
  database: process.env.DB_NAME || 'snk_b',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: LAO_DB_TIMEZONE,
  dateStrings: true,
});

pool.on('connection', (connection) => {
  connection.query(`SET time_zone = '${LAO_DB_TIMEZONE}'`);
});

export default pool;
