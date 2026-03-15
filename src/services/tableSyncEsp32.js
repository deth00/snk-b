/** URL ส่ง sync ไป ESP32. กำหนดใน .env: ESP32_TABLE_SYNC_URL */
const ESP32_SYNC_URL = process.env.ESP32_TABLE_SYNC_URL || 'https://snk-esp32.mesok999.com/api/table-sync';
/** คีย์สำหรับ ESP32 (ถ้าต้องการ). กำหนดใน .env: ESP32_DEVICE_KEY */
const ESP32_DEVICE_KEY = process.env.ESP32_DEVICE_KEY || '';

/**
 * Fire-and-forget POST to ESP32 — ส่งรูปแบบ { device_key, branch_id, tables: [...] }
 * @param {{ id: number, code: string, port: number, status: string } | Array<{ id, code, port, status }>} tableOrTables - โต๊ะเดียวหรือ array
 * @param {number} branchId - branch_id
 */
export async function syncTableToEsp32(tableOrTables, branchId) {
  const tables = Array.isArray(tableOrTables)
    ? tableOrTables.map((t) => ({ id: t.id, code: t.code, port: t.port ?? 0, status: t.status }))
    : [{ id: tableOrTables.id, code: tableOrTables.code, port: tableOrTables.port ?? 0, status: tableOrTables.status }];
  const body = {
    device_key: 'snk_branch_1_secret_key',
    branch_id: Number(branchId),
    tables,
  };
  console.log('[ESP32 sync] sending:', JSON.stringify(body));
  try {
    const resp = await fetch(ESP32_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    console.log('[ESP32 sync] response:', resp.status, resp.statusText);
  } catch (err) {
    console.warn('[ESP32 sync] failed:', err.message || err);
  }
}
