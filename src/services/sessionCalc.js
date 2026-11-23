/**
 * Business Logic: คำนวณเวลาเล่นและเงิน (เป็นนาที, จำนวนเงินปัดเป็นจำนวนเต็ม)
 * 1) played_seconds = (now - started_at) - paused_seconds - (ถ้า paused อยู่ ให้หัก now-paused_at เพิ่ม)
 * 2) minutes_raw = ceil(played_seconds / 60)
 * 3) ปัดเศษเป็นนาที (rounding_minutes, mode)
 * 4) minutes = คำนวณจากขั้นตอน 2-3
 * 5) amount = (minutes/60) * price_per_unit แล้วปัดเป็นจำนวนเต็ม (ກີບ)
 */

import { parseLaoDateTime } from '../utils/time.js';

const BILLING_AMOUNT_STEP = 500;

export function roundBillingAmount(amount) {
  const value = Number(amount) || 0;
  if (value <= 0) return 0;
  return Math.ceil(value / BILLING_AMOUNT_STEP) * BILLING_AMOUNT_STEP;
}

export function computeSessionAmount(session, pricing, asOf = new Date()) {
  const startedAt = parseLaoDateTime(session.started_at);
  if (!startedAt || Number.isNaN(startedAt.getTime())) {
    return { played_seconds: 0, minutes_raw: 0, minutes: 0, units: 0, amount: 0 };
  }
  let pausedSeconds = Number(session.paused_seconds) || 0;
  const pausedAt = session.paused_at ? parseLaoDateTime(session.paused_at) : null;
  const status = session.status;

  // ถ้ากำลัง paused อยู่ ให้บวกเวลาที่ pause ไปแล้วจนถึง asOf
  if (status === 'paused' && pausedAt) {
    pausedSeconds += Math.floor((asOf - pausedAt) / 1000);
  }

  const endTime = status === 'ended' && session.ended_at ? parseLaoDateTime(session.ended_at) : asOf;
  let playedSeconds = Math.max(0, Math.floor((endTime - startedAt) / 1000) - pausedSeconds);

  let minutesRaw = Math.ceil(playedSeconds / 60);

  const roundingMinutes = Number(pricing.rounding_minutes) ?? 0;
  const roundingMode = pricing.rounding_mode || 'ceil';

  let minutes = minutesRaw;
  if (roundingMinutes > 0) {
    if (roundingMode === 'ceil') {
      minutes = Math.ceil(minutesRaw / roundingMinutes) * roundingMinutes;
    } else if (roundingMode === 'floor') {
      minutes = Math.floor(minutesRaw / roundingMinutes) * roundingMinutes;
    } else {
      minutes = Math.round(minutesRaw / roundingMinutes) * roundingMinutes;
    }
  }

  let units = minutes / 60.0;
  const minimumUnits = Number(pricing.minimum_units) ?? 0;
  units = Math.max(units, minimumUnits);

  const pricePerUnit = Number(pricing.price_per_unit) || 0;
  // คำนวณจากนาที แล้วปัดยอดขึ้นเป็นขั้นละ 500 LAK เช่น 100-500 => 500, 501-1000 => 1000
  const amount = roundBillingAmount(units * pricePerUnit);

  return {
    played_seconds: playedSeconds,
    minutes_raw: minutesRaw,
    minutes,
    units: Math.round(units * 100) / 100,
    amount,
  };
}
