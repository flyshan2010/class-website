/**
 * ClassOS Phase F｜F26：清除班級週報預寫的「學習重點」
 *
 * 背景：F25 清掉三欄罐頭素材後，老師裁示「學習重點依當週的每日課程進度處理」。
 *      但 class-weekly v2 的規則是「只補空欄、不覆蓋老師已填」——
 *      預寫的學習重點留著，就永遠輪不到 daily-plan 那條路，
 *      而且老師在 Notion 調課後，這份靜態副本只會越來越舊。
 *
 * 目標終態：未發布的週報學習重點四欄留白，產文案時現撈「📅 每日課程進度」。
 *
 * 安全設計：
 *   · 預設 dry-run；MODE=execute 才動手。
 *   · 只碰狀態 ≠ 已發布 的列（已發布是家長看過的內容）。
 *   · 不動 下週提醒（真實行事曆）與 F25 已清的三欄。
 *   · Actions log 公開可讀，只印週次與欄名。
 */

import { DS, queryAll, propText, updatePage, forEachThrottled, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();
const FIELDS = ["學習重點-國語", "學習重點-數學", "學習重點-社會", "學習重點-其他"];

const pages = await queryAll(DS.weekly);
console.log(`📰 班級週報｜全庫 ${pages.length} 筆`);

const plan = [];
let skippedPublished = 0;
for (const p of pages) {
  const status = propText(p, "狀態");
  if (status === "已發布") { skippedPublished++; continue; }
  const hit = FIELDS.filter((f) => (propText(p, f) ?? "").trim());
  if (hit.length) plan.push({ page: p, week: propText(p, "週次"), status, hit });
}

console.log(`  已發布跳過 ${skippedPublished} 筆\n待清 ${plan.length} 筆：`);
for (const r of plan) console.log(`    · ${r.week}（${r.status}）→ 清 ${r.hit.length} 欄`);

if (!plan.length) { console.log("\n✅ 無需處理。"); process.exit(0); }

if (!EXECUTE) {
  console.log("\n🔍 DRY-RUN 結束，未異動任何資料。");
  console.log("   確認上列週次無誤後，以 MODE=execute 重跑即清空學習重點四欄。");
  process.exit(0);
}

console.log("\n開始清除…\n");
const { ok, fail } = await forEachThrottled(plan, (r) =>
  updatePage(r.page.id, Object.fromEntries(r.hit.map((f) => [f, { rich_text: [] }])))
);
console.log(`  成功 ${ok.length}／失敗 ${fail.length}`);
for (const f of fail) console.log(`    ❌ ${f.error ?? `HTTP ${f.r?.status} ${f.r?.json?.code ?? ""}`}`);

console.log("\n回讀驗證…");
const after = await queryAll(DS.weekly);
const byId = Object.fromEntries(after.map((p) => [p.id, p]));
let residual = 0;
for (const r of plan) {
  for (const f of r.hit) {
    if ((propText(byId[r.page.id], f) ?? "").trim()) { residual++; console.log(`    ❌ ${r.week}｜${f} 仍有值`); }
  }
}
console.log(`  ${residual === 0 ? "✅" : "❌"} 殘留 ${residual} 欄`);

console.log("\n════════ 總結 ════════");
if (!fail.length && residual === 0) {
  console.log(`結論：${ok.length} 週的預寫學習重點已清空，往後由「📅 每日課程進度」該週實際進度現撈。`);
} else {
  console.log("結論：未完全清除，需檢查上列項目。");
  process.exit(1);
}
