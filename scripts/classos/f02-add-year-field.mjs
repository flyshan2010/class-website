/**
 * ClassOS Phase F｜F02：為 11 個資料庫新增「學年」select 欄位
 *
 * 依據：SPEC_學年升級 §2
 * 為何要先做：§8 的 9 支 skill 從 2026-08-01 起一律要寫 `學年`，
 *            欄位不先存在，skill 改了也寫不進去。此為 §8 的硬前置。
 *
 * 安全設計：
 *   · 預設 dry-run，只列不改；MODE=execute 才動手。
 *   · 冪等 —— 已有「學年」欄位者跳過，可重複執行。
 *   · 純新增欄位，不動任何既有資料（既有列的學年留空＝舊模擬資料，見 §5）。
 *   · 執行後回讀驗證，逐庫確認欄位型別與選項值。
 */

import { DS, getSchema, api, isExecute } from "./lib/notion.mjs";
import { selfTest } from "./lib/academic-year.mjs";

const EXECUTE = isExecute();
const FIELD = "學年";
const OPTIONS = ["115", "116", "117"];

/** SPEC §2：加欄位的 11 庫。不加的 3 庫（商店／ECC 卡庫／網站設定）刻意不列。 */
const TARGETS = [
  { key: "roster",     name: "👥 學生名冊",       ds: DS.roster },
  { key: "log",        name: "📝 班經與學習紀錄庫", ds: DS.log },
  { key: "termGrades", name: "📚 學期成績庫",     ds: DS.termGrades },
  { key: "bank",       name: "🏦 班級銀行帳本",   ds: DS.bank },
  { key: "redeem",     name: "🛒 兌換申請",       ds: DS.redeem },
  { key: "counsel",    name: "🧭 學生輔導紀錄",   ds: DS.counsel },
  { key: "portfolio",  name: "🎨 學生作品集",     ds: DS.portfolio },
  { key: "reports",    name: "📊 學生學習報告",   ds: DS.reports },
  { key: "weekly",     name: "📰 班級週報",       ds: DS.weekly },
  { key: "inbox",      name: "📥 任務收件匣",     ds: DS.inbox },
  { key: "lessons",    name: "🚀 教學單元",       ds: DS.lessons },
];

// ── 前置：§1 學年公式自我驗證（公式錯，後面全錯）──
console.log("§1 學年判定公式驗證：");
if (!selfTest()) {
  console.log("\n❌ 中止：學年公式驗證未通過。");
  process.exit(1);
}
console.log(`\n模式：${EXECUTE ? "⚠️ EXECUTE（實際加欄位）" : "🔍 DRY-RUN（只列不改）"}\n`);

// ── 盤點現況 ──────────────────────────────────
const plan = [];
for (const t of TARGETS) {
  try {
    const schema = await getSchema(t.ds);
    const existing = schema[FIELD];
    plan.push({ ...t, schema, existing: existing ?? null });
    if (!existing) {
      console.log(`  ⬜ ${t.name}｜欄位數 ${Object.keys(schema).length}｜無「${FIELD}」→ 待新增`);
    } else if (existing.type !== "select") {
      console.log(`  ⚠️ ${t.name}｜已有「${FIELD}」但型別為 ${existing.type}（SPEC §2 要求 select）→ 需人工處理`);
    } else {
      const opts = (existing.select?.options ?? []).map((o) => o.name).join("/");
      console.log(`  ✅ ${t.name}｜已有「${FIELD}」select，選項：${opts || "（空）"} → 跳過`);
    }
  } catch (e) {
    plan.push({ ...t, error: e.message });
    console.log(`  ❌ ${t.name}｜讀取 schema 失敗：${e.message}`);
  }
}

const readErr = plan.filter((p) => p.error);
const typeErr = plan.filter((p) => p.existing && p.existing.type !== "select");
const todo = plan.filter((p) => !p.error && !p.existing);

console.log("\n════════════════════════════");
console.log(`共 ${TARGETS.length} 庫：待新增 ${todo.length}、已存在 ${plan.length - todo.length - readErr.length - typeErr.length}、型別不符 ${typeErr.length}、讀取失敗 ${readErr.length}`);

if (readErr.length || typeErr.length) {
  console.log("\n❌ 中止：有庫無法讀取或欄位型別不符，未做任何變更。");
  process.exit(1);
}

if (!todo.length) {
  console.log("\n✅ 11 庫皆已具備「學年」select 欄位，無需變更。");
  process.exit(0);
}

if (!EXECUTE) {
  console.log("\n🔍 DRY-RUN 結束，未異動任何 schema。");
  console.log(`   確認無誤後，以 MODE=execute 重跑即為上列 ${todo.length} 個庫新增「${FIELD}」select（選項 ${OPTIONS.join("/")}）。`);
  process.exit(0);
}

// ── 執行 ─────────────────────────────────────
console.log("\n開始新增欄位…\n");
const failed = [];
for (const t of todo) {
  const r = await api("PATCH", `/data_sources/${t.ds}`, {
    properties: { [FIELD]: { select: { options: OPTIONS.map((name) => ({ name })) } } },
  });
  console.log(`  ${r.ok ? "✅" : "❌"} ${t.name} — HTTP ${r.status}${r.ok ? "" : ` ${r.json?.code ?? ""} ${r.json?.message ?? ""}`}`);
  if (!r.ok) failed.push(t.name);
}

// ── 回讀驗證 ──────────────────────────────────
console.log("\n回讀驗證…");
let bad = 0;
for (const t of TARGETS) {
  const schema = await getSchema(t.ds);
  const f = schema[FIELD];
  const opts = (f?.select?.options ?? []).map((o) => o.name);
  const ok = f?.type === "select" && OPTIONS.every((o) => opts.includes(o));
  if (!ok) bad++;
  console.log(`  ${ok ? "✅" : "❌"} ${t.name} — 型別 ${f?.type ?? "無"}，選項 ${opts.join("/") || "（空）"}`);
}

console.log("\n════════ 總結 ════════");
console.log(`新增 ${todo.length - failed.length}／${todo.length} 成功，回讀不合格 ${bad} 庫`);
if (!failed.length && !bad) {
  console.log("結論：11 庫「學年」欄位到位，§8 寫入端改造的前置條件已滿足。");
} else {
  console.log(`結論：未全數到位（失敗：${failed.join("、") || "無"}），需檢查後重跑。`);
  process.exit(1);
}
