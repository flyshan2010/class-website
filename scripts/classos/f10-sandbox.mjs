/**
 * ClassOS Phase F｜F10：沙盒建置／拆除（SPEC_學年升級 §7）
 *
 * 切換式：沙盒不存在 → 建立；已存在 → 整頁刪除。
 * 用途：讓升級精靈（F11）能在拋棄式環境完整演練，正式庫零污染。
 */

import { isExecute } from "./lib/notion.mjs";
import { SANDBOX_TITLE, findSandboxPage, sandboxDataSources, buildSandbox, teardownSandbox } from "./lib/sandbox.mjs";

const EXECUTE = isExecute();
const existing = await findSandboxPage();

console.log(`模式：${EXECUTE ? "⚠️ EXECUTE" : "🔍 DRY-RUN（只列不改）"}`);
console.log(`沙盒「${SANDBOX_TITLE}」：${existing ? `已存在（${existing}）` : "不存在"}\n`);

if (existing) {
  const dbs = await sandboxDataSources(existing);
  console.log("目前沙盒內容：");
  for (const [title, v] of Object.entries(dbs)) {
    console.log(`  · ${title}｜data source ${v.dataSourceId ?? "（取不到）"}`);
  }
  console.log(`\n本次動作：**整頁刪除**（SPEC §7 規則 3，演練完即拋棄）`);
  if (!EXECUTE) { console.log("\n🔍 DRY-RUN 結束。以 MODE=execute 重跑即刪除。"); process.exit(0); }

  const r = await teardownSandbox(existing);
  console.log(`  ${r.ok ? "✅" : "❌"} 刪除 HTTP ${r.status}`);
  const after = await findSandboxPage();
  console.log(`\n回讀驗證：沙盒${after ? "❌ 仍存在" : "✅ 已不存在"}`);
  process.exit(after ? 1 : 0);
} else {
  console.log("本次動作：**建立沙盒**（1 頁＋2 個庫＋種子資料）");
  console.log("  · 👥 學生名冊（沙盒）：3 列（2 在學＋1 已非在學，用來驗證精靈只動在學列）");
  console.log("  · ⚙️ 網站設定（沙盒）：學年度=115學年度、班級=四年四班");
  if (!EXECUTE) { console.log("\n🔍 DRY-RUN 結束。以 MODE=execute 重跑即建立。"); process.exit(0); }

  console.log("");
  const { pageId, dbs } = await buildSandbox();
  console.log(`\n回讀驗證…`);
  const found = await findSandboxPage();
  const re = found ? await sandboxDataSources(found) : {};
  const ok = found === pageId && Object.keys(re).length === 2 && Object.values(re).every(v => v.dataSourceId);
  for (const [t, v] of Object.entries(re)) console.log(`  ✅ ${t}｜${v.dataSourceId}`);
  console.log(`\n${ok ? "✅ 沙盒就緒，可執行 f11-upgrade-wizard（target=sandbox）" : "❌ 沙盒建置不完整"}`);
  process.exit(ok ? 0 : 1);
}
