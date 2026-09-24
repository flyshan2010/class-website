/**
 * f34｜浮動調價：生效日套用（SPEC_班級經濟機制 §4-2，2026-09-24 施工）
 * ───────────────────────────────────────────────────────────────
 * 在 sync.yml 的「同步 Notion 資料」**之前**跑（每天 07:00／16:00／20:00），讓 store.json 一次就拿到新價。
 * sync-notion.mjs 維持純讀取——寫 Notion 的事全在這支（SPEC §4-3 第 3 項）。
 *
 * 規則（價格帶生效日：不排「時間到才去改」的排程，每次同步都檢查一次）：
 *   調價預告公告被勾「否決調價」→ 清空兩欄、公告取消發布（不等生效日，當下就收回預告）
 *   下期價格空白或 ≤0         → 只清空兩欄，**不改價**（fail-closed）
 *   生效日已到                → 價格＝下期價格，同一次更新裡清空兩欄（漏跑一次下次補上，重跑不會改兩次）
 *   生效日未到                → 不動
 * 有動作才在收件匣留一列執行紀錄；沒事不留，免得每天三列雜訊。
 *
 * 用法：MODE=execute 才寫（sync.yml 已帶）；F34_TODAY=yyyy-mm-dd 假日期只在 dry-run 生效。
 * ⚠️ 本 repo 為 PUBLIC：只印品項與價格（本來就公開），不印學生資料。
 */
import { queryAll, api, updatePage, isExecute, DS } from "./lib/notion.mjs";

const rt = s => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const num = (p, k) => p.properties?.[k]?.number ?? null;
const title = (p, k) => (p.properties?.[k]?.title ?? []).map(t => t.plain_text).join("");
const dateOf = (p, k) => (p.properties?.[k]?.date?.start ?? "").slice(0, 10);
const ANN_PREFIX = "🏪 商店調價預告｜";   // 與 lib/price.mjs announceTitle 同一個前綴

const AS_OF = !isExecute() && /^\d{4}-\d{2}-\d{2}$/.test(process.env.F34_TODAY || "") ? process.env.F34_TODAY : "";
const today = AS_OF || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

const pending = (await queryAll(DS.store)).filter(p => dateOf(p, "調價生效日"));
if (!pending.length) { console.log(`🏪 ${today}：沒有待生效的調價`); process.exit(0); }

const anns = (await queryAll(DS.announcements)).filter(p => title(p, "標題").startsWith(ANN_PREFIX));
const vetoAnn = new Map();   // 生效日 → 被否決的公告
for (const a of anns) {
  if (!a.properties?.["否決調價"]?.checkbox) continue;
  const eff = title(a, "標題").slice(ANN_PREFIX.length, ANN_PREFIX.length + 10);
  vetoAnn.set(eff, a);
}

const CLEAR = { "下期價格": { number: null }, "調價生效日": { date: null } };
const log = [];
let fail = 0;
async function write(id, props, what) {
  if (!isExecute()) return;
  const r = await updatePage(id, props);
  if (!r.ok) { fail++; console.error(`❌ ${what}：${r.status} ${r.json?.message ?? ""}`); }
}

for (const p of pending) {
  const name = title(p, "品項"), eff = dateOf(p, "調價生效日"), old = num(p, "價格"), next = num(p, "下期價格");
  if (vetoAnn.has(eff)) {
    log.push(`🛑 ${name}：老師否決（${eff}），維持 ${old}`);
    await write(p.id, CLEAR, `${name} 清空`);
  } else if (!(next > 0)) {
    log.push(`⚠️ ${name}：下期價格空白，不改價、清掉生效日（${eff}）`);
    await write(p.id, CLEAR, `${name} 清空`);
  } else if (eff <= today) {
    log.push(`✅ ${name}：${old} → ${next}（${eff} 生效）`);
    await write(p.id, { "價格": { number: next }, ...CLEAR }, `${name} 改價`);
  }
}
for (const [eff, a] of vetoAnn) {
  if (!a.properties?.["發布"]?.checkbox) continue;
  log.push(`🛑 公告「${ANN_PREFIX}${eff}…」已否決 → 取消發布`);
  await write(a.id, { "發布": { checkbox: false } }, "公告取消發布");
}

if (!log.length) { console.log(`🏪 ${today}：${pending.length} 項待生效，日期未到`); process.exit(0); }
console.log(`🏪 ${today} 調價套用：\n${log.join("\n")}`);
if (!isExecute()) { console.log("🔍 dry-run：未寫入任何資料"); process.exit(0); }

const YEAR = String(Number(today.slice(0, 4)) - 1911 - (Number(today.slice(5, 7)) < 8 ? 1 : 0));
const r = await api("POST", "/pages", { parent: { type: "data_source_id", data_source_id: DS.inbox }, properties: {
  "任務原文": { title: rt(`商店調價套用（自動・${today}）`) },
  "狀態": { select: { name: fail ? "失敗" : "已完成" } },
  "路由ID": { rich_text: rt("R03") }, "任務類型": { select: { name: "週結" } },
  "執行紀錄": { rich_text: rt(log.join("\n") + (fail ? `\n⚠️ ${fail} 筆寫入失敗，下次同步會再試` : "")) },
  "學年": { select: { name: YEAR } },
} });
if (!r.ok) console.error(`❌ 收件匣寫入失敗：${r.status}`);
if (fail) process.exit(1);
