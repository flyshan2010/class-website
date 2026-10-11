/**
 * 同生同日同科「主動舉手發表」只算一筆（純函式，不連 Notion、不寫任何東西）
 * ───────────────────────────────────────────────────────────────
 * 裁定：SPEC_學習報告評分標準v2.md「每生每科每天只算一筆」（09-05 拍板 #8）。
 * 背景（2026-10-11）：第 6 週 R01 一句話入庫把同生同日同科的舉手寫了兩筆，共三組，
 *   週結 f29 照「紀錄id×學生id」防重複鍵各入一次帳——那個鍵擋的是「同一列入兩次」，
 *   擋不到「兩列講同一件事」。這一步的結果完全由輸入決定，所以寫成程式（護欄 §4，U72）。
 *
 * 適用列（四個條件都要成立，全部是欄位值、沒有語意判斷）：
 *   類別＝課堂表現、正負向＝＋、程度＝1、金幣影響＞0
 *   → 作廢列（【待刪】＋金幣 0＋中性，U63）自然不在範圍內，不會占掉名額。
 * 分組鍵＝學生 id × 日期 × 科目。一列掛多人時逐人展開，每人各自判。
 * 留哪一筆：帳本已入帳的優先（錢已經動了，名額就算它的）；都沒入帳留最早建立的
 *   （建立時間 → 事件id → 頁 id，三層都是為了結果不隨查詢順序變）。
 * 判不出的（科目空白、日期格式不對）不猜、不去重，列進 manual 給人看。
 *
 * 同一套判斷多處要用就引用這一支（U83）：週結試算 f24 與入帳 f29 都 import，不各寫一份。
 */

export const isCapped = r =>
  r.cat === "課堂表現" && r.sign === "＋" && r.level === 1 && r.coin > 0;

const keyOf = r => `${r.stuId}|${r.date}|${r.subject}`;
export const pairKey = r => `${r.logId}|${r.stuId}`;
const order = (a, b) =>
  String(a.created ?? "").localeCompare(String(b.created ?? "")) ||
  String(a.eid ?? "").localeCompare(String(b.eid ?? "")) ||
  String(a.logId).localeCompare(String(b.logId));

/**
 * @param pairs  [{ logId, stuId, date, subject, cat, sign, level, coin, created, eid }]（一列×一位學生＝一筆）
 * @param booked Set<"logId|stuId">，帳本已入帳的鍵（沒有就傳空集合＝當作都還沒入帳）
 * @returns {
 *   skip:   Set<"logId|stuId">  這次不該入帳的（重複未入帳）
 *   groups: [{ stuId, date, subject, keep, unpaid: [...], overpaid: [...] }]  有重複的組
 *           unpaid＝重複且尚未入帳（會被 skip）；overpaid＝重複且已入帳（錢已動，要人工補扣，程式不碰）
 *   manual: [...]  符合條件但科目或日期判不出，未去重
 * }
 */
export function oncePerDay(pairs, booked = new Set()) {
  const byKey = new Map();
  const manual = [];
  for (const r of pairs) {
    if (!isCapped(r)) continue;
    if (!r.subject || !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "")) { manual.push(r); continue; }
    const k = keyOf(r);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const skip = new Set();
  const groups = [];
  for (const rows of byKey.values()) {
    if (rows.length < 2) continue;
    rows.sort(order);
    const paid = rows.filter(r => booked.has(pairKey(r)));
    const keep = paid[0] ?? rows[0];
    const unpaid = rows.filter(r => r !== keep && !booked.has(pairKey(r)));
    const overpaid = paid.filter(r => r !== keep);
    for (const r of unpaid) skip.add(pairKey(r));
    groups.push({ stuId: keep.stuId, date: keep.date, subject: keep.subject, keep, unpaid, overpaid });
  }
  groups.sort((a, b) => a.date.localeCompare(b.date) || order(a.keep, b.keep));
  return { skip, groups, manual };
}

/** Notion 紀錄庫頁物件 → pairs（一列掛幾位學生就展開成幾筆）。f24／f29／演練共用同一份欄位讀法。 */
export function pairsOfPage(p) {
  const pr = p.properties ?? {};
  const text = k => (pr[k]?.rich_text ?? []).map(t => t.plain_text).join("");
  const base = {
    logId: p.id,
    date: (pr["日期"]?.date?.start ?? "").slice(0, 10),
    subject: pr["科目"]?.select?.name ?? "",
    cat: pr["類別"]?.select?.name ?? "",
    sign: pr["正負向"]?.select?.name ?? "",
    level: pr["程度"]?.number ?? null,
    coin: pr["金幣影響"]?.number ?? 0,
    created: p.created_time ?? "",
    eid: text("事件id"),
  };
  return (pr["學生"]?.relation ?? []).map(r => ({ ...base, stuId: r.id }));
}
