/**
 * f44｜教學單元網址切到公開教材庫（一次性，2026-10-10 老師裁定 D4：已做好的教材直接搬）
 * ───────────────────────────────────────────────────────────────
 * 背景：SPEC_全雲端架構 §5.4。116 個單元已複製到公開 repo `lessons` 並上線，
 *   這支把 Notion「🚀 教學單元」六個連結欄裡的班網舊址改成新址：
 *     https://flyshan2010.github.io/class-website/lessons/<單元>/<檔>
 *   → https://flyshan2010.github.io/lessons/<單元>/<檔>
 *   只換前綴，路徑其餘一字不動；Drive 連結與其他網址不碰。
 *
 * 護欄：
 *   - 只處理 url 型別的欄位；欄位不存在或型別不是 url → 列「需人工」不寫（不猜格式）。
 *   - 新址先逐一實測 HTTP 200，**有任何一個不是 200 就整批不寫**（寧可不切，不可切到壞連結）。
 *   - 寫入後逐頁回讀比對；寫入成功≠內容正確。
 *   - 其他欄位（備註等）若含舊址只列筆數、不改。
 *
 * MODE=dry-run（預設，只列對照表）／execute。
 * PAYLOAD=revert → 反向（新址改回舊址），供退回用；一樣先 dry-run。
 * ⚠️ PUBLIC repo：只印單元名、欄位名與網址（都是班網公開內容），不印頁面 id。
 */
import { queryAll, api, getSchema, forEachThrottled, isExecute, propText, DS } from "./lib/notion.mjs";

const EXECUTE = isExecute();
const REVERT = (process.env.PAYLOAD ?? "").trim() === "revert";
const OLD = "https://flyshan2010.github.io/class-website/lessons/";
const NEW = "https://flyshan2010.github.io/lessons/";
const [FROM, TO] = REVERT ? [NEW, OLD] : [OLD, NEW];
const FIELDS = ["教材", "起始評估", "教學網站", "差異化教材", "評量", "複習"];   // 與 sync-notion.mjs syncLessons 的 links 同一組

console.log(`f44｜模式 ${EXECUTE ? "⚠️ EXECUTE" : "🔍 DRY-RUN"}｜方向 ${REVERT ? "↩️ 退回（新址→舊址）" : "舊址→新址"}`);
console.log(`   ${FROM}\n → ${TO}`);

const schema = await getSchema(DS.lessons);
const manual = [];   // 需人工：欄位缺或型別不符
for (const f of FIELDS) {
  if (schema[f]?.type !== "url") manual.push(`欄位「${f}」${schema[f] ? `型別是 ${schema[f].type}` : "不存在"}`);
}
const urlFields = FIELDS.filter((f) => schema[f]?.type === "url");

const pages = await queryAll(DS.lessons);
const todo = [];     // { id, title, changes: [{ field, from, to }] }
const tally = { from: 0, to: 0, drive: 0, other: 0, empty: 0 };
const otherHits = new Map();   // 非連結欄含舊址：欄位名 → 筆數

for (const p of pages) {
  const title = propText(p, "單元") || "（無標題）";
  const changes = [];
  for (const f of urlFields) {
    const v = p.properties?.[f]?.url ?? "";
    if (!v) tally.empty++;
    else if (v.startsWith(FROM)) { tally.from++; changes.push({ field: f, from: v, to: TO + v.slice(FROM.length) }); }
    else if (v.startsWith(TO)) tally.to++;
    else if (v.startsWith("https://drive.google.com/")) tally.drive++;
    else { tally.other++; manual.push(`${title}｜${f}｜不認得的網址：${v}`); }
  }
  for (const [name, prop] of Object.entries(p.properties ?? {})) {
    if (urlFields.includes(name)) continue;
    const text = prop.type === "url" ? (prop.url ?? "") : (propText(p, name) ?? "");
    if (text.includes(FROM)) otherHits.set(name, (otherHits.get(name) ?? 0) + 1);
  }
  if (changes.length) todo.push({ id: p.id, title, changes });
}

const total = todo.reduce((n, t) => n + t.changes.length, 0);
console.log(`\n教學單元 ${pages.length} 列｜連結欄 ${urlFields.length} 個`);
console.log(`   要改 ${tally.from}｜已是目標前綴 ${tally.to}｜Drive 連結（不動）${tally.drive}｜其他 ${tally.other}｜空白 ${tally.empty}`);
console.log(`   涉及 ${todo.length} 個單元、${total} 個網址`);
for (const [name, n] of otherHits) console.log(`   ℹ️ 非連結欄「${name}」有 ${n} 列含來源前綴（本任務不改）`);
if (manual.length) {
  console.log(`\n⚠️ 需人工 ${manual.length} 項：`);
  for (const m of manual) console.log(`   ${m}`);
}

// 目標網址逐一實測（8 路並行），任何一個不是 200 就整批不寫
const all = todo.flatMap((t) => t.changes.map((c) => ({ title: t.title, ...c })));
const bad = [];
let cursor = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < all.length) {
    const c = all[cursor++];
    let status = 0;
    try { status = (await fetch(c.to, { method: "HEAD", redirect: "manual" })).status; } catch { /* 連不上＝0 */ }
    if (status !== 200) bad.push(`${status}｜${c.title}｜${c.field}｜${c.to}`);
  }
}));
console.log(`\n目標網址實測：${all.length - bad.length} 個 200｜${bad.length} 個異常`);
for (const b of bad) console.log(`   ❌ ${b}`);

// 對照表（也是舊值存檔：execute 前把這段存下來，退回時逐字對得回去）
console.log("\n===F44-MAP-BEGIN===");
console.log(JSON.stringify(all.map(({ title, field, from, to }) => ({ 單元: title, 欄位: field, 改前: from, 改後: to }))));
console.log("===F44-MAP-END===");

if (!EXECUTE) { console.log("\n🔍 DRY-RUN：未寫入。確認對照表後改 MODE=execute。"); process.exit(0); }
if (bad.length) { console.log("\n❌ 目標網址有異常，整批不寫。"); process.exit(1); }
if (!total) { console.log("\n沒有要改的網址。"); process.exit(0); }

const res = await forEachThrottled(todo, async (t) => {
  const w = await api("PATCH", `/pages/${t.id}`, { properties: Object.fromEntries(t.changes.map((c) => [c.field, { url: c.to }])) });
  if (!w.ok) return { ok: false, why: `${t.title}｜HTTP ${w.status}` };
  const back = (await api("GET", `/pages/${t.id}`)).json ?? {};
  const wrong = t.changes.filter((c) => back.properties?.[c.field]?.url !== c.to).map((c) => c.field);
  return wrong.length ? { ok: false, why: `${t.title}｜回讀不符：${wrong.join("、")}` } : { ok: true, n: t.changes.length };
});
const written = res.ok.reduce((n, o) => n + (o.r?.n ?? 0), 0);
console.log(`\n✅ 寫入並回讀相符 ${res.ok.length} 個單元、${written} 個網址｜失敗 ${res.fail.length} 個單元`);
for (const f of res.fail) console.log(`   ❌ ${f.r?.why ?? `${f.item?.title}｜${f.error}`}`);
process.exitCode = res.fail.length || written !== total ? 1 : 0;
