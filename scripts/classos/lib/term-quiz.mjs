/**
 * 平時考（紀錄庫「評量」類）判定與彙整——唯一一份規則（U83）：
 *   f48 試算平考、f49 寫入學期成績庫、sync-notion 產「📈 平時評量」加密分頁都 import 這支。
 * 老師 2026-10-17 定案（BT 線建議 1–7）：
 *   - 分數讀紀錄庫 number「分數」欄、名稱讀「評量名稱」；不再從事件描述解析「NN分」。
 *   - 缺考＝分數留空且事件描述含「缺考」→ 不計入平均，分頁顯示「缺考（不計入）」。
 *   - 範圍：期中＝開學～期中考前一天；期末＝期中考第一天～期末考前一天（日期讀 data/calendar.json）。
 *   - 平均取整數：Math.floor(x + 0.5)（＝四捨五入，禁用銀行家捨入）。
 *   - 國數社寫進學期成績庫○○平考；其他科（綜合／健康／崑山活力Go／其他）只寫備註、分頁列「參考」。
 *   - 不放全班平均、不排名。
 * 純函式、不讀檔、不連 Notion。
 */

export const MAIN = ["國語", "數學", "社會"];
export const OTHERS = ["綜合", "健康", "崑山活力Go", "其他"];

/** 四捨五入取整數（0.5 一律進位）。 */
export const roundHalfUp = (x) => Math.floor(x + 0.5);
/** 四捨五入到小數一位（走勢差值用）。 */
export const round1 = (x) => Math.floor(x * 10 + 0.5) / 10;

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * 學期＋階段 → 平時考日期範圍（含頭含尾）。
 * @param {Array} calendar data/calendar.json（{ title, date, endDate, type }）
 * @param {object} weeks data/weeks.json
 * @param {string} term 學期成績庫「學期」欄，如「115上」
 * @param {"期中"|"期末"} stage
 * @returns {{from:string,to:string}|{error:string}}
 */
export function quizRange(calendar, weeks, term, stage) {
  const m = String(term).match(/^(\d{3})([上下])$/);
  if (!m) return { error: `學期格式要像 115上：${term}` };
  const t = (weeks?.學期 || []).find((x) => String(x.學年) === m[1] && x.學期 === m[2]);
  if (!t) return { error: `weeks.json 查無 ${term}` };
  const inTerm = (e) => e.date >= t.開學日 && e.date <= t.休業日;
  const exam = (name) => (calendar || []).filter((e) => e.title === name && inTerm(e)).map((e) => e.date).sort()[0];
  const mid = exam("期中考"), fin = exam("期末考");
  if (!mid) return { error: `行事曆查無 ${term} 期中考` };
  // 開學前的預排日（返校日等）歸第 1 週，平時考範圍一併從那天起算
  const pre = (t.週?.[0]?.預排日 || []).slice().sort()[0];
  const start = pre && pre < t.開學日 ? pre : t.開學日;
  if (stage === "期中") return { from: start, to: addDays(mid, -1) };
  if (stage === "期末") {
    if (!fin) return { error: `行事曆查無 ${term} 期末考` };
    return { from: mid, to: addDays(fin, -1) };
  }
  return { error: `階段只能是期中／期末：${stage}` };
}

/**
 * 紀錄庫一列 → 平時考項目。只收類別＝評量。
 * rec：{ date, category, subject, score, name, desc }
 * 回傳 { date, subject, name, score, absent, manual }：
 *   manual＝這列判不出（沒分數也不是缺考、分數超出 0–100、科目空白）→ 不進平均，交老師看（fail-closed）。
 */
export function toQuiz(rec) {
  if (rec.category !== "評量") return null;
  const desc = String(rec.desc ?? "");
  const raw = rec.score;
  const has = raw !== null && raw !== undefined && raw !== "";
  const score = has ? Number(raw) : null;
  const absent = !has && desc.includes("缺考");
  const subject = String(rec.subject ?? "").trim();
  const name = String(rec.name ?? "").trim() || desc;
  let manual = null;
  if (!subject) manual = "科目空白";
  else if (has && !(Number.isFinite(score) && score >= 0 && score <= 100)) manual = "分數不在 0–100";
  else if (!has && !absent) manual = "沒有分數（也沒寫缺考）";
  return { date: String(rec.date ?? "").slice(0, 10), subject, name, score: has ? score : null, absent, manual };
}

/** 依日期範圍（含頭含尾）篩。 */
export const inRange = (q, r) => q.date >= r.from && q.date <= r.to;

/** 走勢：近 k 次對比緊接在前的 k 次，k＝min(3, ⌊n/2⌋)；不到 2 次沒有走勢。 */
export function trendOf(scores) {
  const k = Math.min(3, Math.floor(scores.length / 2));
  if (k < 1) return null;
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const recent = scores.slice(-k), before = scores.slice(-2 * k, -k);
  return { k, delta: round1(avg(recent) - avg(before)) };
}

/**
 * 一位學生的平時考彙整。
 * @param {Array} quizzes toQuiz() 的結果（已篩範圍）
 * @returns {{ subjects: Record<string,object>, others: Array, manual: Array }}
 */
export function summarize(quizzes) {
  const ok = quizzes.filter((q) => q && !q.manual).sort((a, b) => a.date.localeCompare(b.date));
  const subjects = {};
  for (const s of MAIN) {
    const items = ok.filter((q) => q.subject === s);
    const scores = items.filter((q) => !q.absent).map((q) => q.score);
    subjects[s] = {
      avg: scores.length ? roundHalfUp(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      n: scores.length,
      absent: items.filter((q) => q.absent).length,
      latest: scores.length ? scores[scores.length - 1] : null,
      trend: trendOf(scores),
      items: items.map(({ date, name, score, absent }) => ({ date, name, score, absent })),
    };
  }
  const others = ok.filter((q) => !MAIN.includes(q.subject))
    .map(({ date, subject, name, score, absent }) => ({ date, subject, name, score, absent }));
  const manual = quizzes.filter((q) => q && q.manual).map(({ date, subject, manual }) => ({ date, subject, why: manual }));
  return { subjects, others, manual };
}

/** 其他科寫進學期成績庫「備註」的一句（無其他科回空字串）。 */
export function othersNote(others) {
  const by = {};
  for (const o of others) if (!o.absent) (by[o.subject] ??= []).push(o.score);
  const parts = Object.entries(by).map(([s, a]) => `${s} ${roundHalfUp(a.reduce((x, y) => x + y, 0) / a.length)}（${a.length} 次）`);
  return parts.length ? `其他科平時考平均：${parts.join("、")}` : "";
}

/**
 * 依走勢的一句複習建議（分頁用，規則寫死、結果由輸入決定）。
 * 下降（差 ≤ −3）挑跌最多的一科，點名最近 k 次的評量名稱；沒有下降而有上升（≥ 3）就鼓勵；其餘持平。
 */
export function reviewTip(subjects, stage = "期中") {
  const rows = MAIN.map((s) => ({ s, t: subjects[s]?.trend, items: subjects[s]?.items || [] })).filter((r) => r.t);
  if (!rows.length) return "";
  const down = rows.filter((r) => r.t.delta <= -3).sort((a, b) => a.t.delta - b.t.delta)[0];
  const exam = stage === "期末" ? "期末考" : "期中考";
  if (down) {
    const names = down.items.filter((q) => !q.absent).slice(-down.t.k).map((q) => q.name).filter(Boolean);
    return `${down.s}最近 ${down.t.k} 次往下走，${exam}前建議優先複習${names.length ? `「${names.join("」「")}」` : "最近幾次"}的易錯題。`;
  }
  const up = rows.filter((r) => r.t.delta >= 3).map((r) => r.s);
  if (up.length) return `${up.join("、")}最近進步了，保持目前的複習節奏。`;
  return "各科走勢平穩，保持目前的複習節奏，考前把錯過的題目再做一次。";
}
