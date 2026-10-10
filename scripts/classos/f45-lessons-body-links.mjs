/**
 * f45｜教學單元頁面內文的教材連結切到公開教材庫（一次性，2026-10-10 老師裁定批次改）
 * ───────────────────────────────────────────────────────────────
 * f44 只改了六個連結欄（屬性）；各單元頁面**內文**（檔案索引表、各段「網址」行）還是班網舊址。
 * 舊址靠轉址頁仍能開，這支把內文也改成新址，之後不必繞一手：
 *     flyshan2010.github.io/class-website/lessons/<單元>/<檔>
 *   → flyshan2010.github.io/lessons/<單元>/<檔>
 * 連結網址與顯示文字裡的網址都換；只換這個前綴，其餘文字、粗體等格式原樣保留。
 *
 * 護欄：
 *   - 每個新址先實測 HTTP 200；不是 200 的那一個**不改**（留舊址），列「需人工」。
 *   - 只動含舊址的區塊，一個區塊一次 PATCH，寫完回讀確認舊址字串已不在該區塊。
 *   - 沒帶網域的路徑說明文字（如「部署：class-website/lessons/…」）是當時的紀錄，不改，只列筆數。
 *
 * MODE=dry-run（預設）／execute。PAYLOAD=revert → 反向，供退回用。
 * ⚠️ PUBLIC repo：只印單元名與網址（班網公開內容），不印頁面／區塊 id 與其他內文。
 */
import { queryAll, api, isExecute, propText, DS } from "./lib/notion.mjs";

const EXECUTE = isExecute();
const REVERT = (process.env.PAYLOAD ?? "").trim() === "revert";
const OLD = "flyshan2010.github.io/class-website/lessons/";
const NEW = "flyshan2010.github.io/lessons/";
const [FROM, TO] = REVERT ? [NEW, OLD] : [OLD, NEW];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const URL_RE = new RegExp(`(?:https?://)?${esc(FROM)}[^\\s)）」』\`"<>|，。、；]*`, "g");
const BARE = "class-website/lessons/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`f45｜模式 ${EXECUTE ? "⚠️ EXECUTE" : "🔍 DRY-RUN"}｜方向 ${REVERT ? "↩️ 退回（新址→舊址）" : "舊址→新址"}`);

// Notion 每秒約 3 次；逐次呼叫＋被限流就照 Retry 等一下再試
async function call(method, path, body) {
  for (let i = 0; i < 6; i++) {
    const r = await api(method, path, body);
    if (r.status !== 429 && r.status < 500) { await sleep(120); return r; }
    await sleep(1500 * (i + 1));
  }
  return api(method, path, body);
}

async function children(id) {
  const out = [];
  let cursor;
  do {
    const r = await call("GET", `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    if (!r.ok) throw new Error(`讀區塊失敗 HTTP ${r.status}`);
    out.push(...r.json.results);
    cursor = r.json.has_more ? r.json.next_cursor : undefined;
  } while (cursor);
  return out;
}
async function walk(id, acc = []) {
  for (const b of await children(id)) {
    acc.push(b);
    if (b.has_children && b.type !== "child_page" && b.type !== "child_database") await walk(b.id, acc);
  }
  return acc;
}

// 一個區塊裡所有 rich_text 陣列（表格列是多格，其餘一個）
const richArrays = (b) => (b.type === "table_row" ? b.table_row?.cells ?? [] : b[b.type]?.rich_text ? [b[b.type].rich_text] : []);
const urlsIn = (item) => [
  ...(item.type === "text" && item.text?.link?.url?.includes(FROM) ? [item.text.link.url] : []),
  ...((item.type === "text" ? item.text?.content ?? "" : "").match(URL_RE) ?? []),
];
const target = (u) => (/^https?:\/\//.test(u) ? u : `https://${u}`).replace(FROM, TO);

const pages = await queryAll(DS.lessons);
console.log(`教學單元 ${pages.length} 列，逐頁讀內文……`);

const hits = [];   // { title, block, urls:Set }
let blocks = 0, bare = 0, readFail = 0;
for (const p of pages) {
  const title = propText(p, "單元") || "（無標題）";
  let all;
  try { all = await walk(p.id); } catch (e) { readFail++; console.log(`   ❌ ${title}｜${e.message}`); continue; }
  blocks += all.length;
  for (const b of all) {
    const urls = new Set();
    for (const arr of richArrays(b)) for (const it of arr) {
      for (const u of urlsIn(it)) urls.add(u);
      if (it.type === "text") bare += ((it.text?.content ?? "").replace(URL_RE, "").split(BARE).length - 1);
    }
    if (urls.size) hits.push({ title, block: b, urls });
  }
}

// 新址實測（去重後 8 路並行）
const status = new Map([...new Set(hits.flatMap((h) => [...h.urls].map(target)))].map((u) => [u, 0]));
const queue = [...status.keys()];
let qi = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (qi < queue.length) {
    const u = queue[qi++];
    try { status.set(u, (await fetch(u, { method: "HEAD", redirect: "manual" })).status); } catch { /* 連不上＝0 */ }
  }
}));
const ok = (u) => status.get(target(u)) === 200;
const badUrls = [...status].filter(([, s]) => s !== 200);

// 組出每個區塊要送的新內容；不是 200 的網址原樣留著
const swap = (s) => s.replace(URL_RE, (u) => (ok(u) ? u.replace(FROM, TO) : u));
const rebuild = (arr) => arr.map((it) => {
  if (it.type !== "text") return { type: it.type, [it.type]: it[it.type], annotations: it.annotations };
  const link = it.text.link?.url;
  return {
    type: "text",
    text: { content: swap(it.text.content ?? ""), link: link ? { url: link.includes(FROM) && ok(link) ? link.replace(FROM, TO) : link } : null },
    annotations: it.annotations,
  };
});
const todo = [];
let nChange = 0, nSkip = 0;
const byTitle = new Map();
for (const h of hits) {
  const good = [...h.urls].filter(ok);
  nSkip += h.urls.size - good.length;
  if (!good.length) continue;
  nChange += good.length;
  byTitle.set(h.title, (byTitle.get(h.title) ?? 0) + good.length);
  const b = h.block;
  const body = b.type === "table_row" ? { table_row: { cells: b.table_row.cells.map(rebuild) } } : { [b.type]: { rich_text: rebuild(b[b.type].rich_text) } };
  todo.push({ id: b.id, title: h.title, body, urls: good });
}

console.log(`\n讀了 ${blocks} 個區塊${readFail ? `（${readFail} 頁讀取失敗）` : ""}｜含來源網址的區塊 ${hits.length} 個`);
console.log(`新址實測：${status.size - badUrls.length} 個 200｜${badUrls.length} 個不是 200（不改，需人工）`);
for (const [u, s] of badUrls) console.log(`   ⚠️ 需人工 ${s}｜${u}`);
console.log(`本次要改 ${byTitle.size} 個單元、${todo.length} 個區塊、${nChange} 處網址｜跳過 ${nSkip} 處`);
console.log(`ℹ️ 沒帶網域的路徑說明文字「${BARE}」${bare} 處（當時的紀錄，不改）`);

console.log("\n===F45-MAP-BEGIN===");
for (const t of todo) for (const u of t.urls) console.log(JSON.stringify({ 單元: t.title, 改前: u, 改後: u.replace(FROM, TO) }));
console.log("===F45-MAP-END===");

// 不用 process.exit：輸出還在管線裡就結束會掉行
if (!EXECUTE) console.log("\n🔍 DRY-RUN：未寫入。確認後改 MODE=execute。");
else if (readFail) { console.log("\n❌ 有頁面讀取失敗，整批不寫。"); process.exitCode = 1; }
else if (!todo.length) console.log("\n沒有要改的區塊。");
else {
  let done = 0;
  const fail = [];
  for (const t of todo) {
    const w = await call("PATCH", `/blocks/${t.id}`, t.body);
    if (!w.ok) { fail.push(`${t.title}｜HTTP ${w.status} ${w.json?.message ?? ""}`.slice(0, 200)); continue; }
    const back = JSON.stringify((await call("GET", `/blocks/${t.id}`)).json ?? {});
    const left = t.urls.filter((u) => back.includes(u));   // 改掉的那幾個不該還在
    if (left.length) fail.push(`${t.title}｜回讀仍有來源網址 ${left.length} 處`); else done++;
  }
  console.log(`\n✅ 寫入並回讀相符 ${done} 個區塊｜失敗 ${fail.length} 個`);
  for (const f of fail) console.log(`   ❌ ${f}`);
  process.exitCode = fail.length ? 1 : 0;
}
