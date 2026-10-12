/**
 * 全班集資（商店 ⑥ 層）共用規則：純函式，不連 Notion。
 * ───────────────────────────────────────────────────────────────
 * 兩個地方共用同一份（U83，不各寫一套）：
 *   - scripts/sync-notion.mjs 的 syncClassGoal（班網進度條）
 *   - scripts/classos/lib/r19-donations.mjs（一句話任務捐款入帳，判斷目標是否已達上限）
 * 規格：ClassOS_v3.5_藍圖/SPEC_班級經濟機制.md §2。
 */
export const GOAL_TIER = "⑥ 全班集資・共同達成";
// 參與門檻＝在學人數的 3/4，**無條件捨去**：27 人 → 20 人。
// 捨去不是進位——老師在 SPEC §2-3 明寫「27 人 → 20 人」（27×3/4＝20.25，進位會變 21）。
// 門檻是「讓人人進得來」的設計，取捨有疑義時往寬的那邊走。
export const GOAL_THRESHOLD_RATIO = 3 / 4;
export const backersNeededOf = (enrolled) => Math.max(1, Math.floor(enrolled * GOAL_THRESHOLD_RATIO));

/** 開放期間判定（起／迄皆可空；空白＝常態開放；迄日當天仍算開放）。 */
export const inWindow = (from, to, today) => (!from || from <= today) && (!to || today <= to);

/** 捐款事由前綴：事由以它開頭才算這個目標的捐款（名稱一旦有捐款就不可改）。 */
export const goalPrefix = (name) => `集資-${name}`;

/**
 * 依時間順序累計一個目標的捐款，算出「本輪」進度與已達成輪數。
 * txs＝[{ amount, student, date }]，**必須已依日期由舊到新排序**；amount 正負皆可（取絕對值）。
 * 回傳 { raised, backers, roundsDone, closed, lastDate }。
 */
export function tallyGoal(txs, { target, limit, backersNeeded }) {
  let rounds = 0, pool = 0, lastDate = "";
  let backers = new Set();
  for (const t of txs) {
    pool += Math.abs(Math.round(Number(t.amount) || 0));
    // distinct 學生，不是筆數——同一人捐三次只算一人（U41 同一個病）
    backers.add(t.student);
    const d = t.date || "";
    if (d > lastDate) lastDate = d;
    if (target > 0 && rounds < limit && pool >= target && backers.size >= backersNeeded) {
      rounds++; pool = 0; backers = new Set();
    }
  }
  return { raised: pool, backers: backers.size, roundsDone: rounds, closed: rounds >= limit, lastDate };
}
