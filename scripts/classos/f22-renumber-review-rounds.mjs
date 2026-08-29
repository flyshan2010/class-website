/**
 * f22｜每日課程進度：把複習週的輪次編號改成與課次代碼一致
 * ───────────────────────────────────────────────────────────────
 * 背景（老師 2026-08-29 裁示）：輪次要跟代碼對齊——`數R1-1`＝第一輪、`數R1-2`＝第二輪…
 *       原本進度文字的 `(1)` 是「習作驗收之後的第 1 輪」，比代碼少 1，
 *       駕駛艙與 f21 只好靠 +1 的偏移量硬對，一改動就會錯位。
 *       本腳本把進度文字的輪次改成「第幾輪就寫幾」，之後 `(N)` ↔ `R?-N` 直接對應，不再有偏移。
 *
 * 冪等：輪次由「週次 → 第幾輪」對照表決定，**不是**把現有數字 +1，
 *       所以重跑不會愈跑愈大。已經是正確編號的格子會被判為「已正確」跳過。
 *
 * 只改複習週的格子：正課（國語「第N課」、數學／社會「N-M」）與考後（寒假銜接、課程總結）一律跳過。
 *
 * 用法：GitHub Actions → ClassOS Phase F 工具 → task=f22-renumber-review-rounds
 *       mode=dry-run（預設，只列不寫）／execute（實際改寫進度文字）
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印日期／科目／新舊輪次，不印整段進度文字。
 */
import { queryAll, updatePage, isExecute, DS, forEachThrottled } from "./lib/notion.mjs";

const SUBJECTS = ["國語", "數學", "社會"];

/* 週次 → 第幾輪（依 PLAN_複習週預排表.md 2026-08-29 修訂版）
   期中：國語 3 輪（W7–W10）／數學・社會 4 輪（W6–W10），W9 與 W10 併為最後一輪
   期末：國語 3 輪（W17–W20）／數學 4 輪（W15–W20）／社會 4 輪（W16–W20） */
const ROUND = {
  國語: { 7: 1, 8: 2, 9: 3, 10: 3, 17: 1, 18: 2, 19: 3, 20: 3 },
  數學: { 6: 1, 7: 2, 8: 3, 9: 4, 10: 4, 15: 1, 16: 2, 17: 3, 18: 4, 19: 4, 20: 4 },
  社會: { 6: 1, 7: 2, 8: 3, 9: 4, 10: 4, 16: 1, 17: 2, 18: 3, 19: 4, 20: 4 },
};

// 正課（不是複習）：國語寫「第N課」、數學／社會寫「N-M」
const LESSON_RE = { 國語: /第[一二三四五六七八九十]+課/, 數學: /(?:^|[\s—－-])\d+-\d+/, 社會: /^\s*\d+-\d+/ };
// 考後（寒假銜接、課程總結、閱讀分享）不是複習
const AFTER_EXAM_RE = /寒假|暑假|閱讀分享|生活應用|課程總結|自主學習/;

const text = (page, name) => (page.properties?.[name]?.rich_text ?? []).map(t => t.plain_text).join("");
const rt = s => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];

/** 回傳改寫後的進度文字；不需要改就回傳 null。 */
function renumber(subject, t, round) {
  if (subject === "國語") {
    // 「（第N階段：…）」＝輪次；考前衝刺那幾天原本沒寫階段，補成同一輪的收尾
    if (/第\d階段/.test(t)) {
      const next = t.replace(/第\d階段/, `第${round}階段`);
      return next === t ? null : next;
    }
    if (/衝刺/.test(t)) {
      // 考前衝刺那幾天原本沒寫階段（「期中考考前總衝刺 / 11/05~11/06 第一次定期評量」），
      // 併進最後一輪後要補上階段，斜線後的定期評量日期原樣保留。
      const term = /期末/.test(t) ? "期末" : "期中";
      const tail = t.split("/").slice(1).join("/").trim();
      return `${term}國語總複習與平時考（第${round}階段：考前總衝刺）${tail ? ` / ${tail}` : ""}`;
    }
    return null;
  }
  // 數學／社會：句尾的「(N)」＝輪次，沒有就補上
  const has = /[（(](\d)[）)]\s*$/.exec(t);
  if (has) return Number(has[1]) === round ? null : t.replace(/[（(]\d[）)]\s*$/, `(${round})`);
  return `${t}(${round})`;
}

const rows = (await queryAll(DS.dailyPlan))
  .map(p => ({
    id: p.id,
    date: p.properties?.["上課日"]?.date?.start ?? "",
    week: p.properties?.["週次"]?.number ?? 0,
    texts: Object.fromEntries(SUBJECTS.map(s => [s, text(p, `${s}進度`)])),
  }))
  .filter(r => r.date)
  .sort((a, b) => a.date.localeCompare(b.date));
console.log(`📅 每日課程進度 ${rows.length} 列`);

const updates = [];
const report = [];
let stat = { ok: 0, fix: 0, skip: 0 };

for (const r of rows) {
  const props = {};
  for (const s of SUBJECTS) {
    const t = r.texts[s];
    if (!t) continue;
    const round = ROUND[s]?.[r.week];
    if (!round) { stat.skip++; continue; }                       // 不是複習週
    if (LESSON_RE[s].test(t) || AFTER_EXAM_RE.test(t)) { stat.skip++; continue; }  // 正課或考後
    const next = renumber(s, t, round);
    if (!next) { stat.ok++; continue; }
    props[`${s}進度`] = { rich_text: rt(next) };
    stat.fix++;
    report.push(`${r.date}\tW${r.week}\t${s}\t→ 第 ${round} 輪`);
  }
  if (Object.keys(props).length) updates.push({ date: r.date, id: r.id, props });
}

console.log(`\n── 改寫明細（${report.length}）──`);
console.log(report.join("\n"));
console.log(`\n📊 已正確 ${stat.ok}　改寫 ${stat.fix}　非複習跳過 ${stat.skip}`);
console.log(`📝 待更新 ${updates.length} 列`);

if (!isExecute()) {
  console.log("\n🔍 dry-run：未寫入任何資料。確認上表無誤後改 mode=execute 重跑。");
  process.exit(0);
}

const { ok, fail } = await forEachThrottled(updates, u => updatePage(u.id, u.props));
console.log(`\n✅ 更新成功 ${ok.length} 列，失敗 ${fail.length} 列`);
for (const f of fail) console.error(`  ❌ ${f.item?.date}：${f.error || JSON.stringify(f.r?.json?.message)}`);
if (fail.length) process.exit(1);
