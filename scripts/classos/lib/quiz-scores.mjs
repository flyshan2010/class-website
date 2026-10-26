/**
 * R20｜錯題表成績上傳（班網 quiz.html「⬆️ 上傳到紀錄庫」→ 收件匣 → f52 寫紀錄庫平時考）
 * ───────────────────────────────────────────────────────────────
 * 2026-10-26 老師裁定：錯題表輸入後一鍵上傳，取代「複製成績→貼給 AI 記錄」。
 *   - 已有該生該卷的紀錄列：只補「錯題」欄；分數和錯題表算的不同 → 保留舊分數、列給老師看（待審），不覆蓋。
 *   - 沒有：照 class-log 平時考格式新建一列（類別評量、中性、分數、評量名稱、日期＝考試日、學年、週次、錯題）。
 *   - 同一份卷可重複上傳：只更新有變的錯題碼，不產生重複列。
 *   - 老師看過衝突、確認以錯題表為準（2026-10-26 裁定：改考卷時配分看錯）→ 首行帶 override 重傳，
 *     或 phase-f 跑 f52 payload「override <批次>」：分數不同的改成錯題表分數（連事件描述）。
 * 收件匣任務原文（quiz.html 產生，超過單格 2000 字就分段）：
 *   第一行  #QUIZ-SCORES v1 <卷id> <批次> <第k段>/<共n段>[ override] · 白話摘要
 *   其餘行  與「複製成績」同一行格式：座號5 社會 L1平時卷 80分 錯:一11,三2(-1)／座號7 社會 L1平時卷 缺考
 * 純函式、不讀檔、不連 Notion。
 */
import { parseErrorCode } from "./quiz-errors.mjs";

export const FINGERPRINT = "#QUIZ-SCORES";
export const isR20 = (text) => String(text ?? "").split("\n")[0].trim().startsWith(FINGERPRINT);
/** 分段沒到齊超過這麼久＝送出中斷，整批標失敗（請老師重按上傳）。 */
export const STALE_MS = 30 * 60 * 1000;

const HEAD_RE = /^#QUIZ-SCORES\s+v1\s+(\S+)\s+(\S+)\s+(\d+)\/(\d+)(\s+override(?!\S))?/;
const LINE_RE = /^座號\s*(\d+)\s+\S+\s+\S+\s+(?:(\d+(?:\.\d+)?)\s*分\s+(錯[:：].*)|缺考)\s*$/;

/** 解析一段任務原文 → { examId, batch, part, total, override, rows:[{seat, score|null, absent, errors}], bad:[行] } 或 { error } */
export function parsePart(text) {
  const lines = String(text ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const h = (lines[0] ?? "").match(HEAD_RE);
  if (!h) return { error: "第一行不是 #QUIZ-SCORES v1 格式" };
  const [, examId, batch, part, total, ov] = h;
  const rows = [], bad = [];
  for (const l of lines.slice(1)) {
    const m = l.match(LINE_RE);
    if (!m) { bad.push(l.slice(0, 40)); continue; }
    const absent = m[2] == null;
    rows.push({ seat: Number(m[1]), score: absent ? null : Number(m[2]), absent, errors: absent ? "" : m[3].replace(/^錯[:：]\s*/, "").trim() });
  }
  return { examId, batch, part: Number(part), total: Number(total), override: !!ov, rows, bad };
}

/**
 * 待處理任務分批：同一批次的各段到齊才處理。
 * @param tasks [{ id, text, created }]
 * @returns [{ batch, examId, tasks:[id], rows, bad, override, state: "ready"|"wait"|"broken", why }]（依建立時間）
 */
export function groupBatches(tasks, now = Date.now()) {
  const map = new Map();
  for (const t of [...tasks].sort((a, b) => String(a.created).localeCompare(String(b.created)))) {
    const p = parsePart(t.text);
    const key = p.error ? `?${t.id}` : p.batch;
    if (!map.has(key)) map.set(key, { batch: p.batch ?? "", examId: p.examId ?? "", total: p.total ?? 0, parts: new Map(), tasks: [], first: t.created, why: p.error ?? "", override: false });
    const g = map.get(key);
    g.tasks.push(t.id);
    if (p.override) g.override = true;
    if (!p.error) g.parts.set(p.part, p);
  }
  return [...map.values()].map((g) => {
    const out = { batch: g.batch, examId: g.examId, tasks: g.tasks, rows: [], bad: [], override: g.override, state: "ready", why: g.why };
    if (g.why) return { ...out, state: "broken" };
    if (g.parts.size < g.total) {
      const stale = now - new Date(g.first).getTime() > STALE_MS;
      return { ...out, state: stale ? "broken" : "wait", why: stale ? `分段沒到齊（${g.parts.size}/${g.total}），請在錯題表重按上傳` : "" };
    }
    for (const k of [...g.parts.keys()].sort((a, b) => a - b)) { out.rows.push(...g.parts.get(k).rows); out.bad.push(...g.parts.get(k).bad); }
    return out;
  });
}

const description = (meta, r) => `${meta.subject}平時考：${meta.name} ${r.absent ? "缺考" : `${r.score}分`}`;

/**
 * 一批成績 → 要建／要補的列。
 * @param meta    { subject, name, date, year, week }（📝平時卷該卷＋週次）
 * @param rows    parsePart 的 rows
 * @param roster  Map 座號 → 學生頁 id（在學）
 * @param existing [{ id, student, score|null, errors }]（紀錄庫同學年・科目・評量名稱的評量列）
 * @param opt      { override }：true＝老師確認以錯題表分數為準，分數不同的改分（patch 帶 score／desc）
 * @returns { creates:[{seat, props}], patches:[{seat, id, errors, score?, desc?}], conflicts:[文字], overridden:[文字], problems:[文字], same }
 */
export function planBatch(meta, rows, roster, existing, opt = {}) {
  const creates = [], patches = [], conflicts = [], overridden = [], problems = [];
  let same = 0;
  const seen = new Set();
  for (const r of [...rows].sort((a, b) => a.seat - b.seat)) {
    if (seen.has(r.seat)) { problems.push(`座號${r.seat} 這次上傳出現兩次，沒寫`); continue; }
    seen.add(r.seat);
    const student = roster.get(r.seat);
    if (!student) { problems.push(`座號${r.seat} 名冊查無在學學生，沒寫`); continue; }
    if (!r.absent) {
      const pe = parseErrorCode(r.errors);
      if (pe.error) { problems.push(`座號${r.seat} 錯題碼${pe.error}，沒寫`); continue; }
    }
    const mine = existing.filter((e) => String(e.student).replace(/-/g, "") === String(student).replace(/-/g, ""));
    if (mine.length > 1) { problems.push(`座號${r.seat} 紀錄庫已有 ${mine.length} 列「${meta.name}」，請先刪重複列，沒寫`); continue; }
    if (!mine.length) {
      creates.push({ seat: r.seat, props: {
        事件描述: description(meta, r), 學生: student, 類別: "評量", 科目: meta.subject, 正負向: "中性",
        分數: r.absent ? null : r.score, 評量名稱: meta.name, 日期: meta.date, 學年: meta.year, 週次: meta.week, 錯題: r.errors,
      } });
      continue;
    }
    const e = mine[0];
    const oldScore = e.score == null ? null : Number(e.score);
    const diff = r.absent ? oldScore != null : oldScore !== r.score;
    const txt = `座號${r.seat} 紀錄庫${oldScore == null ? "缺考" : `${oldScore}分`}／錯題表${r.absent ? "缺考" : `${r.score}分`}`;
    if (diff && opt.override) {
      overridden.push(txt);
      patches.push({ seat: r.seat, id: e.id, errors: r.errors, score: r.absent ? null : r.score, desc: description(meta, r) });
      continue;
    }
    if (diff) conflicts.push(txt);
    if (String(e.errors ?? "").trim() === r.errors) same++;
    else patches.push({ seat: r.seat, id: e.id, errors: r.errors });
  }
  return { creates, patches, conflicts, overridden, problems, same };
}

/** 收件匣「執行紀錄」：只寫數字（細節在錯誤訊息，給老師看）。 */
export function execLog(meta, plan) {
  return `${meta.subject}「${meta.name}」新建 ${plan.creates.length} 列、補錯題 ${plan.patches.length} 列、沒變 ${plan.same} 列` +
    (plan.conflicts.length ? `；分數不同 ${plan.conflicts.length} 人（保留紀錄庫分數）` : "") +
    (plan.overridden?.length ? `；改成錯題表分數 ${plan.overridden.length} 人（老師確認）` : "") +
    (plan.problems.length ? `；沒寫 ${plan.problems.length} 人` : "");
}

/** 給老師看的待審說明（錯題表畫面與收件匣「錯誤訊息」共用）；沒有要看的＝空字串。 */
export function reviewText(plan, bad = []) {
  const parts = [];
  if (plan.conflicts.length) parts.push(`分數不同（保留紀錄庫分數，錯題碼已補）：${plan.conflicts.join("；")}`);
  if (plan.problems.length) parts.push(`沒寫：${plan.problems.join("；")}`);
  if (bad.length) parts.push(`看不懂的行：${bad.join("；")}`);
  return parts.join("\n");
}
