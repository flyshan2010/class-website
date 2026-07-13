/**
 * 名冊 → 名冊對照表.json 同步檢查（零相依，Node 18+）
 *
 * 為什麼需要：skills 撈全班一律先讀 `班級事務/名冊對照表.json`（notion-search 語意搜尋會漏人）。
 * 名冊在 Notion 異動（轉學/改職務/改查詢碼/改週薪）後若沒更新此檔，報告與週結就會用到舊資料。
 * 本腳本直接從 Notion 名冊重建對照表，並印出與現檔的差異。
 *
 * 用法：
 *   NOTION_TOKEN=secret_xxx node scripts/sync-roster-map.mjs         # 檢查並寫入更新
 *   NOTION_TOKEN=secret_xxx node scripts/sync-roster-map.mjs --dry   # 只檢查、不寫入
 */
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("缺少 NOTION_TOKEN 環境變數"); process.exit(1); }
const DRY = process.argv.includes("--dry");

const ROSTER_DS = "ad232b7a-c7f8-4a68-b224-5b2d5b16599a";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_PATH = path.join(ROOT, "..", "名冊對照表.json"); // 班級事務/名冊對照表.json

async function queryDataSource(dsId) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${dsId}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
      body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
    });
    if (!res.ok) throw new Error(`Notion API ${res.status}：${await res.text()}`);
    const json = await res.json();
    results.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return results;
}

function val(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title": return prop.title.map(t => t.plain_text).join("");
    case "rich_text": return prop.rich_text.map(t => t.plain_text).join("");
    case "checkbox": return prop.checkbox;
    case "select": return prop.select?.name ?? "";
    case "number": return prop.number ?? "";
    default: return "";
  }
}
const props = page => {
  const out = { _id: page.id };
  for (const [k, v] of Object.entries(page.properties)) out[k] = val(v);
  return out;
};
const pageUrl = id => `https://app.notion.com/p/${String(id).replace(/-/g, "")}`;

// ── 從 Notion 名冊建對照表（只收 在學＝true 且有座號者）──
const rows = (await queryDataSource(ROSTER_DS)).map(props)
  .filter(r => r["在學"] && r["座號"] !== "" && r["座號"] != null);

const students = {};
for (const r of rows.sort((a, b) => Number(a["座號"]) - Number(b["座號"]))) {
  students[String(Number(r["座號"]))] = {
    姓名: String(r["姓名"] || "").trim(),
    頁面URL: pageUrl(r._id),
    查詢碼: String(r["查詢碼"] ?? "").trim(),
    職務: String(r["職務"] || "").trim(),
    週薪: Number(r["週薪"]) || 0,
  };
}

// ── 與現檔比對 ──
let old = { 學生: {} };
try { old = JSON.parse(await readFile(MAP_PATH, "utf8")); } catch { console.warn("（找不到現有對照表，將建立新檔）"); }
const oldStu = old.學生 || {};
const FIELDS = ["姓名", "頁面URL", "查詢碼", "職務", "週薪"];
const added = [], removed = [], changed = [];

for (const seat of Object.keys(students)) {
  if (!oldStu[seat]) { added.push(seat); continue; }
  const diffs = FIELDS.filter(f => String(oldStu[seat][f] ?? "") !== String(students[seat][f] ?? ""));
  if (diffs.length) changed.push({ seat, diffs, from: oldStu[seat], to: students[seat] });
}
for (const seat of Object.keys(oldStu)) if (!students[seat]) removed.push(seat);

// ── 報告 ──
console.log(`\n📇 名冊對照表同步檢查：Notion 名冊 ${Object.keys(students).length} 人 vs 現檔 ${Object.keys(oldStu).length} 人\n`);
if (added.length) console.log(`➕ 新增座號：${added.join("、")}`);
if (removed.length) console.log(`➖ 現檔多出（Notion 已無/非在學）：${removed.join("、")}　← 請確認是否轉學`);
for (const c of changed) console.log(`✏️  座號 ${c.seat} 變更：${c.diffs.map(f => `${f} 「${c.from[f] ?? ""}」→「${c.to[f]}」`).join("；")}`);
if (!added.length && !removed.length && !changed.length) console.log("✅ 完全一致，無需更新。");

// ── 寫入 ──
if (DRY) { console.log("\n(--dry：僅檢查，未寫入)"); process.exit(0); }
if (added.length || removed.length || changed.length) {
  const outObj = {
    _說明: old._說明 || "115學年四年四班・名冊對照表（座號→Notion頁面URL/查詢碼/職務/週薪）。skills 撈全班一律先讀本檔，notion-search 只當備援。",
    _名冊DS: ROSTER_DS,
    _更新時間: new Date().toISOString().slice(0, 10),
    學生: students,
  };
  await writeFile(MAP_PATH, JSON.stringify(outObj, null, 2) + "\n", "utf8");
  console.log(`\n✅ 已更新 名冊對照表.json（${Object.keys(students).length} 人）`);
}
