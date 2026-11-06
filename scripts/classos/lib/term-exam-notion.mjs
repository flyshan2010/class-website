/**
 * f53（試算期考）、f54（寫入期考）、f55（試後分析）共用的讀取端：撈 Notion → 套 lib/term-exam.mjs。
 * ⚠️ PUBLIC repo：本模組不印任何東西；呼叫端只准印筆數與指紋，不印分數、座號對分數。
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryAll, api, updatePage, DS, propText } from "./notion.mjs";
import { termExamScores, examName } from "./term-exam.mjs";
import { MAIN } from "./term-quiz.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DS_QUIZ = "51c1c08f-78b4-4352-85f6-e45fb7361c2a"; // 📝 平時卷（與 sync-notion.mjs quizExams 同一個）

/** 每生要寫進學期成績庫的期考（國數社）→ 指紋；缺考與沒紀錄都記成 null。 */
export function fingerprint(rows) {
  const flat = rows.map((r) => [r.seat, ...MAIN.map((s) => r.subjects[s]?.absent ? null : r.subjects[s]?.score ?? null)]);
  return createHash("sha256").update(JSON.stringify(flat)).digest("hex").slice(0, 8);
}

export async function loadTermExam(term, stage) {
  const m = String(term).match(/^(\d{3})([上下])$/);
  const weeks = JSON.parse(await readFile(path.join(ROOT, "data/weeks.json"), "utf8"));
  const t = m && (weeks.學期 || []).find((x) => String(x.學年) === m[1] && x.學期 === m[2]);
  if (!t) return { error: `weeks.json 查無 ${term}` };
  const year = m[1];

  const roster = (await queryAll(DS.roster)).filter((p) => p.properties?.在學?.checkbox && p.properties?.座號?.number != null);
  const seatOf = new Map(roster.map((p) => [p.id, p.properties.座號.number]));
  const logs = await queryAll(DS.log, { filter: { and: [
    { property: "類別", select: { equals: "評量" } },
    { property: "學年", select: { equals: year } },
    { property: "評量名稱", rich_text: { contains: examName(stage) } },
  ] } });
  const recs = logs.map((p) => ({
    seats: (p.properties?.學生?.relation ?? []).map((r) => seatOf.get(r.id)).filter((s) => s != null),
    date: p.properties?.日期?.date?.start ?? "",
    category: propText(p, "類別"), subject: propText(p, "科目"),
    score: p.properties?.分數?.number ?? null, name: propText(p, "評量名稱"),
    desc: propText(p, "事件描述"), errors: propText(p, "錯題"),
  }));
  const res = termExamScores(recs, roster.map((p) => p.properties.座號.number), { stage, from: t.開學日, to: t.休業日 });
  const studentId = new Map(roster.map((p) => [p.properties.座號.number, p.id]));
  return { year, records: logs.length, ...res, studentId, fp: fingerprint(res.rows) };
}

/** 📝平時卷庫找該學期該科的期中考／期末考卷（卷id 開頭＝學期、名稱＝期中考），讀內文 json 程式碼框。 */
export async function loadExam(term, subject, stage) {
  const txt = (p, k) => propText(p, k) ?? "";
  const pages = (await queryAll(DS_QUIZ)).filter((p) => txt(p, "卷id").startsWith(term)
    && txt(p, "科目") === subject && txt(p, "名稱").replace(/\s+/g, "") === examName(stage));
  if (pages.length !== 1) return { error: `📝平時卷找到 ${pages.length} 份「${term} ${subject} ${examName(stage)}」（要剛好 1 份）` };
  const page = pages[0];
  const res = await api("GET", `/blocks/${page.id}/children?page_size=100`);
  if (!res.ok) return { error: `讀不到卷內文：${res.status}` };
  const code = (res.json.results || []).find((b) => b.type === "code");
  if (!code) return { error: "卷頁面內文沒有 json 程式碼框（請先用錯題表建卷）" };
  try {
    const exam = JSON.parse(code.code.rich_text.map((x) => x.plain_text).join(""));
    if (exam.format !== "quiz-exam/1") return { error: "卷 json 的 format 不是 quiz-exam/1" };
    return { exam, id: txt(page, "卷id"), paper: page.properties?.試卷連結?.url || txt(page, "試卷連結"),
      date: page.properties?.考試日?.date?.start ?? "" };
  } catch (e) { return { error: `卷 json 壞掉：${e.message}` }; }
}

/** 📥 收件匣建立／刷新一筆「待審」（同標題開頭且仍待審就刷新）；執行紀錄切段放（rich_text 每段 ≤ 2000 字）。 */
export async function upsertInbox(title, fp, lines, year) {
  const chunks = (s) => (s.match(/[\s\S]{1,1900}/g) || [""]).slice(0, 90).map((c) => ({ type: "text", text: { content: c } }));
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const prev = (await queryAll(DS.inbox)).find((p) => (propText(p, "任務原文") ?? "").startsWith(title)
    && propText(p, "狀態") === "待審");
  const props = {
    "任務原文": { title: chunks(`${title}（${today}${fp ? `・指紋 ${fp}` : ""}）`) },
    "執行紀錄": { rich_text: chunks(lines.join("\n")) },
  };
  const res = prev
    ? await updatePage(prev.id, props)
    : await api("POST", "/pages", { parent: { type: "data_source_id", data_source_id: DS.inbox }, properties: {
      ...props, "狀態": { select: { name: "待審" } }, "路由ID": { rich_text: chunks("R05") }, "學年": { select: { name: year } },
    } });
  return { ok: res.ok, refreshed: !!prev, status: res.status, message: res.json?.message };
}
