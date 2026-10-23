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
 *   收尾日 closingDay ＝ 該週最後一個「週一～週五」的上課日（校外活動日也算——老師 2026-10-06：10/8 戶外教學即本週最後一天）。
 *                      週六上課日不當收尾日（老師 2026-10-23：固定週五收，例 2027-03-20 週六運動會）。
 *
 * 收尾閘門 closingVerdict（2026-10-23 老師裁定「停課不再例外處理」）：
 *   今天＝收尾日 → YES；今天已過本週收尾日、仍是同一週的週一～週五 → YES｜補跑
 *   （颱風假當天才停課，收尾日被往前改成已經過去的日子）。「本週是否已收尾」閘門不知道（在 Notion），
 *   由下游防重跑：學習報告已存在即停、f24 冪等。closing-day.mjs 與 data/closing-day.json 預算表都只呼叫這一支。
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

const isWeekday = s => { const d = parse(s).getUTCDay(); return d >= 1 && d <= 5; };

export const isSchoolDay =day => !!day && (!day.holiday || ATTEND_RE.test(day.note ?? ""));
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
  const closing = school.filter(isWeekday).at(-1) ?? null;
  return {
    from, to,
    known: rows.length > 0,
    schoolDays: school,
    workDays: workDays(plan, from, to),
    tripDays: rows.filter(isTripDay).map(x => x.date).sort(),
    closingDay: closing,
    isClosingDay: closing !== null && closing === date,
  };
}

/**
 * 收尾閘門判定。weeks＝data/weeks.json。
 * 回傳 { verdict: "YES"|"CATCHUP"|"NO"|"UNKNOWN", line }；line 開頭固定 `CLOSING-DAY: YES|NO|UNKNOWN`，
 * 補跑也是 `CLOSING-DAY: YES｜補跑｜…`（三支原文只比對開頭，不必改）。
 */
export function closingVerdict(plan, weeks, date) {
  const term = (weeks?.學期 ?? []).flatMap(t => t.週 ?? []).find(x => date >= x.起 && date <= x.迄);
  if (!term) {
    // 學期區間外：假期，或老師的「預排日」（歸下學期第1週的緩衝日，不收尾）
    return { verdict: "NO", line: `CLOSING-DAY: NO｜${date} 不在任何上課週內（假期或預排日）` };
  }
  const w = weekInfo(plan, date, { from: term.起, to: term.迄 });
  if (!w.known) {
    return { verdict: "UNKNOWN", line: `CLOSING-DAY: UNKNOWN｜${date} 在 ${term.標籤} 內，但每日課程進度沒有本週資料，需人工` };
  }
  if (!w.closingDay) return { verdict: "NO", line: `CLOSING-DAY: NO｜${date} 這一週沒有上課日` };
  const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  const tail = `本週上課日 ${w.schoolDays.map(md).join("、")}（工作日 ${w.workDays.length} 天）｜${term.標籤}`;
  if (w.isClosingDay) return { verdict: "YES", line: `CLOSING-DAY: YES｜${date} 是本週最後一個上課日｜${tail}` };
  if (date > w.closingDay && isWeekday(date)) {
    return {
      verdict: "CATCHUP",
      line: `CLOSING-DAY: YES｜補跑｜${date} 已過本週收尾日 ${w.closingDay}，先查本週是否已收尾、已收尾即停｜${tail}`,
    };
  }
  return { verdict: "NO", line: `CLOSING-DAY: NO｜${date} 不是收尾日（本週收尾日 ${w.closingDay}）｜${tail}` };
}
