/**
 * 浮動價格的共用邏輯（SPEC_班級經濟機制 §3、§4）——純函式，不碰 Notion。
 * ───────────────────────────────────────────────────────────────
 * `W` 的算法**只有這一份**（SPEC §5-1）：f24 印 W、f33 算調價都呼叫 computeW，不各算各的。
 *
 * 期別與時程（2026-09-24 老師定案）：
 *   9–10 → 每學年第一期＝**基準期**：倒數第二次週結只記錄 W₀，不調價
 *   11–12 → 倒數第二次週結算 R＝W(11–12)÷W(9–10)，1/01 生效
 *   2–3  → 倒數第二次週結算 R＝W(2–3)÷W(11–12)，4/01 生效
 *   4–5  → 不算（6 月不調，期末直接收尾）
 */

export const PERIODS = [
  { months: [9, 10], prev: null, effective: "11-01" },          // 基準期
  { months: [11, 12], prev: [9, 10], effective: "01-01" },
  { months: [2, 3], prev: [11, 12], effective: "04-01" },
  { months: [4, 5], prev: [2, 3], effective: null },            // 6 月不調
];

// §3-4 三條阻尼
export const DEAD_LO = 0.9, DEAD_HI = 1.1;   // R 在這之間（含端點）不調
export const MAX_STEP = 0.3;                 // 單期最多 ±30%
export const MIN_WEEKS = 3;                  // 本期可計週數少於此＝資料不完整，不調（fail-closed）
// 只調 ②③⑤⑥ 層；①（社會性・免費）④（創造沙盒）不調。沒填層級＝第二層（同 sync-notion STORE_DEFAULT_TIER）
export const ADJUST_TIERS = ["②", "③", "⑤", "⑥"];
export const tierAdjustable = tier => ADJUST_TIERS.includes(String(tier || "②").trim().slice(0, 1));

/** 某日期落在哪一期；不在任何期（1、6、7、8 月）回 null。 */
export function periodOf(iso) {
  const m = Number(iso.slice(5, 7));
  return PERIODS.find(p => p.months.includes(m)) || null;
}

/** 期間的起迄日（兩個月必在同一西元年）。 */
export function periodRange(months, year) {
  const from = `${year}-${String(months[0]).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(year, months[1], 0)).toISOString().slice(0, 10);
  return { from, to, label: `${months[0]}–${months[1]} 月` };
}

/** 上一期的西元年：11–12 的上一期 9–10 同年；2–3 的上一期 11–12 在前一年。 */
export const prevYear = (curMonths, year) => (curMonths[0] === 2 ? year - 1 : year);

/**
 * 「倒數第二次週結」那一週：期內（週一落在期內）的上課週，取倒數第二週。
 * 用「週」而不是「哪一個週五」比對——週五放假提早週結（例：9/24 週四）也對得上。
 */
export function calcWeekOf(weeksFile, months, year) {
  const { from, to } = periodRange(months, year);
  const ws = (weeksFile.學期 ?? []).flatMap(t => t.週 ?? [])
    .filter(w => w.起 >= from && w.起 <= to)
    .sort((a, b) => a.起.localeCompare(b.起));
  return ws.length >= 2 ? ws[ws.length - 2] : null;
}

/**
 * W＝期內所有帳列金額淨總和 ÷ 在學人數 ÷ 已過上課週數（排除學期第 1 週）。
 * asOf：只算到這天為止（本期用今天；上一期傳期末即可）。
 * 捨入禁用 round()——一律 floor(x+0.5)。
 */
export function computeW({ ledgerRows, weeksFile, rosterN, months, year, asOf }) {
  const { from, to, label } = periodRange(months, year);
  const weeks = (weeksFile.學期 ?? []).flatMap(t => (t.週 ?? [])
    .filter(w => w.週次 !== 1 && w.起 >= from && w.起 <= to && w.起 <= asOf));
  const wFrom = weeks.length ? weeks[0].起 : from;
  let net = 0;
  for (const b of ledgerRows) {
    if (!b.date || b.date < wFrom || b.date > to || b.date > asOf) continue;
    net += b.amount;
  }
  const W = weeks.length && rosterN ? Math.floor(net / rosterN / weeks.length + 0.5) : null;
  return { W, weeks: weeks.length, net, label };
}

/** 新價＝舊價×R（R 先夾在 ±30%），四捨五入到 5 的倍數（ROUND_HALF_UP）。 */
export function newPrice(old, R) {
  const r = Math.min(1 + MAX_STEP, Math.max(1 - MAX_STEP, R));
  return Math.floor(old * r / 5 + 0.5 + 1e-9) * 5;   // 1e-9：擋浮點誤差把 x.5 算成 x.4999
}

export const inDeadZone = R => R >= DEAD_LO && R <= DEAD_HI;

/** 調價公告的固定標題——f33 建、f34 用它找「否決調價」勾選，兩邊必須逐字一致。 */
export const announceTitle = effDate => `🏪 商店調價預告｜${effDate} 起新價格`;

/** ISO 日期加天數（純日期運算，不受時區影響）。 */
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
