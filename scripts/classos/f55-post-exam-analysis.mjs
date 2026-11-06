/**
 * f55｜試後分析（期中考／期末考，只讀；execute 只多建一筆收件匣待審）
 * ───────────────────────────────────────────────────────────────
 * 老師 2026-11-06 定案（DH 線）：錯題表登記的期中考錯題 → 三科「崑山國小定期評量試後檢討分析表」。
 * 規則正本 lib/term-exam.mjs（一列一題、≥30％ 全班補救、20～29％ 小組補救、<20％ 不列）。
 *
 * 產出：
 *   ① out/post-exam/<115上期中>.json —— workflow 上傳成 artifact（保留 1 天），只有全班統計，**不含座號、姓名**；
 *      Claude Code 下載後讀試卷起草「錯誤分析與教學醒思」「補救教學策略」，
 *      再用 scripts/classos/post-exam/fill_form.py 填學校原表輸出 .docx 給老師。
 *   ② mode=execute：📥 收件匣待審「115上期中 試後分析」＝三科摘要＋小組補救名單（座號，只在 Notion）。
 * 任一科判不出（錯題碼對不到、分數不符、有分數沒登記）＝該科不出表，列需人工（fail-closed）。
 *
 * 用法：GitHub Actions「ClassOS Phase F 工具」→ f55，payload 填「115上期中」或「115上期末」。
 * ⚠️ 本 repo 為 PUBLIC，Actions log 與 artifact 公開可讀——只印筆數；座號只寫進 Notion。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { isExecute } from "./lib/notion.mjs";
import { parsePayload } from "./lib/term-quiz-notion.mjs";
import { loadTermExam, loadExam, upsertInbox } from "./lib/term-exam-notion.mjs";
import { postExamAnalysis, examName } from "./lib/term-exam.mjs";
import { MAIN } from "./lib/term-quiz.mjs";

const P = parsePayload(process.env.PAYLOAD);
if (!P) { console.log("❌ payload 要填「115上期中」或「115上期末」"); process.exit(1); }
const { term, stage } = P;
const name = examName(stage);

const r = await loadTermExam(term, stage);
if (r.error) { console.log(`❌ ${r.error}`); process.exit(1); }

const out = { format: "post-exam/1", term, stage, name, generated: new Date().toISOString(), subjects: [] };
const notes = [`${term}${stage} 試後分析（${name}；規則：一列一題，錯誤率 ≥30% 全班補救、20%～29% 小組補救、<20% 不列）`];
let bad = 0;
for (const s of MAIN) {
  const rows = r.rows.filter((x) => x.subjects[s]).map((x) => ({ seat: x.seat, ...x.subjects[s] }));
  if (!rows.length) { console.log(`⏭ ${s}：紀錄庫還沒有${name}分數，略過`); notes.push("", `【${s}】還沒有${name}分數，略過`); continue; }
  const ex = await loadExam(term, s, stage);
  if (ex.error) { bad++; console.log(`❌ ${s}：${ex.error}`); notes.push("", `【${s}】❌ ${ex.error}`); continue; }
  const a = postExamAnalysis(ex.exam, rows);
  if (a.manual) {
    bad++;
    console.log(`❌ ${s}：判不出 ${a.manual.length} 筆（需人工，明細在收件匣）→ 本科不出表`);
    notes.push("", `【${s}】❌ 判不出、本科不出表（請到錯題表更正後重跑 f55）：`, ...a.manual);
    continue;
  }
  const date = (ex.date || "").slice(0, 10); // 📝平時卷「考試日」
  out.subjects.push({ subject: s, examId: ex.id, date, n: a.n, absent: a.absent, avg: a.avg, bins: a.bins, summary: a.summary,
    rows: a.listed.map(({ code, label, kp, wrong, partial, rate, level, note, remedyPrefix }) =>
      ({ code, label, kp, wrong, partial, rate, level, note, remedyPrefix })) });
  console.log(`✅ ${s}：應考 ${a.n} 人、缺考 ${a.absent} 人；列入 ${a.listed.length} 題（全班 ${a.listed.filter((x) => x.level === "全班").length}・小組 ${a.listed.filter((x) => x.level === "小組").length}）`);
  notes.push("", `【${s}】應考 ${a.n} 人、缺考 ${a.absent} 人。${a.summary}`,
    ...a.listed.map((x) => `${x.label}｜${x.kp}｜錯 ${x.wrong} 人（${x.rate}%）｜${x.level}補救`
      + (a.groups[x.code] ? `｜名單：座號 ${a.groups[x.code].join("、")}` : "")));
}
if (r.manual.length) notes.push("", "⚠️ 紀錄庫判不出的列（同 f53）：", ...r.manual);

await mkdir("out/post-exam", { recursive: true });
await writeFile(`out/post-exam/${term}${stage}.json`, JSON.stringify(out, null, 2));
console.log(`\n📦 out/post-exam/${term}${stage}.json：${out.subjects.length} 科（artifact，不含座號）`);

if (isExecute()) {
  notes.push("", "下一步：Claude Code 下載 artifact、讀試卷起草文字欄 → 產三科 .docx 給老師修改後交教學組。");
  const res = await upsertInbox(`${term}${stage} 試後分析`, null, notes, r.year);
  if (!res.ok) { console.error(`❌ 收件匣寫入失敗：${res.status} ${res.message ?? ""}`); process.exit(1); }
  console.log(`✅ 已${res.refreshed ? "刷新" : "建立"}收件匣待審「${term}${stage} 試後分析」（含小組補救名單）`);
} else console.log("🔍 dry-run：未建立收件匣待審");
if (bad) process.exit(1);
