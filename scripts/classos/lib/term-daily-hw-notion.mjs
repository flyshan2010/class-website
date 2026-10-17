/**
 * f50（試算日常／作業）與 f51（寫入日常／作業）共用的讀取端：撈 Notion → 套 lib/term-daily-hw.mjs → 每位在學學生一份。
 * 範圍日期同平考（lib/term-quiz.mjs 的 quizRange，讀 data/calendar.json）；f51 用「指紋」確認老師看過的試算與要寫入的是同一批數字。
 * ⚠️ PUBLIC repo：本模組不印任何東西；呼叫端只准印筆數與指紋，不印分數、姓名、座號對分數。
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryAll, DS, propText } from "./notion.mjs";
import { quizRange } from "./term-quiz.mjs";
import { weeksInRange, dailyScore, homeworkScores, MAIN } from "./term-daily-hw.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export { parsePayload } from "./term-quiz-notion.mjs";

/** 每生要寫進學期成績庫的值（國數社日常、作業）→ 指紋。 */
export function fingerprint(rows) {
  const flat = rows.map((r) => [r.seat, ...MAIN.map((s) => r.daily[s]), ...MAIN.map((s) => r.hw[s].hw)]);
  return createHash("sha256").update(JSON.stringify(flat)).digest("hex").slice(0, 8);
}

/** asOf：只算「上課起」不晚於這天的週（預設今天，臺北時間）。 */
export async function loadTermDailyHw(term, stage, asOf = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" })) {
  const calendar = JSON.parse(await readFile(path.join(ROOT, "data/calendar.json"), "utf8"));
  const weeks = JSON.parse(await readFile(path.join(ROOT, "data/weeks.json"), "utf8"));
  const range = quizRange(calendar, weeks, term, stage);
  if (range.error) return { error: range.error };
  const year = term.slice(0, 3);
  const t = weeks.學期.find((x) => String(x.學年) === year && x.學期 === term.slice(3));
  const wk = weeksInRange(t, range, asOf);

  const roster = (await queryAll(DS.roster)).filter((p) => p.properties?.在學?.checkbox && p.properties?.座號?.number != null);
  const seatOf = new Map(roster.map((p) => [p.id, p.properties.座號.number]));
  const seats = roster.map((p) => p.properties.座號.number).sort((a, b) => a - b);
  const logs = await queryAll(DS.log, { filter: { property: "學年", select: { equals: year } } });

  const recsBy = new Map(seats.map((s) => [s, []]));
  const hwRows = [];
  let orphan = 0;
  for (const p of logs) {
    const sts = (p.properties?.學生?.relation ?? []).map((r) => seatOf.get(r.id)).filter((s) => s != null);
    if (!sts.length) { orphan++; continue; }
    const rec = {
      date: (p.properties?.日期?.date?.start ?? "").slice(0, 10),
      category: propText(p, "類別"),
      subject: propText(p, "科目") || null,
      polarity: propText(p, "正負向"),
      level: p.properties?.程度?.number ?? null,
      desc: propText(p, "事件描述"),
    };
    for (const s of sts) recsBy.get(s).push(rec);
    if (rec.category === "作業" && propText(p, "事件id").startsWith("homework-"))
      hwRows.push({ seats: sts, date: rec.date, desc: rec.desc, note: propText(p, "備註") });
  }

  const hw = homeworkScores(hwRows, range, seats);
  const rows = seats.map((seat) => {
    const d = dailyScore(recsBy.get(seat), wk);
    return {
      seat,
      studentId: roster.find((p) => p.properties.座號.number === seat).id,
      daily: d.daily, base: d.base, bonus: d.bonus, grades: d.grades, blankSubject: d.blankSubject,
      hw: hw.bySeat.get(seat),
    };
  });
  return { range, year, asOf, weeks: wk, rows, orphan, records: logs.length, hwRecords: hwRows.length,
    hwItems: hw.items, manual: hw.manual, fp: fingerprint(rows) };
}
