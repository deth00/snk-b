-- Snooker Hall Backend - MySQL Schema
-- Run: CREATE DATABASE snk_b; then mysql -u root -p snk_b < src/db/schema.sql

-- 1) users (Auth + Roles: admin, cashier, staff)
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','cashier','staff') NOT NULL DEFAULT 'staff',
  display_name VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2) tables (โต๊ะสนุกเกอร์)
CREATE TABLE IF NOT EXISTS `tables` (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100),
  status ENUM('available','playing','reserved','maintenance') NOT NULL DEFAULT 'available',
  active_session_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_active_session (active_session_id)
);

-- 3) rates (เรทคิดเงิน)
CREATE TABLE IF NOT EXISTS rates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  unit ENUM('hour') NOT NULL DEFAULT 'hour',
  price_per_unit DECIMAL(12,2) NOT NULL,
  minimum_units DECIMAL(8,2) NOT NULL DEFAULT 0,
  rounding_minutes INT NOT NULL DEFAULT 0,
  rounding_mode ENUM('ceil','floor','nearest') NOT NULL DEFAULT 'ceil',
  start_time TIME NULL,
  end_time TIME NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 4) shifts (ก่อน orders เพราะ orders.shift_id อ้างถึง)
CREATE TABLE IF NOT EXISTS shifts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  opened_by INT UNSIGNED NOT NULL,
  opened_at DATETIME NOT NULL,
  closed_by INT UNSIGNED NULL,
  closed_at DATETIME NULL,
  cash_open DECIMAL(12,2) NULL,
  cash_close DECIMAL(12,2) NULL,
  total_sales DECIMAL(12,2) NULL,
  total_cash DECIMAL(12,2) NULL,
  total_qr DECIMAL(12,2) NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (opened_by) REFERENCES users(id),
  FOREIGN KEY (closed_by) REFERENCES users(id)
);

-- 5) orders (บิล)
CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  status ENUM('open','paid','void') NOT NULL DEFAULT 'open',
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  opened_by INT UNSIGNED NOT NULL,
  closed_by INT UNSIGNED NULL,
  opened_at DATETIME NOT NULL,
  closed_at DATETIME NULL,
  shift_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_shift (shift_id),
  FOREIGN KEY (opened_by) REFERENCES users(id),
  FOREIGN KEY (closed_by) REFERENCES users(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL
);

-- 6) sessions (การเล่นต่อโต๊ะ) - หลัง orders
CREATE TABLE IF NOT EXISTS sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  table_id INT UNSIGNED NOT NULL,
  rate_id INT UNSIGNED NOT NULL,
  order_id INT UNSIGNED NULL,
  status ENUM('running','paused','ended','void') NOT NULL DEFAULT 'running',
  started_at DATETIME NOT NULL,
  ended_at DATETIME NULL,
  paused_seconds INT NOT NULL DEFAULT 0,
  paused_at DATETIME NULL,
  opened_by INT UNSIGNED NOT NULL,
  ended_by INT UNSIGNED NULL,
  computed_minutes INT NULL,
  computed_units DECIMAL(10,2) NULL,
  computed_amount DECIMAL(12,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_table (table_id),
  KEY idx_order (order_id),
  KEY idx_status (status),
  FOREIGN KEY (table_id) REFERENCES `tables`(id),
  FOREIGN KEY (rate_id) REFERENCES rates(id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  FOREIGN KEY (opened_by) REFERENCES users(id),
  FOREIGN KEY (ended_by) REFERENCES users(id)
);

-- 7) order_items (รายการในบิล)
CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  item_type ENUM('product','table_time') NOT NULL,
  ref_id INT UNSIGNED NULL COMMENT 'product_id or session_id',
  name VARCHAR(255) NOT NULL,
  qty DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  meta_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_order (order_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- 8) product_categories (หมวดหมู่สินค้า)
CREATE TABLE IF NOT EXISTS product_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sort (sort_order)
);

-- 9) products (สินค้า + หน่วย + สต็อก + หมวดหมู่)
CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(50) NULL,
  name VARCHAR(255) NOT NULL,
  category_id INT UNSIGNED NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'ชิ้น' COMMENT 'หน่วยขาย/สต็อก เช่น ชิ้น ขวด กล่อง ถุง',
  price DECIMAL(12,2) NOT NULL,
  cost DECIMAL(12,2) NULL,
  stock_qty DECIMAL(12,2) NULL COMMENT 'จำนวนคงเหลือ (หน่วยตาม unit)',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_category (category_id),
  KEY idx_active (is_active),
  FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL
);

-- 10) payments
CREATE TABLE IF NOT EXISTS payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  method ENUM('cash','transfer','qr','card','mixed') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  ref_no VARCHAR(100) NULL,
  paid_at DATETIME NOT NULL,
  paid_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_order (order_id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (paid_by) REFERENCES users(id)
);

-- FK จาก tables ไป sessions (optional, อัปเดตจาก app)
-- ALTER TABLE `tables` ADD CONSTRAINT fk_tables_active_session FOREIGN KEY (active_session_id) REFERENCES sessions(id) ON DELETE SET NULL;
