/**
 * 學期成績「○○日常」「○○作業」自動換分——唯一一份規則（U83）：f50 試算、f51 寫入都 import 這支。
 * 老師 2026-10-18 定案（規則正本 班級事務/.claude/skills/class-grades/SPEC_class-grades.md「日常／作業自動換分」）：
 *
 * 日常（A 案）＝基本分＋該科加分，四捨五入取整數、上限 100：
 *   - 基本分＝每週「上課參與」等第換分（特優 100／優 95／甲 90／乙 85／丙 75）的學期平均，三科同；
 *     週等第判法共用 lib/report-grades.mjs 的 participation()（學習報告同一套），不另寫。
 *   - 該科加分＝每週「該科最高正向課堂程度」（舉手／上台 1、帶動小組 2、帶全班 3，沒有 0）的學期平均 × 3，上限 +10。
 *   - 負向不分科另扣（已在週等第裡）；科目空白的正向課堂紀錄不計，列進試算清單給老師看。
 *   - 週次歸屬看該週「上課起」（週一）落在哪個階段範圍；還沒開始上課的週不算。
 *
 * 作業＝逐份作業換分取平均，四捨五入取整數：
 *   - 最後有完成＝100（含訂正後完成、請假後補完、已交後批改完成）；到結算仍要訂正＝80；仍未交＝0。
 *   - 一份作業看檢核台作業清點（事件id 開頭 homework-）的紀錄，依日期取最後一筆；同一天以較好的結果為準。
 *   - 只算國語／數學／社會（科目判法共用 cm-events.mjs 的 hwSubjectOfItem）；預習國、聯絡簿、回條、考試預告（考…／【…】）不算。
 *   - 某份作業別人有紀錄、這位學生完全沒有（已交未批改、請假未補、當天沒結算）＝判不出 → 不算進平均、列「需人工」（fail-closed，不預設完成）。
 *   - 甲上／甲上上／甲下是老師一句話記的亮點／扣點，不是清點紀錄，不改作業分。
 *
 * 捨入一律 roundHalfUp（Math.floor(x+0.5)），禁銀行家捨入。純函式、不讀檔、不連 Notion。
 */
import { participation, classroomRecords, weekDays } from "./report-grades.mjs";
import { hwSubjectOfItem } from "./cm-events.mjs";
import { roundHalfUp, MAIN } from "./term-quiz.mjs";

export { MAIN, roundHalfUp };

// ── 日常 ──
export const GRADE_SCORE = { 特優: 100, 優: 95, 甲: 90, 乙: 85, 丙: 75 };
export const BONUS_RATE = 3, BONUS_CAP = 10, DAILY_CAP = 100;

/**
 * 階段範圍內要算的週（weeks.json 該學期的「週」）：上課起落在 [from, to]、且不晚於 asOf。
 * @returns {Array<{週次:number, 上課起:string}>}
 */
export function weeksInRange(term, range, asOf) {
  return (term?.週 || []).filter((w) => w.上課起 && w.上課起 >= range.from && w.上課起 <= range.to && w.上課起 <= asOf);
}

/**
 * 一位學生的日常分。
 * @param {Array} recs 該生全部紀錄（{ date, category, subject, polarity, level, desc }，report-grades 同格式）
 * @param {Array} weeks weeksInRange() 的結果
 * @returns {{ daily: Record<string,number|null>, base: number|null, bonus: Record<string,number>, grades: string[], blankSubject: number }}
 */
export function dailyScore(recs, weeks) {
  if (!weeks.length) return { daily: Object.fromEntries(MAIN.map((s) => [s, null])), base: null, bonus: {}, grades: [], blankSubject: 0 };
  const grades = [], top = Object.fromEntries(MAIN.map((s) => [s, 0]));
  let blankSubject = 0;
  for (const w of weeks) {
    const days = weekDays(w.上課起);
    const inWeek = recs.filter((r) => days.includes(r.date));
    grades.push(participation(inWeek, days).grade);
    const pos = classroomRecords(inWeek).filter((r) => r.pn === "＋");
    blankSubject += pos.filter((r) => !r.subject).length;
    for (const s of MAIN) {
      const lv = pos.filter((r) => r.subject === s).map((r) => r.level ?? 1);
      top[s] += lv.length ? Math.max(...lv) : 0;
    }
  }
  const base = grades.reduce((a, g) => a + GRADE_SCORE[g], 0) / grades.length;
  const bonus = Object.fromEntries(MAIN.map((s) => [s, Math.min(BONUS_CAP, (top[s] / weeks.length) * BONUS_RATE)]));
  const daily = Object.fromEntries(MAIN.map((s) => [s, Math.min(DAILY_CAP, roundHalfUp(base + bonus[s]))]));
  return { daily, base, bonus, grades, blankSubject };
}

// ── 作業 ──
export const HW_STATUS = { 作業完成: 3, 作業補交完成: 3, 作業批改完成: 3, 作業批改要訂正: 2, 作業沒有訂正: 2, 作業沒交: 0 };
export const HW_SCORE = { 3: 100, 2: 80, 0: 0 };
const EXCLUDE = /^(預習國|聯絡簿|考|【)|回條/;

/** 加一年／減一年判斷：MM-DD 派出日 → 西元日期（派出日不會晚於紀錄日）。 */
function dueDate(mmdd, recDate) {
  const y = Number(recDate.slice(0, 4));
  const d = `${y}-${mmdd}`;
  return d > recDate ? `${y - 1}-${mmdd}` : d;
}

/**
 * 清點紀錄的備註 → 各份作業 [{ key, name, due }]。
 * 備註＝「作業名（MM-DD 派）」，同一人同一天多份以「、」串接（作業名本身可能含「、」，所以靠「派）」切）；
 * 2026-09-08 前沒有派出日 → 整串以「、」切，派出日當作紀錄日。
 */
export function splitItems(note, recDate) {
  const s = String(note ?? "").trim();
  if (!s) return [];
  const re = /(.+?)（(\d{2}-\d{2}) 派）(?:、|$)/g;
  const out = [];
  let m, last = 0;
  while ((m = re.exec(s))) { out.push({ key: `${m[1]}（${m[2]} 派）`, name: m[1], due: dueDate(m[2], recDate) }); last = re.lastIndex; }
  if (out.length && last >= s.length) return out;
  if (!out.length) return s.split("、").map((x) => x.trim()).filter(Boolean).map((name) => ({ key: `${name}@${recDate}`, name, due: recDate }));
  return [...out, { key: `${s.slice(last)}@${recDate}`, name: s.slice(last), due: recDate }];
}

/** 一份作業 → 要算的科目（國數社）；不算的回 ""；判不出回 null。 */
export function hwSubjectForScore(name) {
  const n = String(name ?? "").trim();
  if (EXCLUDE.test(n)) return "";
  const s = hwSubjectOfItem(n);
  if (s === null) return null;
  return MAIN.includes(s) ? s : "";
}

/**
 * 全班作業清點紀錄 → 每生每科作業分。
 * @param {Array} rows [{ seats:number[], date, desc, note }]（類別＝作業、事件id 開頭 homework-，已依學年撈）
 * @param {{from:string,to:string}} range 派出日範圍（含頭含尾）
 * @param {number[]} seats 在學座號
 * @returns {{ bySeat: Map<number,{hw,n,done,fix,miss,unknown}>, manual: Array<{seat?,why}>, items: number }}
 */
export function homeworkScores(rows, range, seats) {
  const last = new Map();       // `${seat}|${key}` → { date, st }
  const items = new Map();      // key → subject
  const manual = [];
  for (const r of rows) {
    const st = HW_STATUS[r.desc];
    if (st === undefined) { manual.push({ why: `清點紀錄看不懂（${r.desc}，${r.date}）` }); continue; }
    for (const it of splitItems(r.note, r.date)) {
      if (it.due < range.from || it.due > range.to) continue;
      const subj = hwSubjectForScore(it.name);
      if (subj === null) { if (!items.has(it.key)) manual.push({ why: `作業科目判不出：${it.key}` }); items.set(it.key, null); continue; }
      if (!subj) continue;
      items.set(it.key, subj);
      for (const seat of r.seats) {
        const k = `${seat}|${it.key}`, prev = last.get(k);
        if (!prev || r.date > prev.date || (r.date === prev.date && st > prev.st)) last.set(k, { date: r.date, st });
      }
    }
  }
  const bySeat = new Map();
  for (const seat of seats) {
    const per = Object.fromEntries(MAIN.map((s) => [s, { sum: 0, n: 0, done: 0, fix: 0, miss: 0, unknown: [] }]));
    for (const [key, subj] of items) {
      if (!subj) continue;
      const x = last.get(`${seat}|${key}`), p = per[subj];
      if (!x) { p.unknown.push(key); continue; }
      p.sum += HW_SCORE[x.st]; p.n++;
      if (x.st === 3) p.done++; else if (x.st === 2) p.fix++; else p.miss++;
    }
    bySeat.set(seat, Object.fromEntries(MAIN.map((s) => {
      const p = per[s];
      return [s, { hw: p.n ? roundHalfUp(p.sum / p.n) : null, n: p.n, done: p.done, fix: p.fix, miss: p.miss, unknown: p.unknown }];
    })));
  }
  return { bySeat, manual, items: [...items.values()].filter(Boolean).length };
}
