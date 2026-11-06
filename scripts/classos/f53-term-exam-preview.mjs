/**
 * f53｜試算期考（只算，不寫學期成績庫）
 * ───────────────────────────────────────────────────────────────
 * 老師 2026-11-06 定案（DH 線）：期中考／期末考分數不另外輸入，直接用錯題表上傳到紀錄庫的分數
 * （評量名稱＝期中考／期末考）寫進學期成績庫「○○期考」，Notion 公式自動算出期中成績。
 * 先試算停待審，老師確認才由 f54 寫入（通用鐵則 5）。規則正本 lib/term-exam.mjs。
 *
 * 用法：GitHub Actions「ClassOS Phase F 工具」→ f53，payload 填「115上期中」或「115上期末」
 *   mode=dry-run：只印筆數與指紋（log 公開，不印分數）
 *   mode=execute：📥 收件匣建立／刷新一筆「待審」，執行紀錄＝逐座號三科期考（Notion 內才看得到分數）
 * 老師看過沒問題 → 在 Claude Code 說「寫入期中成績」→ class-grades 跑 f54（payload 帶同一個指紋）。
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印筆數、人數與指紋，不印分數與座號。
 */
import { isExecute } from "./lib/notion.mjs";
import { parsePayload } from "./lib/term-quiz-notion.mjs";
import { loadTermExam, upsertInbox } from "./lib/term-exam-notion.mjs";
import { examName } from "./lib/term-exam.mjs";
import { MAIN } from "./lib/term-quiz.mjs";

const P = parsePayload(process.env.PAYLOAD);
if (!P) { console.log("❌ payload 要填「115上期中」或「115上期末」"); process.exit(1); }
const { term, stage } = P;
const name = examName(stage);

const r = await loadTermExam(term, stage);
if (r.error) { console.log(`❌ ${r.error}`); process.exit(1); }
const has = (s) => r.rows.filter((x) => x.subjects[s] && !x.subjects[s].absent).length;
const absent = (s) => r.rows.filter((x) => x.subjects[s]?.absent).length;
const none = (s) => r.rows.filter((x) => !x.subjects[s]).length;

console.log(`📝 紀錄庫「${name}」評量列 ${r.records} 筆（${r.year} 學年）；沒掛在學學生 ${r.orphan} 筆；判不出（需人工）${r.manual.length} 筆`);
console.log(`👥 在學 ${r.rows.length} 人；${MAIN.map((s) => `${s} 有分數 ${has(s)}・缺考 ${absent(s)}・沒紀錄 ${none(s)}`).join("／")}`);
console.log(`🔑 指紋 ${r.fp}（f54 寫入時 payload 要帶同一個）`);

const cell = (c) => (!c ? "—（沒紀錄）" : c.absent ? "缺考（不寫）" : String(c.score));
const lines = [
  `${term}${stage} 期考試算（來源：錯題表上傳到紀錄庫的「${name}」分數；寫入學期成績庫「○○期考」）`,
  `座號｜國語｜數學｜社會`,
  ...r.rows.map((x) => `${x.seat}｜${MAIN.map((s) => cell(x.subjects[s])).join("｜")}`),
  ...(r.manual.length ? ["", "⚠️ 判不出、不會寫入（請到錯題表或紀錄庫更正後重跑 f53）：", ...r.manual] : []),
  ...(r.orphan ? [`⚠️ 有 ${r.orphan} 筆${name}紀錄沒掛在學學生，沒算進任何人`] : []),
  "",
  "缺考與沒紀錄的科目寫入時保持空白（不填 0）；補考後重新登記錯題表、重跑 f53。",
  "平考請一併跑 f48、日常作業跑 f50；三筆待審都看過再說「寫入期中成績」。",
  `確認無誤 → 在 Claude Code 說「寫入期中成績」（期考指紋 ${r.fp}）。`,
];

if (!isExecute()) { console.log("\n🔍 dry-run：未建立待審（要建請用 mode=execute）"); process.exit(0); }
const res = await upsertInbox(`${term}${stage} 期考試算`, r.fp, lines, r.year);
if (!res.ok) { console.error(`❌ 收件匣寫入失敗：${res.status} ${res.message ?? ""}`); process.exit(1); }
console.log(`\n✅ 已${res.refreshed ? "刷新" : "建立"}收件匣待審「${term}${stage} 期考試算」（指紋 ${r.fp}）`);
