/**
 * ClassOS｜f14：清除全流程演練遺留的模擬資料（開學前歸零）
 *
 * 背景：2026-07-06～07-25 多波全流程演練，把假資料寫進正式庫，且用的是真實學生姓名。
 *       班網已上線，學生用查詢碼登入會看到假餘額與假報告。
 *       （2026-07-25 f01 清掉的是 Phase A 驗收那 23 筆，與本批不同批。）
 *
 * 清除範圍（2026-08-01 老師逐項核對後裁定）：
 *   · 有「（模擬）」前綴者                     372 筆
 *   · 📚 學期成績庫 108 筆（115上/下期中期末×27生，皆為未來評量，不可能已存在）
 *   · 📊 報告庫 1 筆（期間＝尚未到來的 115上第十週）
 *   · 🎨 作品集 1 筆（標題自述「R13測試作品（可刪）」）
 *   · 🛒 兌換申請 1 筆（兌換流 E2E 實測殘留）
 *   · 📝 紀錄庫 3 筆（2026-07-18 驗收殘留，老師已於 Notion 逐筆看過確認可刪）
 *   → 合計 486 筆＝以下七庫全清。
 *
 * 明確保留（不在本腳本掃描範圍內）：
 *   · 📰 班級週報 42 筆（seed-115 預排的真實週報骨架）
 *   · 👥 名冊／📒 聯絡簿／🚀 教學單元／🏪 商店／⚙️ 設定／📝 題庫／🃏 ECC／📥 收件匣
 *
 * 安全設計（沿用 f01）：
 *   · 預設 dry-run，只列不刪；MODE=execute 才動手。
 *   · 每庫 expect 為老師核對過的筆數；**任一庫實際筆數與 expect 不符即全案中止**，
 *     不刪任何一筆（防止期間有新資料寫入而被連坐誤刪）。
 *   · 刪除＝ archived:true（進 Notion 垃圾桶，30 天內可還原），非硬刪。
 *   · 全程不印標題與 rich_text（repo 為 PUBLIC，Actions log 公開可讀）——
 *     資料標題內含真實學生姓名，只印去識別化短碼與日期／週次。
 */

import { DS, queryAll, propText, archivePage, forEachThrottled, shortId, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();

/**
 * 待清除的七個庫（整庫清空）。
 * expect：2026-08-01 dry-run 實測並經老師核對的筆數，同時是防呆閘門。
 * show：印給老師看的辨識欄位，**不得選標題或任何含姓名的欄位**。
 */
const BATCHES = [
  { id: "M1", label: "📝 班經與學習紀錄庫", ds: DS.log,        expect: 91,  show: (p) => `${propText(p, "日期") ?? ""} ${propText(p, "週次") ?? ""}`.trim() },
  { id: "M2", label: "🏦 班級銀行帳本",     ds: DS.bank,       expect: 154, show: (p) => `${propText(p, "日期") ?? ""} ${propText(p, "週次") ?? ""}`.trim() },
  { id: "M3", label: "📊 學生學習報告",     ds: DS.reports,    expect: 128, show: (p) => propText(p, "期間") ?? "" },
  { id: "M4", label: "📚 學期成績庫",       ds: DS.termGrades, expect: 108, show: (p) => propText(p, "學期") ?? "" },
  { id: "M5", label: "🧭 學生輔導紀錄",     ds: DS.counsel,    expect: 3,   show: (p) => p.created_time?.slice(0, 10) ?? "" },
  { id: "M6", label: "🎨 學生作品集",       ds: DS.portfolio,  expect: 1,   show: (p) => p.created_time?.slice(0, 10) ?? "" },
  { id: "M7", label: "🛒 兌換申請",         ds: DS.redeem,     expect: 1,   show: (p) => p.created_time?.slice(0, 10) ?? "" },
];

/** 明確保留、只清點不刪的庫 —— 每次跑都印出來，證明沒被誤動。 */
const KEEP = [
  { label: "📰 班級週報", ds: DS.weekly, expect: 42 },
  { label: "👥 學生名冊", ds: DS.roster, expect: 27 },
];

console.log(`模式：${EXECUTE ? "⚠️ EXECUTE（實際封存）" : "🔍 DRY-RUN（只列不刪）"}\n`);

const cache = new Map();
async function pages(ds) {
  if (!cache.has(ds)) cache.set(ds, await queryAll(ds));
  return cache.get(ds);
}

const plan = [];
let mismatch = false;

for (const b of BATCHES) {
  const all = await pages(b.ds);
  const ok = all.length === b.expect;
  if (!ok) mismatch = true;

  console.log(`【${b.id}】${b.label}`);
  console.log(`  全庫 ${all.length} 筆，預期 ${b.expect} 筆 ${ok ? "✅" : "❌ 不符（將中止）"}`);
  for (const p of all.slice(0, 5)) console.log(`    · ${shortId(p.id)}  ${b.show(p)}`);
  if (all.length > 5) console.log(`    …（其餘 ${all.length - 5} 筆略）`);
  console.log("");
  plan.push({ b, hit: all });
}

console.log("──── 明確保留（不刪，僅清點）────");
for (const k of KEEP) {
  const all = await pages(k.ds);
  const ok = all.length === k.expect;
  if (!ok) mismatch = true;
  console.log(`  🟢 ${k.label}：${all.length} 筆（預期 ${k.expect}）${ok ? "✅ 原封不動" : "❌ 不符（將中止）"}`);
}

const total = plan.reduce((n, x) => n + x.hit.length, 0);
console.log("\n════════════════════════════");
console.log(`合計待清除 ${total} 筆（預期 ${BATCHES.reduce((n, b) => n + b.expect, 0)} 筆）`);

if (!EXECUTE) {
  console.log("\n🔍 DRY-RUN 結束，未異動任何資料。");
  if (mismatch) console.log("⚠️ 但已有筆數不符，execute 會中止 —— 請先確認資料現況。");
  process.exit(0);
}

if (mismatch) {
  console.log("\n❌ 中止：有庫的實際筆數與老師核對過的 expect 不符，未刪除任何資料。");
  console.log("   可能是核對後又有新資料寫入 —— 請重跑 dry-run 確認後再調整 expect。");
  process.exit(1);
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
  const left = (await pages(b.ds)).length;
  residue += left;
  console.log(`  ${left === 0 ? "✅" : "❌"} 【${b.id}】${b.label} 殘留 ${left} 筆`);
}
for (const k of KEEP) {
  const n = (await pages(k.ds)).length;
  console.log(`  ${n === k.expect ? "✅" : "❌"} 🟢 ${k.label} 仍有 ${n} 筆（應為 ${k.expect}，未被動到）`);
}

console.log("\n════════ 總結 ════════");
console.log(`封存成功 ${done} 筆，失敗 ${failed} 筆，回讀殘留 ${residue} 筆`);
if (failed === 0 && residue === 0) {
  console.log("結論：演練模擬資料已全數清除。下一步請重跑 sync.yml 讓班網餘額與報告歸零。");
} else {
  console.log("結論：未完全清除，需檢查上列失敗項。");
  process.exit(1);
}
