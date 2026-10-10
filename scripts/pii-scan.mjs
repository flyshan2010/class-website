/**
 * 提交前個資掃描（零相依，Node 18+）——同步流程的最後一道關卡
 * 用法：NOTION_TOKEN=secret_xxx node scripts/pii-scan.mjs
 *
 * 放在 sync.yml「提交更新」前一步：從 Notion 名冊取姓名與查詢碼，掃這次要提交的文字檔
 * （data/ 與 docs/routine-manual.md 裡有變動或新增的檔）。命中＝整次同步失敗、不提交。
 * 放在這裡而不是 sync-notion.mjs 的 save()：校網公告、日曆、Drive 相簿、排程手冊備份四支不經過 save()。
 *
 * 比對規則與本機推送前關卡（Project/Claude/dotclaude/scripts/pii-gate.py）相同，改規則兩邊一起改：
 *   ・姓名（3 字以上）出現就算
 *   ・查詢碼前後緊鄰英數字或連字號的不算（否則雜湊、UUID、日期裡的片段會整批誤判）
 *   ・二進位檔（前 8000 位元組含 NUL，與 git 同一判法）只比對檔名
 *
 * Actions 紀錄是公開的：只印檔名、行號、座號，不印姓名與查詢碼。
 * 讀不到名冊、名冊內容不對＝無法確認＝一樣失敗（結束碼 2）；命中＝結束碼 1。
 */
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROSTER_DS = "ad232b7a-c7f8-4a68-b224-5b2d5b16599a"; // 👥 學生名冊（與 sync-notion.mjs 的 DS.roster 同一個）
const SCAN_PATHS = ["data/", "docs/routine-manual.md"];   // 與 sync.yml「提交更新」的 git add 範圍一致
const MIN_LEN = 3; // 短於這個長度的字串不拿來比對，避免大量誤判
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 名冊列 → 比對清單 [{ re, seat, kind }]。名冊內容不對就丟錯（訊息只帶座號）。 */
export function buildNeedles(rows) {
  const needles = [];
  let enrolled = 0;
  for (const r of rows) {
    const seat = String(r["座號"] ?? "").trim() || "？";
    const name = String(r["姓名"] ?? "").trim();
    const code = String(r["查詢碼"] ?? "").trim();
    if (r["在學"]) {
      enrolled++;
      if (!name) throw new Error(`名冊座號 ${seat} 沒有姓名，名冊格式可能變了`);
    }
    // 已轉出的學生也比對：姓名與舊查詢碼一樣不該公開
    if (name.length >= MIN_LEN) needles.push({ re: new RegExp(escapeRe(name)), seat, kind: "姓名" });
    if (code.length >= MIN_LEN) {
      if (!/^[0-9A-Za-z]+$/.test(code)) throw new Error(`名冊座號 ${seat} 的查詢碼不是純英數字，比對規則要重寫`);
      needles.push({ re: new RegExp(`(?<![0-9A-Za-z-])${code}(?![0-9A-Za-z-])`), seat, kind: "查詢碼" });
    }
  }
  if (!enrolled) throw new Error("名冊沒有任何在學學生，名冊格式可能變了");
  if (!needles.some(n => n.kind === "查詢碼")) throw new Error("名冊讀不到任何查詢碼，欄位名稱或型別可能變了");
  if (needles.length < enrolled) throw new Error(`在學 ${enrolled} 人但只取得 ${needles.length} 個比對字串，名冊格式可能變了`);
  return needles;
}

/** 與 git 相同的判法：前 8000 位元組含 NUL 就當二進位檔。 */
export function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

/** 掃一段文字，回傳 [{ line, seat, kind }]（同一行同一項只報一次）。 */
export function scanText(text, needles) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    for (const n of needles) if (n.re.test(line)) hits.push({ line: i + 1, seat: n.seat, kind: n.kind });
  });
  return hits;
}

/** 掃一個檔（路徑＋內容），回傳可直接印出的命中說明；不含姓名與查詢碼。 */
export function scanFile(file, buf, needles) {
  const out = [];
  for (const n of needles) if (n.re.test(file)) out.push(`檔名含座號 ${n.seat} 的${n.kind}`);
  if (!isBinary(buf)) {
    for (const h of scanText(buf.toString("utf8"), needles)) out.push(`${file}:${h.line}：座號 ${h.seat} 的${h.kind}`);
  }
  return out;
}

async function fetchRoster(token) {
  const rows = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${ROSTER_DS}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
      body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
    });
    if (!res.ok) throw new Error(`Notion API ${res.status}`); // 回應內文可能帶名冊內容，不印
    const json = await res.json();
    rows.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  const val = p => {
    switch (p?.type) {
      case "title": return p.title.map(t => t.plain_text).join("");
      case "rich_text": return p.rich_text.map(t => t.plain_text).join("");
      case "checkbox": return p.checkbox;
      case "number": return p.number ?? "";
      default: return "";
    }
  };
  return rows.map(pg => Object.fromEntries(Object.entries(pg.properties).map(([k, v]) => [k, val(v)])));
}

/** 這次要提交的檔：有變動的追蹤檔＋新增的未追蹤檔。 */
function changedFiles() {
  const out = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "-z", "--modified", "--others", "--exclude-standard", "--", ...SCAN_PATHS],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.toString("utf8").split("\0").filter(Boolean))];
}

/** 掃這次要提交的每個檔，回傳 { scanned, binary, hits }。 */
export async function scanChanged(needles) {
  const hits = [];
  let scanned = 0, binary = 0;
  for (const f of changedFiles()) {
    let buf;
    try { buf = await readFile(path.join(ROOT, f)); } catch { continue; } // 這次被刪掉的檔，沒有內容可掃
    scanned++;
    if (isBinary(buf)) binary++;
    hits.push(...scanFile(f, buf, needles));
  }
  return { scanned, binary, hits };
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  let needles;
  try {
    if (!token) throw new Error("缺少 NOTION_TOKEN 環境變數");
    needles = buildNeedles(await fetchRoster(token));
  } catch (e) {
    console.error(`⛔ pii-scan：讀不到名冊（${e.message}），無法確認有沒有個資，這次不提交。`);
    process.exit(2);
  }
  const { scanned, binary, hits } = await scanChanged(needles);
  if (hits.length) {
    console.error(`⛔ pii-scan：${hits.length} 處命中，這次不提交（掃了 ${scanned} 個檔）：`);
    for (const h of hits.slice(0, 50)) console.error(`  - ${h}`);
    if (hits.length > 50) console.error(`  …另有 ${hits.length - 50} 處`);
    process.exit(1);
  }
  console.log(`✅ pii-scan：0 命中（掃了 ${scanned} 個檔，其中 ${binary} 個二進位檔只比對檔名；${needles.length} 個比對字串）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
