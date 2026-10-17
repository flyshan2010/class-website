/**
 * f48｜試算平考（只算，不寫學期成績庫）
 * ───────────────────────────────────────────────────────────────
 * 老師 2026-10-17 定案：國數社各科平時考平均＝學期成績庫「○○平考」，其他科寫「備註」；
 * 先試算停待審，老師確認才由 f49 寫入（通用鐵則 5）。規則正本 lib/term-quiz.mjs。
 *
 * 用法：GitHub Actions「ClassOS Phase F 工具」→ f48，payload 填「115上期中」或「115上期末」
 *   mode=dry-run：只印筆數與指紋（log 公開，不印分數）
 *   mode=execute：在 📥 收件匣建立／刷新一筆「待審」，執行紀錄＝逐座號試算表（Notion 內才看得到分數）
 * 老師看過待審沒問題 → 在 Claude Code 說「寫入平考」→ class-grades 跑 f49（payload 帶同一個指紋）。
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印筆數、人數與指紋，不印分數與姓名。
 */
import { queryAll, api, updatePage, isExecute, DS } from "./lib/notion.mjs";
import { loadTermQuiz, parsePayload } from "./lib/term-quiz-notion.mjs";
import { MAIN } from "./lib/term-quiz.mjs";

const P = parsePayload(process.env.PAYLOAD);
if (!P) { console.log("❌ payload 要填「115上期中」或「115上期末」"); process.exit(1); }
const { term, stage } = P;

const r = await loadTermQuiz(term, stage);
if (r.error) { console.log(`❌ ${r.error}`); process.exit(1); }
const { range, rows, fp } = r;
const manualN = rows.reduce((a, x) => a + x.manual.length, 0);
const cell = (x, s) => x.avg[s] == null ? "—" : `${x.avg[s]}（${x.n[s]}次${x.absent[s] ? `・缺考${x.absent[s]}` : ""}）`;

console.log(`📐 ${term}${stage} 平時考範圍 ${range.from}～${range.to}`);
console.log(`📝 紀錄庫評量類 ${r.records} 筆（${r.year} 學年）；沒掛學生 ${r.orphan} 筆；判不出（需人工）${manualN} 筆`);
console.log(`👥 在學 ${rows.length} 人；各科有平均的人數：${MAIN.map((s) => `${s} ${rows.filter((x) => x.avg[s] != null).length}`).join("／")}`);
console.log(`🔑 指紋 ${fp}（f49 寫入時 payload 要帶同一個）`);

const lines = [
  `${term}${stage} 平考試算（範圍 ${range.from}～${range.to}，平均四捨五入取整數，缺考不計入）`,
  `座號｜國語｜數學｜社會｜其他科（寫備註）`,
  ...rows.map((x) => `${x.seat}｜${MAIN.map((s) => cell(x, s)).join("｜")}｜${x.note || "—"}`),
  ...(manualN ? ["", "⚠️ 判不出、沒算進平均（請先到紀錄庫補分數或寫「缺考」再重跑 f48）："]
    .concat(rows.flatMap((x) => x.manual.map((m) => `座號${x.seat} ${m.date} ${m.subject || "（科目空白）"}：${m.why}`))) : []),
  ...(r.orphan ? [`⚠️ 有 ${r.orphan} 筆評量紀錄沒掛學生（或學生已不在學），沒算進任何人`] : []),
  "",
  `沒有平時考的科目（—）寫入時保持空白，不填 0。`,
  `確認無誤 → 在 Claude Code 說「寫入平考」（指紋 ${fp}）；有問題先改紀錄庫再重跑 f48。`,
];

if (!isExecute()) { console.log("\n🔍 dry-run：未建立待審（要建請用 mode=execute）"); process.exit(0); }

// 執行紀錄是 rich_text：每段上限 2000 字，切段放
const chunks = (s) => (s.match(/[\s\S]{1,1900}/g) || [""]).map((c) => ({ type: "text", text: { content: c } }));
const title = `${term}${stage} 平考試算`;
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
const prev = (await queryAll(DS.inbox)).find((p) =>
  (p.properties?.["任務原文"]?.title ?? []).map((t) => t.plain_text).join("").startsWith(title)
  && (p.properties?.["狀態"]?.select?.name ?? "") === "待審");
const props = {
  "任務原文": { title: chunks(`${title}（${today}・指紋 ${fp}）`) },
  "執行紀錄": { rich_text: chunks(lines.join("\n")) },
};
const res = prev
  ? await updatePage(prev.id, props)
  : await api("POST", "/pages", { parent: { type: "data_source_id", data_source_id: DS.inbox }, properties: {
    ...props, "狀態": { select: { name: "待審" } }, "路由ID": { rich_text: chunks("R05") }, "學年": { select: { name: r.year } },
  } });
if (!res.ok) { console.error(`❌ 收件匣寫入失敗：${res.status} ${res.json?.message ?? ""}`); process.exit(1); }
console.log(`\n✅ 已${prev ? "刷新" : "建立"}收件匣待審「${title}」（指紋 ${fp}）`);
