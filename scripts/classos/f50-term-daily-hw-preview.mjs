/**
 * f50｜試算日常＋作業（只算，不寫學期成績庫）
 * ───────────────────────────────────────────────────────────────
 * 老師 2026-10-18 定案：○○日常＝每週上課參與等第換分平均＋該科每週最高正向程度平均×3（上限 +10、總分 100）；
 * ○○作業＝逐份作業最後有完成 100／仍要訂正 80／仍未交 0 取平均。規則正本 lib/term-daily-hw.mjs。
 * 先試算停待審，老師確認才由 f51 寫入（通用鐵則 5）。比照平考 f48／f49。
 *
 * 用法：GitHub Actions「ClassOS Phase F 工具」→ f50，payload 填「115上期中」或「115上期末」
 *   mode=dry-run：只印筆數與指紋（log 公開，不印分數）
 *   mode=execute：在 📥 收件匣建立／刷新一筆「待審」，執行紀錄＝逐座號試算表（Notion 內才看得到分數）
 * 老師看過待審沒問題 → 在 Claude Code 說「寫入日常作業」→ class-grades 跑 f51（payload 帶同一個指紋）。
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印筆數、人數與指紋，不印分數與姓名。
 */
import { queryAll, api, updatePage, isExecute, DS } from "./lib/notion.mjs";
import { loadTermDailyHw, parsePayload } from "./lib/term-daily-hw-notion.mjs";
import { MAIN } from "./lib/term-daily-hw.mjs";

const P = parsePayload(process.env.PAYLOAD);
if (!P) { console.log("❌ payload 要填「115上期中」或「115上期末」"); process.exit(1); }
const { term, stage } = P;

const r = await loadTermDailyHw(term, stage);
if (r.error) { console.log(`❌ ${r.error}`); process.exit(1); }
const { range, rows, fp } = r;
const unknownN = rows.reduce((a, x) => a + MAIN.reduce((b, s) => b + x.hw[s].unknown.length, 0), 0);
const blankN = rows.reduce((a, x) => a + x.blankSubject, 0);

console.log(`📐 ${term}${stage} 範圍 ${range.from}～${range.to}；算到 ${r.asOf}，共 ${r.weeks.length} 週（第 ${r.weeks.map((w) => w.週次).join("、")} 週）`);
console.log(`📝 紀錄庫 ${r.records} 筆（${r.year} 學年）；作業清點 ${r.hwRecords} 筆、可算的國數社作業 ${r.hwItems} 份；沒掛學生 ${r.orphan} 筆`);
console.log(`⚠️ 需人工：作業判不出 ${unknownN} 人份；清點紀錄看不懂／科目判不出 ${r.manual.length} 筆；科目空白的課堂正向 ${blankN} 筆`);
console.log(`👥 在學 ${rows.length} 人；作業有分數的人數：${MAIN.map((s) => `${s} ${rows.filter((x) => x.hw[s].hw != null).length}`).join("／")}`);
console.log(`🔑 指紋 ${fp}（f51 寫入時 payload 要帶同一個）`);

const n1 = (x) => Math.floor(x * 10 + 0.5) / 10;
const hwCell = (h) => h.hw == null ? "—" : `${h.hw}（${h.n}份${h.fix ? `・訂正${h.fix}` : ""}${h.miss ? `・未交${h.miss}` : ""}${h.unknown.length ? `・判不出${h.unknown.length}` : ""}）`;
const unknownBy = new Map();
for (const x of rows) for (const s of MAIN) for (const k of x.hw[s].unknown) unknownBy.set(k, [...(unknownBy.get(k) ?? []), x.seat]);

const lines = [
  `${term}${stage} 日常＋作業試算（範圍 ${range.from}～${range.to}，算到 ${r.asOf}：${r.weeks.length} 週；四捨五入取整數）`,
  `日常＝週等第換分平均（特優100／優95／甲90／乙85／丙75）＋該科每週最高正向程度平均×3（上限+10、總分100）`,
  `作業＝最後有完成100／仍要訂正80／仍未交0 取平均（只算國數社；預習國、聯絡簿、回條、考試預告不算）`,
  `座號｜週等第｜基本分｜日常 國／數／社（加分）｜作業 國｜作業 數｜作業 社`,
  ...rows.map((x) => `${x.seat}｜${x.grades.join("/")}｜${x.base == null ? "—" : n1(x.base)}｜`
    + MAIN.map((s) => x.daily[s] == null ? "—" : `${x.daily[s]}(+${n1(x.bonus[s])})`).join("／")
    + `｜${MAIN.map((s) => hwCell(x.hw[s])).join("｜")}`),
  ...(unknownBy.size ? ["", "⚠️ 作業判不出（這位學生這份作業沒有任何清點紀錄：已交未批改、請假未補，或那天沒結算）→ 沒算進平均："]
    .concat([...unknownBy].map(([k, s]) => `${k}：座號 ${s.join("、")}`)) : []),
  ...(r.manual.length ? ["", "⚠️ 需人工（沒算進任何人）：", ...r.manual.map((m) => m.why)] : []),
  ...(blankN ? ["", `⚠️ 科目空白的課堂正向紀錄（多是全班性紀錄如早自修、防災演練、綜合課，不算國數社加分；真的是某科就到紀錄庫補科目再重跑 f50）：`
    + rows.filter((x) => x.blankSubject).map((x) => `座號${x.seat} ${x.blankSubject} 筆`).join("、")] : []),
  "",
  `沒有可算作業的科目（—）寫入時保持空白，不填 0。`,
  `確認無誤 → 在 Claude Code 說「寫入日常作業」（指紋 ${fp}）；有問題先改紀錄庫再重跑 f50。`,
];

if (!isExecute()) { console.log("\n🔍 dry-run：未建立待審（要建請用 mode=execute）"); process.exit(0); }

// 執行紀錄是 rich_text：每段上限 2000 字，切段放（最多 100 段）
const chunks = (s) => (s.match(/[\s\S]{1,1900}/g) || [""]).slice(0, 100).map((c) => ({ type: "text", text: { content: c } }));
const title = `${term}${stage} 日常作業試算`;
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
