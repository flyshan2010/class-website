/**
 * f48（試算平考）與 f49（寫入平考）共用的讀取端：撈 Notion → 套 lib/term-quiz.mjs → 每位在學學生一份彙整。
 * 兩支用同一份計算，f49 再用「指紋」確認老師看過的試算與要寫入的是同一批數字（中間有人改紀錄就擋下）。
 * ⚠️ PUBLIC repo：本模組不印任何東西；呼叫端只准印筆數與指紋，不印分數、姓名、座號對分數。
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryAll, DS, propText } from "./notion.mjs";
import { quizRange, toQuiz, inRange, summarize, othersNote, MAIN } from "./term-quiz.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** workflow 的 payload：「115上期中」或「115上期中 <指紋>」。 */
export function parsePayload(s) {
  const m = String(s ?? "").trim().match(/^(\d{3}[上下])\s*(期中|期末)(?:\s+([0-9a-f]{8}))?$/);
  return m ? { term: m[1], stage: m[2], fp: m[3] ?? null } : null;
}

/** 每生要寫進學期成績庫的值（只含國數社平均與備註句）→ 指紋。 */
export function fingerprint(rows) {
  const flat = rows.map((r) => [r.seat, ...MAIN.map((s) => r.avg[s]), r.note]);
  return createHash("sha256").update(JSON.stringify(flat)).digest("hex").slice(0, 8);
}

export async function loadTermQuiz(term, stage) {
  const calendar = JSON.parse(await readFile(path.join(ROOT, "data/calendar.json"), "utf8"));
  const weeks = JSON.parse(await readFile(path.join(ROOT, "data/weeks.json"), "utf8"));
  const range = quizRange(calendar, weeks, term, stage);
  if (range.error) return { error: range.error };
  const year = term.slice(0, 3);

  const roster = (await queryAll(DS.roster)).filter((p) => p.properties?.在學?.checkbox && p.properties?.座號?.number != null);
  const seatOf = new Map(roster.map((p) => [p.id, p.properties.座號.number]));
  const logs = await queryAll(DS.log, { filter: { and: [
    { property: "類別", select: { equals: "評量" } },
    { property: "學年", select: { equals: year } },
  ] } });

  const bySeat = new Map(roster.map((p) => [p.properties.座號.number, []]));
  let orphan = 0;
  for (const p of logs) {
    const qz = toQuiz({
      date: p.properties?.日期?.date?.start ?? "",
      category: propText(p, "類別"),
      subject: propText(p, "科目"),
      score: p.properties?.分數?.number ?? null,
      name: propText(p, "評量名稱"),
      desc: propText(p, "事件描述"),
    });
    if (!qz || !inRange(qz, range)) continue;
    const seats = (p.properties?.學生?.relation ?? []).map((r) => seatOf.get(r.id)).filter((s) => s != null);
    if (!seats.length) { orphan++; continue; }
    for (const s of seats) bySeat.get(s).push(qz);
  }

  const rows = [...bySeat.entries()].sort((a, b) => a[0] - b[0]).map(([seat, qs]) => {
    const sum = summarize(qs);
    return {
      seat,
      studentId: roster.find((p) => p.properties.座號.number === seat).id,
      avg: Object.fromEntries(MAIN.map((s) => [s, sum.subjects[s].avg])),
      n: Object.fromEntries(MAIN.map((s) => [s, sum.subjects[s].n])),
      absent: Object.fromEntries(MAIN.map((s) => [s, sum.subjects[s].absent])),
      note: othersNote(sum.others),
      manual: sum.manual,
    };
  });
  return { range, year, rows, orphan, records: logs.length, fp: fingerprint(rows) };
}
