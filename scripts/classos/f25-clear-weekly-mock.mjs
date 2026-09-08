/**
 * ClassOS Phase F｜F25：清除班級週報的預寫（罐頭）素材
 *
 * 背景：seed 期間怕文案生成不穩，先用 fill-mock-content.mjs 把 42 週的
 *      「班級活動／學生亮點／家長配合事項」填成 8 句罐頭輪播。
 *      2026-09-08 老師實跑一週後確認生成沒問題 —— 罐頭反而讓週報講的不是真事。
 *
 * 目標終態：未發布的週報，這三欄留白，改由該週實際狀況現填。
 *
 * 安全設計：
 *   · 預設 dry-run，只列不改；MODE=execute 才動手。
 *   · 只清「值與已知罐頭清單逐字相符」的欄位 —— 老師已改寫過的內容一律不動。
 *   · 只碰未發布（狀態 ≠ 已發布）的列；已發布週報是家長看過的內容，不回頭改。
 *   · 不動 學習重點-*（依課程計畫排的）與 下週提醒（真實行事曆）。
 *   · Actions log 公開可讀，只印週次與欄名，不印內容。
 */

import { DS, queryAll, propText, updatePage, forEachThrottled, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();

// fill-mock-content.mjs 的三份罐頭清單（逐字複製，改動前先比對該檔）
const CANNED = {
  "班級活動": [
    "小組共讀與閱讀分享", "班級躲避球練習賽", "教室布置與環境整理", "社區觀察小任務",
    "跳繩闖關挑戰", "美勞創作時間", "班級才藝小舞台", "圖書館借閱日",
  ],
  "學生亮點": [
    "多位同學主動幫忙整理教室，值得表揚", "小組合作完成任務，討論越來越有效率",
    "上台發表的同學越來越有自信", "打掃工作認真負責，教室煥然一新",
    "同學間互相教導功課，展現友愛精神", "全班準時完成作業，學習態度進步",
    "下課能自動收拾與預習，自律表現佳", "對新單元充滿好奇，提問踴躍",
  ],
  "家長配合事項": [
    "請每日檢查並簽名聯絡簿", "請聽孩子分享本週學到的內容", "請協助檢查學用品是否齊全",
    "天氣多變，請幫孩子準備適當衣物", "請鼓勵孩子每天閱讀 20 分鐘", "請提醒孩子早睡早起，準時到校",
    "假日可帶孩子走訪家鄉景點，呼應社會課程", "請與孩子聊聊班級活動的感受",
  ],
};
const FIELDS = Object.keys(CANNED);

const pages = await queryAll(DS.weekly);
console.log(`📰 班級週報｜全庫 ${pages.length} 筆`);

const plan = [];
let skippedPublished = 0;
let keptCustom = 0;

for (const p of pages) {
  const week = propText(p, "週次");
  const status = propText(p, "狀態");
  if (status === "已發布") { skippedPublished++; continue; }
  const hit = [];
  for (const f of FIELDS) {
    const v = (propText(p, f) ?? "").trim();
    if (!v) continue;
    if (CANNED[f].includes(v)) hit.push(f);
    else keptCustom++;
  }
  if (hit.length) plan.push({ page: p, week, status, hit });
}

console.log(`  已發布跳過 ${skippedPublished} 筆｜老師自填內容保留 ${keptCustom} 欄`);
console.log(`\n待清 ${plan.length} 筆：`);
for (const r of plan) console.log(`    · ${r.week}（${r.status}）→ 清 ${r.hit.join("、")}`);

if (!plan.length) {
  console.log("\n✅ 沒有符合罐頭清單的欄位，無需處理。");
  process.exit(0);
}

if (!EXECUTE) {
  console.log("\n🔍 DRY-RUN 結束，未異動任何資料。");
  console.log("   確認上列週次無誤後，以 MODE=execute 重跑即清空這些欄位。");
  process.exit(0);
}

console.log("\n開始清除…\n");
const { ok, fail } = await forEachThrottled(plan, (r) =>
  updatePage(r.page.id, Object.fromEntries(r.hit.map((f) => [f, { rich_text: [] }])))
);
console.log(`  成功 ${ok.length}／失敗 ${fail.length}`);
for (const f of fail) console.log(`    ❌ ${f.error ?? `HTTP ${f.r?.status} ${f.r?.json?.code ?? ""}`}`);

// ── 回讀驗證 ──────────────────────────────────
console.log("\n回讀驗證…");
const after = await queryAll(DS.weekly);
const byId = Object.fromEntries(after.map((p) => [p.id, p]));
let residual = 0;
for (const r of plan) {
  for (const f of r.hit) {
    const v = (propText(byId[r.page.id], f) ?? "").trim();
    if (v) { residual++; console.log(`    ❌ ${r.week}｜${f} 仍有值`); }
  }
}
console.log(`  ${residual === 0 ? "✅" : "❌"} 殘留 ${residual} 欄`);

console.log("\n════════ 總結 ════════");
if (!fail.length && residual === 0) {
  console.log(`結論：${ok.length} 週的罐頭素材已清空，往後三欄由該週實際狀況現填。`);
  console.log("      學習重點-*（課程計畫）與下週提醒（行事曆）維持原樣。");
} else {
  console.log("結論：未完全清除，需檢查上列項目。");
  process.exit(1);
}
