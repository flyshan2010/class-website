/**
 * ClassOS Phase F｜F05：fail-loud 機制實測（SPEC §10 驗收第 5 項）
 *
 * 目的：證明「學年為空 → 同步腳本報錯」真的會觸發。
 *      沒實測過的 fail-loud 比沒有更危險——它給人已受保護的錯覺。
 *
 * 用法（切換式，跑兩次一個循環）：
 *   1) MODE=execute 跑第一次 → 清空一筆的「學年」
 *   2) 跑 sync.yml     → **應該失敗**（紅燈），且班網不被提交
 *   3) MODE=execute 跑第二次 → 自動還原該筆學年
 *   4) 再跑 sync.yml   → 應該恢復綠燈
 *
 * 靶子選在「🚀 教學單元」且優先挑未勾「顯示」的列：
 *   · 教學單元在 §5 是**不過濾**的例外，但仍納入漏填偵測 → 能單獨驗證偵測邏輯，
 *     不會與過濾邏輯混淆。
 *   · 未勾顯示的列不上班網，測試期間對外零影響。
 */

import { DS, queryAll, propText, updatePage, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();
const FIELD = "學年";
const RESTORE = "115";

const rows = await queryAll(DS.lessons);
if (!rows.length) { console.log("❌ 教學單元庫沒有資料，無法測試"); process.exit(1); }

const empty = rows.filter(r => !(propText(r, FIELD) ?? "").trim());
const short = id => String(id).replace(/-/g, "").slice(0, 8);

console.log(`🚀 教學單元｜全庫 ${rows.length} 筆，其中學年為空 ${empty.length} 筆\n`);

if (empty.length) {
  // ── 還原階段 ──
  console.log(`目前處於「已清空」狀態，本次執行為**還原**：`);
  for (const r of empty) console.log(`  · ${short(r.id)} → 將補回 ${FIELD}=${RESTORE}`);
  if (!EXECUTE) { console.log("\n🔍 DRY-RUN 結束。以 MODE=execute 重跑即還原。"); process.exit(0); }

  for (const r of empty) {
    const res = await updatePage(r.id, { [FIELD]: { select: { name: RESTORE } } });
    console.log(`  ${res.ok ? "✅" : "❌"} ${short(r.id)} HTTP ${res.status}`);
  }
  const after = (await queryAll(DS.lessons)).filter(r => !(propText(r, FIELD) ?? "").trim());
  console.log(`\n回讀驗證：仍為空 ${after.length} 筆 ${after.length === 0 ? "✅" : "❌"}`);
  if (after.length) process.exit(1);
  console.log("結論：已還原。請再跑一次 sync.yml，應恢復綠燈。");
} else {
  // ── 清空階段 ──
  // 優先挑未勾「顯示」的列：不上班網，測試期間對外零影響
  const hidden = rows.filter(r => propText(r, "顯示") !== "true");
  const target = hidden[0] ?? rows[0];
  console.log(`本次執行為**清空**（製造一筆漏填來測 fail-loud）：`);
  console.log(`  靶子：${short(target.id)}（顯示=${propText(target, "顯示")}，${hidden.length ? "未上站，對外零影響" : "⚠️ 全部都已上站，此筆會暫時從班網消失"}）`);
  if (!EXECUTE) { console.log("\n🔍 DRY-RUN 結束。以 MODE=execute 重跑即清空。"); process.exit(0); }

  const res = await updatePage(target.id, { [FIELD]: { select: null } });
  console.log(`  ${res.ok ? "✅" : "❌"} 清空 HTTP ${res.status}`);
  if (!res.ok) process.exit(1);

  const check = (await queryAll(DS.lessons)).filter(r => !(propText(r, FIELD) ?? "").trim());
  console.log(`\n回讀驗證：學年為空 ${check.length} 筆 ${check.length === 1 ? "✅" : "❌"}`);
  console.log("結論：已製造一筆漏填。**現在去跑 sync.yml，預期會失敗（紅燈）**。");
  console.log("      驗證完成後再跑一次本腳本即自動還原。");
}
