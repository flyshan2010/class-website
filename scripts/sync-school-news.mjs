/**
 * 校網（臺南市崑山國小）公告 → data/announcements.json 的「學校公告」分頁
 *
 * 用法：node scripts/sync-school-news.mjs（無需任何金鑰；在 sync-notion.mjs 之後跑）
 *
 * 設計：
 *   - 只抓首頁「崑山公告 → 最新發布」那張表（table#news_tableall），它已是各處室合併清單。
 *   - 過濾規則全部外置在 data/school-news-config.json，老師要放寬收緊不必動程式。
 *   - 匯入的列標記 auto:"school"；每次重跑先清掉舊的 auto 列再寫新的，不會越積越多，
 *     也絕不動 Notion 同步下來的班級公告。
 *   - 校網掛掉／改版導致抓不到時：保留班網現有內容並以非零退出，讓 Actions 標紅（不靜默留白）。
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

const cfg = JSON.parse(await readFile(path.join(DATA, "school-news-config.json"), "utf8"));
const SITE = cfg["來源網址"];

// ── 抓首頁 ──
// 崑山校網（TANet）對雲端機房 IP 不一定通，且偶爾很慢：逐一嘗試候選網址、
// 每次 25 秒逾時、失敗重試 3 輪。全部失敗＝保留班網現有學校公告後退出。
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CANDIDATES = [SITE, SITE.replace("https://", "http://")];

async function fetchHome() {
  const errs = [];
  for (let round = 1; round <= 3; round++) {
    for (const url of CANDIDATES) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9" },
          redirect: "follow",
          signal: AbortSignal.timeout(25_000),
        });
        if (!res.ok) { errs.push(`${url} → HTTP ${res.status}`); continue; }
        console.log(`🌐 取得校網首頁：${url}（第 ${round} 輪）`);
        return res.text();
      } catch (e) {
        errs.push(`${url} → ${e.cause?.code ?? e.name ?? e.message}`);
      }
    }
    if (round < 3) await new Promise((r) => setTimeout(r, 3000 * round));
  }
  console.error("❌ 連不上崑山校網，本次不更新學校公告（班網現有內容保留）：");
  for (const e of [...new Set(errs)]) console.error(`   · ${e}`);
  process.exit(2); // 2＝網路問題，與 1（版型解析失敗）區分
}

const html = await fetchHome();

// ── 取出「最新發布」那張表 ──
const table = html.match(/<table[^>]*id="news_tableall"[\s\S]*?<\/table>/i)?.[0];
if (!table) {
  console.error("❌ 找不到 table#news_tableall —— 校網版型可能改了，請人工確認後修改本腳本");
  process.exit(1);
}

const decode = (s) => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/\s+/g, " ").trim();

// ── 逐列解析 ──
const items = [];
for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
  const date = row.match(/<time datetime="(\d{4}-\d{2}-\d{2})"/)?.[1];
  // 標題＝指向單篇公告（帶 content_id）的那個連結；分類標籤連結是 ?tag=xxx，不會誤中
  const a = row.match(/<a href="([^"]*content_id=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
  const dept = row.match(/title="點此觀看(.+?)完整公告"/)?.[1]?.trim() ?? "";
  if (!date || !a) continue;
  const title = decode(a[2].replace(/<[^>]+>/g, "")).replace(/\*\*/g, "");
  if (!title) continue;
  items.push({ date, title, link: decode(a[1]), dept });
}
console.log(`📰 校網「最新發布」共解析出 ${items.length} 則`);
if (!items.length) {
  console.error("❌ 表格解析到 0 則 —— 校網版型可能改了，本次不更新學校公告");
  process.exit(1);
}

// ── 過濾：處室黑名單 → 標題黑名單（有必收關鍵字可赦免）→ 天數 → 則數 ──
const cutoff = new Date(Date.now() - cfg["只收幾天內"] * 864e5).toISOString().slice(0, 10);
const hit = (text, words) => words.some((w) => text.includes(w));
const dropped = [];

const picked = items
  .filter((it) => {
    if (it.date < cutoff) return dropped.push(`${it.date} 超過 ${cfg["只收幾天內"]} 天`) && false;
    // 排除關鍵字是硬規則；必收關鍵字只赦免「排除處室」，避免研習／甄選類公告
    // 因為標題出現「學生」「家長」就整批放行。
    if (hit(it.title, cfg["排除關鍵字"])) return dropped.push(`${it.date} 標題含排除關鍵字`) && false;
    if (hit(it.dept, cfg["排除處室"]) && !hit(it.title, cfg["必收關鍵字"])) {
      return dropped.push(`${it.date} 處室：${it.dept}`) && false;
    }
    return true;
  })
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, cfg["最多幾則"]);

console.log(`   → 過濾後保留 ${picked.length} 則、濾掉 ${dropped.length} 則`);
for (const d of dropped) console.log(`     · 略過 ${d}`);
if (items.length - dropped.length > picked.length) {
  console.log(`   ⚠️ 另有 ${items.length - dropped.length - picked.length} 則符合規則但超過「最多幾則」上限，未上站`);
}

// ── 併回 announcements.json：先清掉上一輪的 auto 列，再寫入這一輪 ──
const file = path.join(DATA, "announcements.json");
const all = JSON.parse(await readFile(file, "utf8"));
const kept = all.filter((a) => a.auto !== "school");

const merged = [
  ...kept,
  ...picked.map((it) => ({
    title: it.title,
    content: it.dept ? `發布單位：${it.dept}` : "",
    date: it.date,
    source: "學校",
    category: "公告",
    pinned: false,          // 校網置頂不沿用，避免長期壓過班級公告
    link: it.link,
    images: [],
    auto: "school",
  })),
].sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date));

await writeFile(file, JSON.stringify(merged, null, 2) + "\n", "utf8");
console.log(`✅ announcements.json：班級／手動 ${kept.length} 則 ＋ 校網自動 ${picked.length} 則`);
