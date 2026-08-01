/**
 * ClassOS｜f14：清除全流程演練遺留的「（模擬）」資料
 *
 * 背景：2026-07-11／07-12／07-25 三波全流程演練，把「（模擬）」開頭的假資料寫進正式庫，
 *       且用的是真實學生姓名。班網已上線，學生用查詢碼登入會看到假餘額與假報告。
 *       （2026-07-25 f01 清掉的是 Phase A 驗收那 23 筆，與本批不同批。）
 *
 * 安全設計（沿用 f01）：
 *   · 預設 dry-run，只列不刪；MODE=execute 才動手。
 *   · **兩段式**：dry-run 先盤點實際筆數 → 老師確認 → 把筆數填進 EXPECT → 才允許 execute。
 *     任一批次 expect 為 null 或與實際不符，execute 一律中止，不刪任何一筆。
 *   · 刪除＝ archived:true（進 Notion 垃圾桶，30 天內可還原），非硬刪。
 *   · 全程不印標題與 rich_text（repo 為 PUBLIC，Actions log 公開可讀）——
 *     「（模擬）」標題內含真實學生姓名，只印去識別化短碼與日期／週次。
 */

import { DS, queryAll, propText, archivePage, forEachThrottled, shortId, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();

/** 標題是否為演練資料（一律以「（模擬）」前綴判定，避免誤傷真實資料）。 */
const isMock = (p, titleProp) => (propText(p, titleProp) ?? "").startsWith("（模擬）");

/**
 * 待盤點的批次。
 * expect：null＝尚未確認（只能 dry-run）；填數字後才允許 execute。
 * show：印給老師看的辨識欄位，**不得選標題或任何含姓名的欄位**。
 */
const BATCHES = [
  { id: "M1", label: "📝 班經與學習紀錄庫", ds: DS.log,        title: "紀錄",   expect: null, show: (p) => `${propText(p, "日期") ?? ""} ${propText(p, "週次") ?? ""}`.trim() },
  { id: "M2", label: "🏦 班級銀行帳本",     ds: DS.bank,       title: "項目",   expect: null, show: (p) => `${propText(p, "日期") ?? ""} ${propText(p, "週次") ?? ""}`.trim() },
  { id: "M3", label: "📊 學生學習報告",     ds: DS.reports,    title: "報告",   expect: null, show: (p) => propText(p, "期間") ?? "" },
  { id: "M4", label: "📚 學期成績庫",       ds: DS.termGrades, title: "名稱",   expect: null, show: (p) => propText(p, "學期") ?? "" },
  { id: "M5", label: "🧭 學生輔導紀錄",     ds: DS.counsel,    title: "個案",   expect: null, show: (p) => propText(p, "開案日期") ?? "" },
  { id: "M6", label: "🎨 學生作品集",       ds: DS.portfolio,  title: "作品",   expect: null, show: (p) => propText(p, "日期") ?? "" },
  { id: "M7", label: "🛒 兌換申請",         ds: DS.redeem,     title: "申請",   expect: null, show: (p) => propText(p, "申請日期") ?? "" },
  { id: "M8", label: "📰 班級週報",         ds: DS.weekly,     title: "週次",   expect: null, show: (p) => p.created_time?.slice(0, 10) ?? "" },
];

console.log(`模式：${EXECUTE ? "⚠️ EXECUTE（實際封存）" : "🔍 DRY-RUN（只列不刪）"}\n`);

const cache = new Map();
async function pages(ds) {
  if (!cache.has(ds)) cache.set(ds, await queryAll(ds));
  return cache.get(ds);
}

/** 各庫的標題欄名可能與上表不同 —— 一律從 schema 實際回傳值找 type==="title"。 */
function titleProp(page) {
  for (const [name, p] of Object.entries(page.properties ?? {})) {
    if (p.type === "title") return name;
  }
  return null;
}

const plan = [];
let mismatch = false;

for (const b of BATCHES) {
  const all = await pages(b.ds);
  const tp = all.length ? titleProp(all[0]) : b.title;
  const hit = all.filter((p) => isMock(p, tp));
  // 次要訊號：標題非「（模擬）」開頭但含「模擬」二字者，只報數不刪，避免漏網或誤殺。
  const loose = all.filter((p) => !isMock(p, tp) && (propText(p, tp) ?? "").includes("模擬")).length;

  const okCount = b.expect !== null && hit.length === b.expect;
  if (!okCount) mismatch = true;

  console.log(`【${b.id}】${b.label}（標題欄：${tp}）`);
  console.log(`  全庫 ${all.length} 筆，「（模擬）」開頭 ${hit.length} 筆` +
    (b.expect === null ? "（尚未設定預期值）" : `（預期 ${b.expect}）${okCount ? " ✅" : " ❌ 不符"}`));
  if (loose) console.log(`  ⚠️ 另有 ${loose} 筆標題含「模擬」但非前綴 —— 本腳本不動，請人工判讀`);
  for (const p of hit) console.log(`    · ${shortId(p.id)}  ${b.show(p)}`);

  // ── 保留清單（老師核對誤刪用）───────────────────
  // 逐筆列出「不會被刪」的資料；超過 12 筆只印統計，避免 log 過長。
  const keep = all.filter((p) => !isMock(p, tp));
  console.log(`  🟢 保留 ${keep.length} 筆` + (keep.length > 12 ? "（>12 筆，只印彙總）" : ""));
  if (keep.length && keep.length <= 12) {
    for (const p of keep) console.log(`    ○ ${shortId(p.id)}  建立 ${p.created_time?.slice(0, 10)}  ${b.show(p)}`);
  } else if (keep.length) {
    const byDay = new Map();
    for (const p of keep) {
      const d = p.created_time?.slice(0, 10) ?? "?";
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    for (const [d, n] of [...byDay].sort()) console.log(`    ○ 建立 ${d}：${n} 筆`);
  }
  console.log("");
  plan.push({ b, hit });
}

const total = plan.reduce((n, x) => n + x.hit.length, 0);
console.log("════════════════════════════");
console.log(`合計「（模擬）」資料 ${total} 筆`);

if (!EXECUTE) {
  console.log("\n🔍 DRY-RUN 結束，未異動任何資料。");
  console.log("   下一步：把上列各批次實際筆數填進本檔 BATCHES 的 expect，再以 MODE=execute 重跑。");
  process.exit(0);
}

if (mismatch) {
  console.log("\n❌ 中止：有批次未設定 expect 或筆數與 expect 不符，未刪除任何資料。");
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

console.log("\n回讀驗證…");
cache.clear();
let residue = 0;
for (const b of BATCHES) {
  const all = await pages(b.ds);
  const tp = all.length ? titleProp(all[0]) : b.title;
  const left = all.filter((p) => isMock(p, tp)).length;
  residue += left;
  console.log(`  ${left === 0 ? "✅" : "❌"} 【${b.id}】${b.label} 殘留 ${left} 筆`);
}

console.log("\n════════ 總結 ════════");
console.log(`封存成功 ${done} 筆，失敗 ${failed} 筆，回讀殘留 ${residue} 筆`);
if (failed === 0 && residue === 0) {
  console.log("結論：演練用「（模擬）」資料已全數清除。下一步請重跑 sync.yml 讓班網餘額與報告歸零。");
} else {
  console.log("結論：未完全清除，需檢查上列失敗項。");
  process.exit(1);
}
