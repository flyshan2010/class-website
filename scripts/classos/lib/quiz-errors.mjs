/**
 * 平時卷錯題分析（BY 線，老師 2026-10-18 裁定）——唯一一份規則（U83）：
 *   教師專區錯題表 quiz.html「複製成績」產錯題碼 → class-log 寫進紀錄庫評量列「錯題」欄
 *   → sync-notion 讀「📝 平時卷」庫（題目結構＋答案＋知識點＋建議）用這支算每生每卷分析，只進該生加密報告。
 * 規則：
 *   - 錯題碼＝大題中文序＋題號（去空白），逗號分隔；部分扣分帶 (-n)，沒帶＝整題配分；全對寫「無」。
 *     例「三2,一5,四填6(-1)」。題號與 quiz.html 的 itemCode() 同一套寫法（兩邊改要一起改）。
 *   - 知識點得分率＝這一類拿到的分 ÷ 這一類總分，四捨五入取整數百分比（Math.floor(x+0.5)）。
 *   - 複習建議＝扣分 ≥ 2 且得分率 < 80% 的類，依得分率低→高（同率扣分多的先）排序，最多 5 類（與錯題表同一條件）。
 *   - 判不出就不畫（fail-closed）：錯題碼對不到題目、扣分超過配分、算出來的分數≠紀錄庫分數 → 這份卷不出分析，回 manual 交老師看。
 *   - 公開規則（老師 2026-10-18 定案）：錯題明細（題號、知識點、扣分）報告發布即公開；
 *     正確答案（ans）與試卷連結只在今天 ≥ 該卷解答開放日才輸出，未到（或沒填）就從資料端剝掉，不靠前端藏。
 *   - 觀念複習卡：每條建議與每道錯題連到「📚 觀念複習卡」同科目、卡名＝知識點名一字不差的上架卡；
 *     對不到卡就不放連結（card:null），由 sync 列進「需人工」。
 * 純函式、不讀檔、不連 Notion。
 */

const SEC = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
export const MAX_TIPS = 5;

/** 題目代碼：第 si 個大題（0 起）＋題號去空白。 */
export const itemCode = (si, no) => `${SEC[si] ?? `${si + 1}.`}${String(no).replace(/\s+/g, "")}`;

/** 四捨五入取整數百分比。 */
const pct = (got, full) => Math.floor((got / full) * 100 + 0.5);

/**
 * 解析錯題碼字串。
 * @returns {{none:true}|{entries:Array<{code:string,ded:number|null}>}|{error:string}}
 */
export function parseErrorCode(text) {
  const t = String(text ?? "").trim().replace(/^錯[:：]\s*/, "");
  if (!t) return { error: "錯題欄空白" };
  if (t === "無") return { none: true };
  const entries = [];
  for (const tok of t.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = tok.match(/^(.+?)(?:[(（]\s*-\s*(\d+(?:\.\d+)?)\s*[)）])?$/);
    if (!m) return { error: `看不懂：${tok}` };
    entries.push({ code: m[1].replace(/\s+/g, ""), ded: m[2] != null ? Number(m[2]) : null });
  }
  return entries.length ? { entries } : { error: "錯題欄空白" };
}

/** 卷 JSON（quiz-exam/1）攤平成題目清單。 */
export function flatItems(exam) {
  const out = [];
  (exam.sections || []).forEach((sec, si) => {
    const secName = String(sec.name || "").replace(/（[^）]*）|\([^)]*\)/g, "").trim();
    (sec.items || []).forEach(([no, pts, ans, tag]) => {
      out.push({ code: itemCode(si, no), label: `${secName} ${no}`, pts: Number(pts) || 0, ans: String(ans ?? ""), tag });
    });
  });
  return out;
}

/** 紀錄日期 → 學期標籤（如 115上）：8–12 月與 1 月＝上，2–7 月＝下。 */
export function termOf(date) {
  const [y, m] = String(date).slice(0, 7).split("-").map(Number);
  if (!y || !m) return "";
  return `${y - 1911 - (m < 8 ? 1 : 0)}${m >= 8 || m === 1 ? "上" : "下"}`;
}

/**
 * 紀錄庫評量列對應平時卷：同學期（卷 id 開頭）＋同科目＋名稱相同（去空白比）。
 * 對到 0 份或 2 份以上都回 null（不猜）。
 */
export function matchExam(exams, rec) {
  const norm = (s) => String(s ?? "").replace(/\s+/g, "");
  const term = termOf(rec.date);
  const hit = exams.filter((e) => String(e.id).startsWith(term) && e.subject === rec.subject && norm(e.name) === norm(rec.name));
  return hit.length === 1 ? hit[0] : null;
}

/**
 * 一位學生一份卷的分析。
 * @param {object} exam 卷 JSON（quiz-exam/1）
 * @param {string} code 紀錄庫「錯題」欄
 * @param {number} score 紀錄庫「分數」欄
 * @returns {{manual:string}|{score:number,kp:Array,tips:Array,wrong:Array}}
 */
export function analyze(exam, code, score) {
  const items = flatItems(exam);
  const parsed = parseErrorCode(code);
  if (parsed.error) return { manual: parsed.error };
  const byCode = new Map(items.map((it) => [it.code, it]));
  if (byCode.size !== items.length) return { manual: "卷裡有重複的題號（同大題同題號），錯題碼分不出是哪一題" };
  const lost = new Map();
  const wrong = [];
  for (const e of parsed.entries || []) {
    const it = byCode.get(e.code);
    if (!it) return { manual: `錯題碼對不到題目：${e.code}` };
    if (lost.has(it.code)) return { manual: `同一題登記兩次：${e.code}` };
    const d = e.ded == null ? it.pts : e.ded;
    if (!(d > 0 && d <= it.pts)) return { manual: `扣分超過配分：${e.code}` };
    lost.set(it.code, d);
    wrong.push({ label: it.label, lost: d, ans: it.ans || "（看老師評語）", tag: exam.tags?.[it.tag]?.[0] ?? it.tag });
  }
  const total = items.reduce((a, it) => a + it.pts, 0);
  const lostSum = [...lost.values()].reduce((a, b) => a + b, 0);
  const calc = total === 100 ? 100 - lostSum : pct(total - lostSum, total);
  if (Number(score) !== calc) return { manual: `錯題算出 ${calc} 分，紀錄是 ${score} 分` };
  const kp = Object.entries(exam.tags || {}).map(([t, [name, tip]]) => {
    const its = items.filter((it) => it.tag === t);
    const full = its.reduce((a, it) => a + it.pts, 0);
    const l = its.reduce((a, it) => a + (lost.get(it.code) || 0), 0);
    return { t, name, tip, full, lost: l, rate: full ? pct(full - l, full) : null };
  }).filter((k) => k.full);
  const tips = kp.filter((k) => k.lost >= 2 && k.rate < 80)
    .sort((a, b) => a.rate - b.rate || b.lost - a.lost).slice(0, MAX_TIPS)
    .map((k) => ({ name: k.name, tip: k.tip }));
  return { score: calc, kp: kp.map((k) => ({ name: k.name, rate: k.rate })), tips, wrong };
}

/** 觀念複習卡網址（班網 review.html：每科一頁，#卡名 直接跳到該張卡）。 */
export const cardHref = (subject, name) => `review.html?s=${encodeURIComponent(subject)}#${encodeURIComponent(name)}`;

/**
 * 組成報告用的一份卷。
 * meta：{ subject, name, date, open, paper, review }（open＝解答開放日 YYYY-MM-DD 或空）
 * hasCard(subject, name)：該知識點有沒有上架的觀念複習卡。
 * 錯題明細一律輸出；ans 與 paper 只在開放日（含）起才輸出——閘門在這裡，不在前端。
 */
export function reportItem(meta, result, today, hasCard = () => false) {
  const unlocked = !!meta.open && today >= meta.open;
  const card = (name) => (hasCard(meta.subject, name) ? cardHref(meta.subject, name) : null);
  const out = {
    subject: meta.subject, name: meta.name, date: meta.date, score: result.score,
    kp: result.kp, tips: result.tips.map((t) => ({ ...t, card: card(t.name) })),
    wrong: result.wrong.map((w) => ({ label: w.label, lost: w.lost, tag: w.tag, card: card(w.tag), ...(unlocked ? { ans: w.ans } : {}) })),
    review: meta.review || null, open: meta.open || null, unlocked,
  };
  if (unlocked) out.paper = meta.paper || null;
  return out;
}

/** 這份卷裡對不到觀念複習卡的知識點（給 sync 列「需人工」）。 */
export const missingCards = (item) => [...new Set([...item.tips, ...item.wrong].filter((x) => !x.card).map((x) => x.name ?? x.tag))];
