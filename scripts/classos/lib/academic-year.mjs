/**
 * ClassOS｜民國學年判定（SPEC_學年升級 §1 唯一真值來源）
 *
 * 115 學年 ＝ 2026-08-01 ～ 2027-07-31（老師 2026-07-25 裁示）
 *
 *   學年 = 西元年 - 1911 - (月份 < 8 ? 1 : 0)
 *
 * ⚠️ 所有 skill 與腳本一律引用本模組，不得各自實作。
 * ⚠️ 補登舊日期資料時，必須以「該筆資料的日期」計算，不可用當下日期。
 *    例：8 月補登 7 月的事，學年是 114 不是 115。
 */

/** 學年制起始月份：8 月。 */
export const YEAR_START_MONTH = 8;

/** 「學年」欄位起始生效日——此日之前建立的列視為舊模擬資料（SPEC §5）。 */
export const YEAR_FIELD_EPOCH = "2026-08-01T00:00:00+08:00";

/**
 * 由日期計算民國學年。
 * @param {string|Date} date 資料本身的日期（非今日），如 "2026-07-24"
 * @returns {number} 民國學年，如 114
 */
export function academicYear(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error(`無法解析日期：${date}`);
  // 用台北時區的年月，避免 UTC 換日在 8/1 前後判錯學年。
  const [y, m] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit",
  }).format(d).split("-").map(Number);
  return y - 1911 - (m < YEAR_START_MONTH ? 1 : 0);
}

/** 學年的字串形式，即 Notion `學年` select 的選項值（純數字，不含「學年」二字）。 */
export function academicYearValue(date) {
  return String(academicYear(date));
}

/** 該學年的起訖日（台北時間），供產生檢視過濾條件用。 */
export function academicYearRange(year) {
  return { start: `${year + 1911}-08-01`, end: `${year + 1912}-07-31` };
}

/** §1 四個邊界日期自我驗證，供驗收與 CI 使用。回傳 true 表示公式正確。 */
export function selfTest() {
  const cases = [
    ["2026-08-01", 115], ["2026-12-31", 115],
    ["2027-07-31", 115], ["2027-08-01", 116],
  ];
  let allPass = true;
  for (const [date, expect] of cases) {
    const got = academicYear(date);
    const pass = got === expect;
    if (!pass) allPass = false;
    console.log(`${pass ? "✅" : "❌"} ${date} → ${got}（預期 ${expect}）`);
  }
  return allPass;
}
