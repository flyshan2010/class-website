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
 *   - **快取（2026-07-31 修）**：抓成功時把結果存成 data/school-news.json（隨 data/ 一起 commit）。
 *     崑山校網走 TANet，對 GitHub 機房 IP 時通時不通；抓失敗時改用快取併回，
 *     班網的學校公告**不會整批消失**（之前 sync-notion 已先把 announcements.json 覆寫成班級公告，
 *     這一步再失敗就等於清空——那正是 2026-07-31 首頁公告全空的原因）。
 *     抓失敗仍以非零碼退出讓 Actions 標紅（步驟設 continue-on-error，不影響其餘同步）。
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const CACHE = path.join(DATA, "school-news.json");

const cfg = JSON.parse(await readFile(path.join(DATA, "school-news-config.json"), "utf8"));
const SITE = cfg["來源網址"];

// ── 抓首頁 ──
// 崑山校網（TANet）對雲端機房 IP 不一定通，且偶爾很慢：逐一嘗試候選網址、
// 每次 25 秒逾時、失敗重試 3 輪。
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
  console.error("❌ 連不上崑山校網：");
  for (const e of [...new Set(errs)]) console.error(`   · ${e}`);
  return null;
}

const decode = (s) => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/\s+/g, " ").trim();

/** 解析「最新發布」表格；版型不符時回 null（呼叫端改用快取）。 */
function parseItems(html) {
  const table = html.match(/<table[^>]*id="news_tableall"[\s\S]*?<\/table>/i)?.[0];
  if (!table) {
    console.error("❌ 找不到 table#news_tableall —— 校網版型可能改了，請人工確認後修改本腳本");
    return null;
  }
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
    console.error("❌ 表格解析到 0 則 —— 校網版型可能改了");
    return null;
  }
  return items;
}

/** 過濾：天數 → 標題黑名單（硬規則）→ 處室黑名單（必收關鍵字可赦免）→ 則數上限 */
function pick(items) {
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
  return picked;
}

// ── 主流程：抓得到就更新快取，抓不到就用快取，最後一律併回 announcements.json ──
const html = await fetchHome();
const items = html ? parseItems(html) : null;
let picked = items ? pick(items) : null;
let failed = picked === null;

if (failed) {
  try {
    const cache = JSON.parse(await readFile(CACHE, "utf8"));
    picked = cache.items ?? [];
    console.error(`↩️  改用上次成功抓取的快取：${picked.length} 則（抓取時間 ${cache.fetchedAt ?? "未知"}）`);
  } catch {
    picked = [];
    console.error("↩️  也沒有快取可用，本次學校公告為 0 則");
  }
} else {
  await writeFile(CACHE, JSON.stringify(
    { fetchedAt: new Date().toISOString(), items: picked }, null, 2) + "\n", "utf8");
}

// ── 併回 announcements.json：先清掉上一輪的 auto 列，再寫入這一輪 ──
const file = path.join(DATA, "announcements.json");
const all = JSON.parse(await readFile(file, "utf8"));
const kept = all.filter((a) => a.auto !== "school");

// 校網公告沒有「下架日」可填，一律套與班級公告相同的預設有效天數；
// id 供首頁標題連到公告頁時定位用（校網沒有 Notion page id，用日期＋標題湊一個穩定值）。
const ANN_DEFAULT_DAYS = 30;
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const slugId = (date, title) => {
  let h = 0;
  for (const ch of `${date}|${title}`) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `s${date.replace(/-/g, "")}${h.toString(36)}`;
};

const merged = [
  ...kept,
  ...picked.map((it) => ({
    id: slugId(it.date, it.title),
    title: it.title,
    content: it.dept ? `發布單位：${it.dept}` : "",
    date: it.date,
    endDate: "",
    expiry: addDays(it.date, ANN_DEFAULT_DAYS),
    source: "學校",
    category: "公告",
    pinned: false,          // 校網置頂不沿用，避免長期壓過班級公告
    link: it.link,
    images: [],
    auto: "school",
  })),
].sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date));

await writeFile(file, JSON.stringify(merged, null, 2) + "\n", "utf8");
console.log(`✅ announcements.json：班級／手動 ${kept.length} 則 ＋ 校網 ${picked.length} 則${failed ? "（來自快取）" : ""}`);

// 抓取／解析失敗仍以非零碼退出，讓 Actions 標紅（步驟已設 continue-on-error）
if (failed) process.exit(html ? 1 : 2);
