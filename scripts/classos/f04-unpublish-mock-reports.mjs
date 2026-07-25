/**
 * ClassOS Phase F｜F04：下架模擬學習報告
 *
 * 依據：開學前檢核清單 §一第二點——「開學正式使用前，把座號 2 的（模擬）報告設『發布＝否』」
 *      老師 2026-07-25 指示由本腳本處理。
 *
 * 目標終態：開學前站上**沒有任何發布中的模擬報告**。
 *          查詢碼已分發給家長，站上留著假資料等於讓家長看到假的孩子表現。
 *
 * 安全設計：
 *   · 預設 dry-run，只列不改；MODE=execute 才動手。
 *   · 欄位名動態探測（報告庫 40 欄，不寫死欄名以免猜錯而靜默失效）。
 *   · 只改「發布」欄，不刪任何報告——資料留著供日後比對，只是不對外顯示。
 *   · 全程不印姓名與 rich_text，只印座號與期間（repo 為 PUBLIC，Actions log 公開可讀）。
 */

import { DS, queryAll, getSchema, propText, updatePage, forEachThrottled, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();

const schema = await getSchema(DS.reports);
console.log(`📊 學生學習報告｜欄位 ${Object.keys(schema).length} 個`);

// ── 動態探測欄位名 ──────────────────────────────
const pubProp = Object.keys(schema).find((k) => k.includes("發布") && schema[k].type === "checkbox");
const seatProp = Object.keys(schema).find((k) => k.includes("座號"));
const periodProp = Object.keys(schema).find((k) => k.includes("期間"));

console.log(`  發布欄：${pubProp ?? "❌ 找不到"}｜座號欄：${seatProp ?? "（無）"}｜期間欄：${periodProp ?? "（無）"}`);

if (!pubProp) {
  console.log(`\n❌ 中止：找不到 checkbox 型別的「發布」欄位。該庫欄位名：`);
  console.log(`   ${Object.keys(schema).join("｜")}`);
  process.exit(1);
}

// ── 盤點發布中的報告 ────────────────────────────
const all = await queryAll(DS.reports);
const published = all.filter((p) => propText(p, pubProp) === "true");

console.log(`\n全庫 ${all.length} 筆，其中發布中 ${published.length} 筆：`);
for (const p of published) {
  const seat = seatProp ? propText(p, seatProp) : "?";
  const period = periodProp ? propText(p, periodProp) : "?";
  console.log(`    · 座號 ${seat}｜期間 ${period}`);
}

if (!published.length) {
  console.log("\n✅ 目前沒有發布中的報告，站上不會有模擬資料外流，無需處理。");
  process.exit(0);
}

console.log("\n════════════════════════════");
console.log(`待下架 ${published.length} 筆（全部現存報告皆為 Phase A／開發期模擬資料）`);

if (!EXECUTE) {
  console.log("\n🔍 DRY-RUN 結束，未異動任何資料。");
  console.log(`   確認上列座號無誤後，以 MODE=execute 重跑即把「${pubProp}」全部取消勾選。`);
  process.exit(0);
}

// ── 執行 ─────────────────────────────────────
console.log("\n開始下架…\n");
const { ok, fail } = await forEachThrottled(published, (p) =>
  updatePage(p.id, { [pubProp]: { checkbox: false } })
);
console.log(`  成功 ${ok.length}／失敗 ${fail.length}`);
for (const f of fail) console.log(`    ❌ ${f.error ?? `HTTP ${f.r?.status} ${f.r?.json?.code ?? ""}`}`);

// ── 回讀驗證 ──────────────────────────────────
console.log("\n回讀驗證…");
const after = await queryAll(DS.reports);
const stillPublished = after.filter((p) => propText(p, pubProp) === "true");
console.log(`  ${stillPublished.length === 0 ? "✅" : "❌"} 仍發布中 ${stillPublished.length} 筆`);
for (const p of stillPublished) {
  console.log(`    · 座號 ${seatProp ? propText(p, seatProp) : "?"}｜期間 ${periodProp ? propText(p, periodProp) : "?"}`);
}

console.log("\n════════ 總結 ════════");
if (!fail.length && !stillPublished.length) {
  console.log(`結論：${ok.length} 筆模擬報告已下架，家長以查詢碼登入不會再看到假資料。`);
  console.log("      報告本身仍在 Notion，需要時重新勾選「發布」即可。");
} else {
  console.log("結論：未完全下架，需檢查上列項目。");
  process.exit(1);
}
