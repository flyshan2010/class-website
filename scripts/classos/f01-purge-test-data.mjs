/**
 * ClassOS Phase F｜F01：清除 Phase A 驗收測試資料
 *
 * 依據：class-website/docs/開學前檢核清單.md §一第一點
 * 目的（雙重）：
 *   1. 清掉 23 筆會干擾開學後週結／報告的模擬資料（原本只能老師手動刪）。
 *   2. 當作 Phase F 腳本引擎的第一次正式庫實跑——用一批「本來就該刪」的資料當演練場，
 *      風險最低而情境最真實。
 *
 * 安全設計：
 *   · 預設 dry-run，只列不刪；MODE=execute 才動手。
 *   · 實際筆數與預期不符即中止，不刪任何一筆（防止條件寫錯而誤刪真實資料）。
 *   · 刪除＝ archived:true（進 Notion 垃圾桶，30 天內可還原），非硬刪。
 *   · 全程不印標題與 rich_text（repo 為 PUBLIC，Actions log 公開可讀）。
 */

import { DS, queryAll, getSchema, propText, archivePage, forEachThrottled, shortId, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();

/** 待清除的四個批次。expect＝檢核清單記載的筆數，用於防呆。 */
const BATCHES = [
  {
    id: "L1", label: "📝 紀錄庫｜週次＝115上第九週", ds: DS.log, expect: 7,
    match: (p) => propText(p, "週次")?.includes("115上第九週"),
    show: (p) => propText(p, "週次"),
  },
  {
    id: "L2", label: "📝 紀錄庫｜日期＝2026-07-24～25", ds: DS.log, expect: 2,
    match: (p) => {
      const d = propText(p, "日期") ?? "";
      return d.startsWith("2026-07-24") || d.startsWith("2026-07-25");
    },
    show: (p) => propText(p, "日期"),
  },
  {
    id: "R1", label: "📊 報告庫｜期間＝115上第九週", ds: DS.reports, expect: 3,
    match: (p) => propText(p, "期間")?.includes("115上第九週"),
    show: (p) => propText(p, "期間"),
  },
  {
    id: "I1", label: "📥 收件匣｜全部", ds: DS.inbox, expect: 11,
    match: () => true,
    show: (p) => p.created_time?.slice(0, 10) ?? "",
  },
];

console.log(`模式：${EXECUTE ? "⚠️ EXECUTE（實際封存）" : "🔍 DRY-RUN（只列不刪）"}\n`);

// 同一個庫只撈一次，避免重複分頁查詢。
const cache = new Map();
async function pages(ds) {
  if (!cache.has(ds)) cache.set(ds, await queryAll(ds));
  return cache.get(ds);
}

const plan = [];
let mismatch = false;

for (const b of BATCHES) {
  const all = await pages(b.ds);
  const hit = all.filter(b.match);
  const okCount = hit.length === b.expect;
  if (!okCount) mismatch = true;

  console.log(`【${b.id}】${b.label}`);
  console.log(`  全庫 ${all.length} 筆，命中 ${hit.length} 筆（預期 ${b.expect}）${okCount ? "✅" : "❌ 不符"}`);
  for (const p of hit) console.log(`    · ${shortId(p.id)}  ${b.show(p)}`);

  if (!okCount) {
    // 條件可能寫錯或資料已變動 —— 印出欄位名協助診斷，但不印任何值。
    const schema = await getSchema(b.ds);
    console.log(`  ⚠️ 該庫欄位名：${Object.keys(schema).join("｜")}`);
  }
  console.log("");
  plan.push({ b, hit });
}

const total = plan.reduce((n, x) => n + x.hit.length, 0);
console.log("════════════════════════════");
console.log(`合計待清除 ${total} 筆（預期 ${BATCHES.reduce((n, b) => n + b.expect, 0)} 筆）`);

if (mismatch) {
  console.log("\n❌ 中止：實際筆數與檢核清單不符，未刪除任何資料。");
  console.log("   請先確認資料現況（可能已手動刪過、或篩選條件需調整），再重跑。");
  process.exit(1);
}

if (!EXECUTE) {
  console.log("\n🔍 DRY-RUN 結束，未異動任何資料。");
  console.log("   確認上列清單無誤後，以 MODE=execute 重跑即實際封存。");
  process.exit(0);
}

console.log("\n開始封存…\n");
let done = 0, failed = 0;
for (const { b, hit } of plan) {
  const { ok, fail } = await forEachThrottled(hit, (p) => archivePage(p.id));
  done += ok.length; failed += fail.length;
  console.log(`【${b.id}】${b.label} → 成功 ${ok.length}／失敗 ${fail.length}`);
  for (const f of fail) console.log(`    ❌ ${shortId(f.item.id)} ${f.error ?? `HTTP ${f.r?.status} ${f.r?.json?.code ?? ""}`}`);
}

// ── 回讀驗證（宣稱已做必附證據）──────────────────
console.log("\n回讀驗證…");
cache.clear();
let residue = 0;
for (const b of BATCHES) {
  const all = await pages(b.ds);
  const left = all.filter(b.match).length;
  residue += left;
  console.log(`  ${left === 0 ? "✅" : "❌"} 【${b.id}】${b.label} 殘留 ${left} 筆`);
}

console.log("\n════════ 總結 ════════");
console.log(`封存成功 ${done} 筆，失敗 ${failed} 筆，回讀殘留 ${residue} 筆`);
if (failed === 0 && residue === 0) {
  console.log("結論：Phase A 遺留測試資料已全數清除，開學後週結／報告不會再撈到假資料。");
} else {
  console.log("結論：未完全清除，需檢查上列失敗項。");
  process.exit(1);
}
