import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();
const __dirname = dirname(fileURLToPath(import.meta.url));

async function init() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '172.17.113.85',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'myuser',
    password: process.env.DB_PASSWORD || 'deth@123',
    multipleStatements: true,
  });
  const dbName = process.env.DB_NAME || 'snk_b';
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${dbName}\``);
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);
  console.log('Database initialized:', dbName);
  await conn.end();
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
