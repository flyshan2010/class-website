/**
 * ClassOS Phase F｜F03：回填「學年」＝115
 *
 * 依據：老師 2026-07-25 第二次裁示「所有空學年都補上 115」
 *      （推翻同日稍早的「不回填」，理由見 SPEC §5 修訂說明）
 *
 * 為何這個決定讓系統變簡單：
 *   回填後「空學年」不再有合法情境 ⇒ 空值一律等於漏填 bug，
 *   §5 不必再用 created_time 區分新舊，過濾條件也能直接寫成 `學年 = 現行學年`。
 *
 * 安全設計：
 *   · 預設 dry-run，只列不改；MODE=execute 才動手。
 *   · 只補「空值」，已有學年值的列一律不碰（冪等，可重複執行）。
 *   · 逐庫回讀驗證，確認空值歸零。
 *   · 全程不印標題與 rich_text（repo 為 PUBLIC，Actions log 公開可讀）。
 */

import { DS, queryAll, propText, updatePage, forEachThrottled, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();
const FIELD = "學年";
const VALUE = "115";

/** SPEC §2 的 11 庫（不加欄位的 3 庫不在此列）。 */
const TARGETS = [
  { name: "👥 學生名冊",        ds: DS.roster },
  { name: "📝 班經與學習紀錄庫", ds: DS.log },
  { name: "📚 學期成績庫",      ds: DS.termGrades },
  { name: "🏦 班級銀行帳本",    ds: DS.bank },
  { name: "🛒 兌換申請",        ds: DS.redeem },
  { name: "🧭 學生輔導紀錄",    ds: DS.counsel },
  { name: "🎨 學生作品集",      ds: DS.portfolio },
  { name: "📊 學生學習報告",    ds: DS.reports },
  { name: "📰 班級週報",        ds: DS.weekly },
  { name: "📥 任務收件匣",      ds: DS.inbox },
  { name: "🚀 教學單元",        ds: DS.lessons },
];

const isEmpty = (p) => !(propText(p, FIELD) ?? "").trim();

console.log(`模式：${EXECUTE ? `⚠️ EXECUTE（實際回填 ${FIELD}=${VALUE}）` : "🔍 DRY-RUN（只列不改）"}\n`);

// ── 盤點 ─────────────────────────────────────
const plan = [];
for (const t of TARGETS) {
  const all = await queryAll(t.ds);
  const empty = all.filter(isEmpty);
  const filled = all.length - empty.length;
  plan.push({ ...t, all, empty });
  console.log(`  ${t.name}｜全庫 ${String(all.length).padStart(4)} 筆｜空學年 ${String(empty.length).padStart(4)} 筆｜已有值 ${filled} 筆`);
}

const total = plan.reduce((n, p) => n + p.empty.length, 0);
console.log("\n════════════════════════════");
console.log(`合計待回填 ${total} 筆`);

if (!total) {
  console.log("\n✅ 無空學年資料，無需回填。");
  process.exit(0);
}

if (!EXECUTE) {
  const secs = Math.ceil((total * 0.35) / 60);
  console.log(`\n🔍 DRY-RUN 結束，未異動任何資料。`);
  console.log(`   確認無誤後以 MODE=execute 重跑，將為上列 ${total} 筆補上 ${FIELD}=${VALUE}（節流後約需 ${secs} 分鐘）。`);
  process.exit(0);
}

// ── 執行 ─────────────────────────────────────
console.log("\n開始回填…\n");
let done = 0, failed = 0;
for (const p of plan) {
  if (!p.empty.length) continue;
  const { ok, fail } = await forEachThrottled(p.empty, (page) =>
    updatePage(page.id, { [FIELD]: { select: { name: VALUE } } })
  );
  done += ok.length; failed += fail.length;
  console.log(`  ${fail.length ? "❌" : "✅"} ${p.name} → 成功 ${ok.length}／失敗 ${fail.length}`);
  for (const f of fail.slice(0, 5)) {
    console.log(`      ${f.error ?? `HTTP ${f.r?.status} ${f.r?.json?.code ?? ""} ${f.r?.json?.message ?? ""}`}`);
  }
}

// ── 回讀驗證 ──────────────────────────────────
console.log("\n回讀驗證…");
let residue = 0;
for (const t of TARGETS) {
  const all = await queryAll(t.ds);
  const left = all.filter(isEmpty).length;
  residue += left;
  console.log(`  ${left === 0 ? "✅" : "❌"} ${t.name} 殘留空學年 ${left} 筆`);
}

console.log("\n════════ 總結 ════════");
console.log(`回填成功 ${done} 筆，失敗 ${failed} 筆，回讀殘留空值 ${residue} 筆`);
if (!failed && !residue) {
  console.log(`結論：11 庫全數帶有「${FIELD}」值，空值已絕跡。`);
  console.log("      §5 自此可採嚴格規則：學年為空 ＝ 漏填 bug，同步腳本直接報錯。");
} else {
  console.log("結論：未完全回填，需檢查上列失敗項後重跑（本腳本冪等，可安全重跑）。");
  process.exit(1);
}
