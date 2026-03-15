# API Documentation — Snooker Hall Backend

ทุก route (ยกเว้น setup, login, setup-available, health) ต้องส่ง header:
```
Authorization: Bearer <token>
```

route ที่เกี่ยวกับสาขา (tables, rates, sessions, orders, shifts, reports) ต้องส่ง:
```
X-Branch-Id: <branch_id>
```

---

## Auth

### `GET /api/auth/setup-available`
**ใช้ทำอะไร:** ตรวจสอบว่ายังไม่มี user ในระบบ (สำหรับการ setup ครั้งแรก)

**Auth:** ไม่ต้อง

**Response:**
```json
{ "setupAvailable": true }
```

---

### `POST /api/auth/setup`
**ใช้ทำอะไร:** สร้างผู้ใช้คนแรก (admin) — ใช้ได้เฉพาะเมื่อยังไม่มี user ในระบบ

**Auth:** ไม่ต้อง

**Body:**
```json
{
  "username": "admin",
  "password": "admin123",
  "display_name": "Admin"
}
```

**Response:**
```json
{
  "token": "...",
  "user": { "id": 1, "username": "admin", "role": "admin", "display_name": "Admin", "branch_id": null }
}
```

---

### `POST /api/auth/login`
**ใช้ทำอะไร:** ล็อกอินเพื่อรับ token

**Auth:** ไม่ต้อง

**Body:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response:**
```json
{
  "token": "...",
  "user": { "id": 1, "username": "admin", "role": "admin", "display_name": "Admin", "branch_id": null }
}
```

---

### `GET /api/auth/me`
**ใช้ทำอะไร:** ดึงข้อมูล user ปัจจุบัน (ตรวจสอบ token)

**Response:**
```json
{ "user": { "id": 1, "username": "admin", "role": "admin", "display_name": "Admin" } }
```

---

## Tables (โต๊ะ)

### `GET /api/tables/public`
**ใช้ทำอะไร:** list โต๊ะ + ดูสถานะ แบบ **public** — ไม่ต้อง login ใช้ได้กับหน้าจอสาธารณะ/จอแสดงสถานะ

**Auth:** ไม่ต้อง

**Query:** `?branch_id=1` (จำเป็น)

**ตัวอย่าง:** `GET /api/tables/public?branch_id=1`

---

### `GET /api/tables`
**ใช้ทำอะไร:** list โต๊ะ + ดูสถานะโต๊ะ (available/playing/reserved/maintenance/paying) พร้อมข้อมูล session ที่กำลังเล่นอยู่

**Headers:** `X-Branch-Id` จำเป็น

**Response:**
```json
[
  {
    "id": 1,
    "code": "T01",
    "name": "โต๊ะ 1",
    "port": 0,
    "status": "playing",
    "active_session_id": 5,
    "session_id": 5,
    "session_status": "running",
    "started_at": "2025-01-28T10:00:00.000Z",
    "rate_id": 1,
    "rate_name": "Day",
    "price_per_unit": 80,
    "open_order_id": 12
  }
]
```

---

### `POST /api/tables`
**ใช้ทำอะไร:** สร้างโต๊ะใหม่ (admin เท่านั้น)

**Headers:** `X-Branch-Id` จำเป็น

**Body:**
```json
{
  "code": "T02",
  "name": "โต๊ะ 2",
  "port": 3001,
  "branch_id": 1
}
```

---

### `PATCH /api/tables/:id`
**ใช้ทำอะไร:** แก้ไขข้อมูลโต๊ะ (code, name, port, status, branch_id)

**Headers:** `X-Branch-Id` จำเป็น

---

## Rates (เรทคิดเงิน)

### `GET /api/rates`
**ใช้ทำอะไร:** list เรททั้งหมดของสาขา

**Headers:** `X-Branch-Id` จำเป็น

### `POST /api/rates`
**ใช้ทำอะไร:** สร้างเรทใหม่ (admin)

**Headers:** `X-Branch-Id` จำเป็น

**Body:**
```json
{
  "name": "Day",
  "price_per_unit": 80,
  "minimum_units": 1,
  "rounding_minutes": 10,
  "rounding_mode": "ceil"
}
```

### `PATCH /api/rates/:id`
**ใช้ทำอะไร:** แก้ไขเรท

---

## Sessions (การเล่น)

### `POST /api/sessions/start`
**ใช้ทำอะไร:** **เปิดโต๊ะ** — เริ่มการเล่น สร้าง session + order ให้อัตโนมัติ  
ใช้ราคาจาก **ตาราง tables** (price_per_unit) ไม่ใช้ rate

**Headers:** `X-Branch-Id` จำเป็น

**Body:**
```json
{
  "table_id": 1
}
```

**Response:**
```json
{
  "session": { "id": 5, "table_id": 1, "order_id": 12, "status": "running", "table_code": "T1", "table_name": "โต๊ะ 1", "price_per_unit": 80, ... },
  "order_id": 12
}
```

---

### `GET /api/sessions/:id`
**ใช้ทำอะไร:** ดูรายละเอียด session + ยอดวิ่ง realtime (minutes, units, amount_preview)

---

### `POST /api/sessions/:id/pause`
**ใช้ทำอะไร:** พักการเล่น

### `POST /api/sessions/:id/resume`
**ใช้ทำอะไร:** เล่นต่อหลังพัก

### `POST /api/sessions/:id/move`
**ใช้ทำอะไร:** ย้ายไปเล่นโต๊ะอื่น

**Body:** `{ "to_table_id": 2 }`

### `POST /api/sessions/:id/end`
**ใช้ทำอะไร:** จบการเล่น — คำนวณเงินชั่วโมงทศนิยม lock session และสร้าง order_item ประเภท table_time

---

## Orders (บิล)

### `GET /api/orders`
**ใช้ทำอะไร:** list บิล (query: `status=paid|open|void|all`, `limit`)

**Headers:** `X-Branch-Id` จำเป็น

### `POST /api/orders/open`
**ใช้ทำอะไร:** เปิดบิลใหม่ (ต้องเปิดกะก่อน)

**Headers:** `X-Branch-Id` จำเป็น

### `GET /api/orders/:id`
**ใช้ทำอะไร:** ดูรายละเอียดบิลพร้อม items

### `POST /api/orders/:id/items`
**ใช้ทำอะไร:** เพิ่มสินค้าเข้าบิล

**Body:**
```json
{
  "product_id": 1,
  "qty": 2
}
```

### `PATCH /api/orders/:id/items/:item_id`
**ใช้ทำอะไร:** แก้จำนวนสินค้าในบิล

**Body:** `{ "qty": 3 }`

### `DELETE /api/orders/:id/items/:item_id`
**ใช้ทำอะไร:** ลบรายการสินค้าออกจากบิล

### `POST /api/orders/:id/checkout`
**ใช้ทำอะไร:** ชำระเงิน ปิดบิล

**Body:**
```json
{
  "discount": 10,
  "payments": [
    { "method": "cash", "amount": 200 },
    { "method": "qr", "amount": 50, "ref_no": "REF123" }
  ]
}
```

---

## Products (สินค้า)

### `GET /api/products`
**ใช้ทำอะไร:** list สินค้า (query: `category_id`, `unit`)

### `POST /api/products`
**ใช้ทำอะไร:** สร้างสินค้า (admin)

### `PATCH /api/products/:id`
**ใช้ทำอะไร:** แก้ไขสินค้า

### `PATCH /api/products/:id/stock`
**ใช้ทำอะไร:** ปรับสต็อก (admin)

**Body:** `{ "adjust": 10 }` หรือ `{ "adjust": -5 }`

---

## Product Categories

### `GET /api/product-categories`
**ใช้ทำอะไร:** list หมวดหมู่สินค้า

### `POST /api/product-categories`
### `PATCH /api/product-categories/:id`

---

## Units

### `GET /api/units`
**ใช้ทำอะไร:** list หน่วยสินค้า

### `POST /api/units`
### `PATCH /api/units/:id`
### `DELETE /api/units/:id`

---

## Shifts (กะ)

### `GET /api/shifts`
**ใช้ทำอะไร:** list กะทั้งหมด (สำหรับเลือกรายงาน)

**Headers:** `X-Branch-Id` จำเป็น

### `POST /api/shifts/open`
**ใช้ทำอะไร:** เปิดกะ — ต้องทำก่อนเปิดโต๊ะ/เปิดบิล

**Headers:** `X-Branch-Id` จำเป็น

**Body:** `{ "cash_open": 1000 }` (ไม่บังคับ)

### `GET /api/shifts/current`
**ใช้ทำอะไร:** ดูกะที่เปิดอยู่ปัจจุบัน

**Headers:** `X-Branch-Id` จำเป็น

### `POST /api/shifts/:id/close`
**ใช้ทำอะไร:** ปิดกะ

**Body:** `{ "cash_close": 5000, "note": "..." }`

---

## Reports (รายงาน)

### `GET /api/reports/daily`
**ใช้ทำอะไร:** รายงานรายวัน — ยอดขาย/บิลตามวันที่

**Headers:** `X-Branch-Id` จำเป็น

**Query:** `?date=2025-01-28`

---

### `GET /api/reports/by-table`
**ใช้ทำอะไร:** รายงานโต๊ะ — รายได้และจำนวน session ของแต่ละโต๊ะตามวันที่

**Headers:** `X-Branch-Id` จำเป็น

**Query:** `?date=2025-01-28`

---

### `GET /api/reports/shift/:id`
**ใช้ทำอะไร:** รายงานกะ — ยอดขายและบิลของกะนั้นๆ

**Headers:** `X-Branch-Id` จำเป็น

---

## Stores (ร้าน)

### `GET /api/stores`
**ใช้ทำอะไร:** list ร้าน — admin เห็นทั้งหมด, manager เห็นเฉพาะร้านของตัวเอง

### `GET /api/stores/:id`
**ใช้ทำอะไร:** ดูรายละเอียดร้าน (ชื่อ, logo, ที่อยู่, โทร, etc.)

### `GET /api/stores/:id/branches`
**ใช้ทำอะไร:** สาขาทั้งหมดของร้าน — สำหรับ admin ร้านกวดสอ

### `POST /api/stores`
**ใช้ทำอะไร:** สร้างร้าน (admin เท่านั้น)

**Body:** `{ "name", "logo", "address", "phone", "tax_id", "email" }`

### `PATCH /api/stores/:id`
**ใช้ทำอะไร:** แก้ไขข้อมูลร้าน (admin, manager แก้ได้เฉพาะร้านของตัวเอง)

---

## Branches (สาขา)

### `GET /api/branches`
**ใช้ทำอะไร:** list สาขาทั้งหมด

### `POST /api/branches`
**ใช้ทำอะไร:** สร้างสาขาใหม่ (admin)

**Body:**
```json
{
  "code": "002",
  "name": "สาขา 2",
  "address": "...",
  "phone": "..."
}
```

### `PATCH /api/branches/:id`
**ใช้ทำอะไร:** แก้ไขสาขา

---

## Users

### `GET /api/users`
**ใช้ทำอะไร:** list ผู้ใช้

### `POST /api/users`
### `PATCH /api/users/:id`
### `DELETE /api/users/:id`

---

## Payment Banks

### `GET /api/payment-banks`
**ใช้ทำอะไร:** list ธนาคารสำหรับรับโอน/QR

### `POST /api/payment-banks`
### `PATCH /api/payment-banks/:id`
### `DELETE /api/payment-banks/:id`

---

## Health

### `GET /health`
**ใช้ทำอะไร:** ตรวจสอบว่า server ทำงานอยู่

**Auth:** ไม่ต้อง

**Response:** `{ "ok": true, "ts": "..." }`
