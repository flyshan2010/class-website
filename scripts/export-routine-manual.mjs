/**
 * 雲端排程手冊 Notion → docs/routine-manual.md 備份（零相依，Node 18+）
 * 用法：NOTION_TOKEN=secret_xxx node scripts/export-routine-manual.mjs
 *
 * 正本在 Notion「🤖 雲端排程手冊（排程 Agent 讀這頁）」（AI 系統藍圖 Δ10，老師 2026-09-25 裁定
 * 「Notion 為主、repo 備援」）。雲端 routine 讀不到 Notion 時改讀本檔在 GitHub 上的 raw 版。
 * 手冊內容只放在該頁的「程式碼框」裡（Notion 不會改動格式）；本腳本依序串接所有程式碼框，
 * 框與框之間空一行。最後一個框必須以 END-OF-MANUAL 結尾，否則視為不完整、不覆蓋舊備份。
 */
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error("缺少 NOTION_TOKEN 環境變數");
  process.exit(1);
}

const PAGE_ID = "3e9b1f9d7e4581d08ee5e2cc96ae525f";
const END_MARK = "END-OF-MANUAL";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "routine-manual.md");

async function listChildren(blockId) {
  const blocks = [];
  let cursor;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100";
    const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": "2025-09-03" },
    });
    if (!res.ok) throw new Error(`Notion API ${res.status}：${await res.text()}`);
    const json = await res.json();
    blocks.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

const blocks = await listChildren(PAGE_ID);
const parts = blocks
  .filter(b => b.type === "code")
  .map(b => b.code.rich_text.map(t => t.plain_text).join("").replace(/\s+$/, ""));

if (parts.length === 0) throw new Error("手冊頁找不到任何程式碼框，不覆蓋備份");
const text = parts.join("\n\n") + "\n";
if (!text.trimEnd().endsWith(END_MARK)) {
  throw new Error(`手冊最後一行不是 ${END_MARK}（可能被截斷或誤刪），不覆蓋備份`);
}

let old = "";
try { old = await readFile(OUT, "utf8"); } catch {}
if (old === text) {
  console.log(`雲端排程手冊沒有變化（${parts.length} 個程式碼框，${Buffer.byteLength(text)} bytes）`);
} else {
  await writeFile(OUT, text);
  console.log(`已更新 docs/routine-manual.md（${parts.length} 個程式碼框，${Buffer.byteLength(text)} bytes）`);
}
