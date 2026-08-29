/**
 * f21｜每日課程進度：依 Notion 現行進度文字，重新掛上「◯◯單元」relation
 * ───────────────────────────────────────────────────────────────
 * 背景：f20 是一次性遷移（xlsx → Notion，只建列不改列），來源是 data/daily-plan.json。
 *       進度正本改到 Notion 之後，老師手動調課／重排複習輪次，relation 就會指到舊單元
 *       （例：複習週三輪都指著第 1 輪的 R1-1），而新產出的 R1-2／R1-3 反而沒掛上。
 *       本腳本改為「讀 Notion 的進度文字 → 解析課次代碼 → 覆寫 relation」，可重複執行。
 *
 * 與 f20 的差異：f20 建列（跳過已存在），f21 只改既有列的 relation，不動任何進度文字。
 * 解析規則與 cockpit.js／f20 同源，複習卷（R 卷）多了「輪次 → R1-n」的對應：
 *   國語 期中總複習「第N階段」→ 國R1-N
 *   數學 期中「習作範圍總驗收與訂正」→ 數R1-1；「…(N)」第N輪 → 數R1-(N+1)
 *   社會 期中「單元一／二總複習・習作訂正」→ 社R1-1；「…(N)」第N輪 → 社R1-(N+1)
 *   期末（11/09 之後）的複習輪次屬 R2 卷，教材尚未產出 → 一律留空不動。
 * 教材未建的課次留空（不清掉舊值，只在報表標「⚠️ 教材未建」讓老師自己判斷）。
 *
 * 用法：GitHub Actions → ClassOS Phase F 工具 → task=f21-relink-daily-plan
 *       mode=dry-run（預設，只列不寫）／execute（實際覆寫 relation）
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀 —— 只印日期／科目／課次代碼，不印進度文字。
 */
import { queryAll, updatePage, isExecute, DS, forEachThrottled } from "./lib/notion.mjs";

const SUBJECTS = ["國語", "數學", "社會"];
const MIDTERM_END = "2026-11-06";        // 第一次定期評量最後一天；之後的複習屬期末（R2）
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const cnNum = s => (/^\d+$/.test(s) ? Number(s)
  : s.length === 1 ? CN[s] || 0
  : s[0] === "十" ? 10 + (CN[s[1]] || 0)
  : (CN[s[0]] || 0) * 10 + (CN[s[2]] || 0));

// 單元標題 → 課次代碼（與 cockpit.js／f20 同一條正則，改了要三邊一起改）
const CODE_RE = /(?:^|\s)((?:國|數|社|自|英|健康|藝|綜)[A-Za-z]*\d+(?:-\d+)*[A-Za-z]?|SEL\d+(?:-\d+)*)(?=\s|$)/;

const text = (page, name) => (page.properties?.[name]?.rich_text ?? []).map(t => t.plain_text).join("");
const title = (page, name) => (page.properties?.[name]?.title ?? []).map(t => t.plain_text).join("");
const relIds = (page, name) => (page.properties?.[name]?.relation ?? []).map(r => r.id);

/** 進度文字 → 課次代碼。sure=false 代表靠順序或關鍵字推測，報表會標「❓ 推測」。 */
function guessCode(subject, t, date, weekTexts, pos, hasCode) {
  if (!t) return { code: "", sure: true };
  const midterm = date <= MIDTERM_END;

  if (subject === "國語") {
    const c = /第([一二三四五六七八九十]+)課/.exec(t);
    const d = /週([一二三四五])[：:]/.exec(t);
    // 「週五」是課後評量與驗收，教材沿用第四節（綜合整理內含評量卷）
    if (c && d) return { code: `國L${cnNum(c[1])}-${{ 一: 1, 二: 2, 三: 3, 四: 4, 五: 4 }[d[1]]}`, sure: true };
    if (c) {
      // 沒寫「週N：」時，用該課在本週已出現過幾次推第幾節（第 5 筆以上沿用第四節）
      const n = weekTexts.slice(0, pos)
        .filter(x => (/第([一二三四五六七八九十]+)課/.exec(x) || [])[1] === c[1]).length;
      return { code: `國L${cnNum(c[1])}-${Math.min(n + 1, 4)}`, sure: false };
    }
    const stage = /第(\d)階段/.exec(t);
    if (stage && midterm) return { code: `國R1-${Number(stage[1])}`, sure: true };
    return { code: "", sure: true };          // 期末複習（R2）與考前衝刺：教材未產出，不猜
  }

  if (subject === "數學") {
    const m = /(?:^|[\s—－-])(\d+)-(\d+)/.exec(t);
    if (m) {
      const base = `數L${Number(m[1])}-${Number(m[2])}`;
      if (hasCode(base)) return { code: base, sure: true };
      if (hasCode(`${base}a`)) return { code: `${base}a`, sure: false };   // 6-2 拆成 2a／2b
      return { code: base, sure: true };
    }
    if (!midterm) return { code: "", sure: true };
    if (/習作範圍總驗收與訂正/.test(t)) return { code: "數R1-1", sure: true };
    const round = /\((\d)\)\s*$/.exec(t);
    if (round) return { code: `數R1-${Number(round[1]) + 1}`, sure: true };
    const u = /第([一二三四五六七八九十]+)單元/.exec(t);
    if (u) {                                   // 練習園地／重點複習訂正 → 該單元最後一小節
      const n = cnNum(u[1]);
      const last = hasCode.codes.filter(k => k.startsWith(`數L${n}-`)).sort().pop();
      return { code: last || "", sure: false };
    }
    return { code: "", sure: true };
  }

  if (subject === "社會") {
    const m = /^\s*(\d+)-(\d+)/.exec(t);
    if (m) return { code: `社${Number(m[1])}-${Number(m[2])}`, sure: true };
    if (!midterm) return { code: "", sure: true };
    const round = /\((\d)\)\s*$/.exec(t);
    if (round) return { code: `社R1-${Number(round[1]) + 1}`, sure: true };
    if (/單元[一二三四]{1,2}.*總複習|期中社會總複習/.test(t)) return { code: "社R1-1", sure: true };
    return { code: "", sure: true };
  }
  return { code: "", sure: true };
}

// ── 教學單元：代碼 → pageId ──
const unitPages = await queryAll(DS.lessons);
const byCode = new Map();
for (const p of unitPages) {
  const code = (CODE_RE.exec(title(p, "單元")) || [])[1];
  if (code && !byCode.has(code)) byCode.set(code, p.id);
}
const idToCode = new Map([...byCode].map(([c, id]) => [id, c]));
const hasCode = c => byCode.has(c);
hasCode.codes = [...byCode.keys()];
console.log(`📚 教學單元 ${unitPages.length} 列，解析出課次代碼 ${byCode.size} 個`);

// ── 每日課程進度：逐列比對 ──
const days = (await queryAll(DS.dailyPlan))
  .map(p => ({
    id: p.id,
    date: p.properties?.["上課日"]?.date?.start ?? "",
    week: p.properties?.["週次"]?.number ?? null,
    texts: Object.fromEntries(SUBJECTS.map(s => [s, text(p, `${s}進度`)])),
    rels: Object.fromEntries(SUBJECTS.map(s => [s, relIds(p, `${s}單元`)])),
  }))
  .filter(d => d.date)
  .sort((a, b) => a.date.localeCompare(b.date));
console.log(`📅 每日課程進度 ${days.length} 列（${days[0]?.date} ~ ${days.at(-1)?.date}）`);

// 週內同課次的第幾節：以「同一週次、同科目」的進度文字序列判定（與 f20 同義）
const weekTexts = new Map();          // `${週次}|${科目}` → 該週進度文字陣列（依日期）
for (const d of days) {
  d.pos = {};
  for (const s of SUBJECTS) {
    if (!d.texts[s]) continue;
    const k = `${d.week}|${s}`;
    const arr = weekTexts.get(k) ?? weekTexts.set(k, []).get(k);
    d.pos[s] = arr.length;
    arr.push(d.texts[s]);
  }
}

const updates = [];
const report = [];
let stat = { same: 0, change: 0, fill: 0, noMaterial: 0, none: 0 };

days.forEach(d => {
  const props = {};
  for (const s of SUBJECTS) {
    const t = d.texts[s];
    if (!t) continue;
    const { code, sure } = guessCode(s, t, d.date, weekTexts.get(`${d.week}|${s}`) ?? [], d.pos[s] ?? 0, hasCode);
    const now = d.rels[s];
    const nowCode = now.length === 1 ? (idToCode.get(now[0]) ?? "?") : now.length ? `${now.length} 筆` : "";
    if (!code) { stat.none++; if (now.length) report.push(`${d.date}\t${s}\t（無法解析，保留 ${nowCode}）`); continue; }
    /* 教材還沒產出：把 relation 清掉，讓駕駛艙顯示「尚未建立 <代碼> 的教材」。
       留著舊值會讓那一節指著別輪的教材（例：第 3 輪指著第 1 輪），畫面上看不出來是錯的。
       教材一建好，重跑本腳本就會掛上。 */
    if (!hasCode(code)) {
      stat.noMaterial++;
      if (!now.length) { report.push(`${d.date}\t${s}\t${code} ⚠️ 教材未建（本來就空）`); continue; }
      props[`${s}單元`] = { relation: [] };
      report.push(`${d.date}\t${s}\t${nowCode} → （清空）${code} ⚠️ 教材未建`);
      continue;
    }
    const target = byCode.get(code);
    if (now.length === 1 && now[0] === target) { stat.same++; continue; }
    props[`${s}單元`] = { relation: [{ id: target }] };
    if (now.length) { stat.change++; report.push(`${d.date}\t${s}\t${nowCode} → ${code}${sure ? "" : " ❓推測"}`); }
    else { stat.fill++; report.push(`${d.date}\t${s}\t（空）→ ${code}${sure ? "" : " ❓推測"}`); }
  }
  if (Object.keys(props).length) updates.push({ date: d.date, id: d.id, props });
});

console.log(`\n── 變更明細（${report.length}）──`);
console.log(report.join("\n"));
console.log(`\n📊 已正確 ${stat.same}　改掛 ${stat.change}　補掛 ${stat.fill}　教材未建 ${stat.noMaterial}　無法解析 ${stat.none}`);
console.log(`📝 待更新 ${updates.length} 列`);

if (!isExecute()) {
  console.log("\n🔍 dry-run：未寫入任何資料。確認上表無誤後改 mode=execute 重跑。");
  process.exit(0);
}

const { ok, fail } = await forEachThrottled(updates, u => updatePage(u.id, u.props));
console.log(`\n✅ 更新成功 ${ok.length} 列，失敗 ${fail.length} 列`);
for (const f of fail) console.error(`  ❌ ${f.item?.date}：${f.error || JSON.stringify(f.r?.json?.message)}`);
if (fail.length) process.exit(1);
