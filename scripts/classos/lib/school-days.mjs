/**
 * ClassOS｜上課日／工作日／收尾日判定（唯一出處：data/daily-plan.json）
 *
 * 2026-10-06 老師裁定兩件事，都靠這支：
 *   ① 週結的打掃、午餐、常規改「依該週實際工作天數」計（原本寫死 5 天，放假週與校外活動日照發）。
 *   ② 每週收尾（學習報告／週報／週結試算／總檢查）改在「該週最後一個上課日」跑，不再寫死週五。
 *
 * 三種「日」的定義（不要各腳本自己判）：
 *   上課日 schoolDays ＝ 學生有到校的日子：`holiday:false`，**加上定期評量日與休業式**
 *                      （daily-plan 把這兩種標 holiday:true 是因為沒有課程進度，學生仍到校）。
 *   工作日 workDays   ＝ 上課日扣掉校外活動日與休業式（當天沒有打掃、午餐工作、常規檢核）。
 *                      定期評量日照常算工作日。
 *   收尾日 closingDay ＝ 該週最後一個上課日（校外活動日也算——老師 2026-10-06：10/8 戶外教學即本週最後一天）。
 *
 * 「週」一律是週一～週日（與 weeks.json 的 起／迄 同界線）。零相依，純函式，不讀檔。
 */

const ATTEND_RE = /定期評量|休業式/;                    // 標 holiday:true 但學生到校
const NOWORK_RE = /戶外教學|校外教學|校外活動|休業式/;   // 到校但沒有打掃／午餐／常規檢核

const iso = d => d.toISOString().slice(0, 10);
const parse = s => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error(`日期格式不是 yyyy-mm-dd：${s}`);
  return new Date(`${s}T00:00:00Z`);
};

/** 該日所屬週的週一與週日（yyyy-mm-dd）。 */
export function weekRange(date) {
  const d = parse(date);
  const dow = d.getUTCDay() || 7;                 // 週日＝7
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow + 1);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  return { from: iso(mon), to: iso(sun) };
}

export const isSchoolDay = day => !!day && (!day.holiday || ATTEND_RE.test(day.note ?? ""));
export const isTripDay = day => !!day && isSchoolDay(day) && NOWORK_RE.test(day.note ?? "");

const inRange = (plan, from, to) => (plan?.days ?? []).filter(x => x.date >= from && x.date <= to);

/** 區間內的上課日（yyyy-mm-dd 陣列，已排序）。 */
export const schoolDays = (plan, from, to) =>
  inRange(plan, from, to).filter(isSchoolDay).map(x => x.date).sort();

/** 區間內的工作日＝上課日扣掉校外活動日。 */
export const workDays = (plan, from, to) =>
  inRange(plan, from, to).filter(x => isSchoolDay(x) && !isTripDay(x)).map(x => x.date).sort();

/**
 * 某日所屬週的摘要。
 * known＝daily-plan 有沒有這一週的任何一列（沒有＝判不出，呼叫端不可當成「不是收尾日」默默結束）。
 */
export function weekInfo(plan, date, clip = {}) {
  // clip：學期週的 起／迄（weeks.json）。學期最後一週的 迄 會早於週日——之後的上課日是
  // 「預排日」（歸下學期第1週的緩衝日），不可算進本週，否則休業式週的收尾日會被往後推。
  const wr = weekRange(date);
  const from = clip.from && clip.from > wr.from ? clip.from : wr.from;
  const to = clip.to && clip.to < wr.to ? clip.to : wr.to;
  const rows = inRange(plan, from, to);
  const school = schoolDays(plan, from, to);
  return {
    from, to,
    known: rows.length > 0,
    schoolDays: school,
    workDays: workDays(plan, from, to),
    tripDays: rows.filter(isTripDay).map(x => x.date).sort(),
    closingDay: school.at(-1) ?? null,
    isClosingDay: school.at(-1) === date,
  };
}
