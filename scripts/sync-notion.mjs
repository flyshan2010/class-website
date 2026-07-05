/**
 * Notion → data/*.json 同步腳本（零相依，Node 18+）
 * 用法：NOTION_TOKEN=secret_xxx node scripts/sync-notion.mjs
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error("缺少 NOTION_TOKEN 環境變數");
  process.exit(1);
}

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

// 各資料庫的 data source ID（Notion「班級經營中心」底下）
const DS = {
  contactbook: "12825acc-e6b6-4273-afdf-a505f6b36ad3",
  announcements: "d113e3bb-23e5-4528-8125-cc6d9ec9834e",
  schoolAnnouncements: "255535c6-f611-4f9c-a653-fa129574d8c0",
  calendar: "62736a3e-1a7d-4f99-8702-be41bdac0543",
  weekly: "dcb8db22-0533-4ffc-8662-a9a9eef22eda",
  links: "3c3bf383-49b4-4492-9e65-f4d36ce62ef4",
  galleryIndex: "694e8649-0434-453f-8a55-43283a0ba102",
};

async function queryDataSource(dsId) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${dsId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
    });
    if (!res.ok) throw new Error(`Notion API ${res.status}：${await res.text()}`);
    const json = await res.json();
    results.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return results;
}

// 把 Notion property 轉為單純值
function val(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title": return prop.title.map(t => t.plain_text).join("");
    case "rich_text": return prop.rich_text.map(t => t.plain_text).join("");
    case "date": return prop.date; // {start, end} 或 null
    case "checkbox": return prop.checkbox;
    case "select": return prop.select?.name ?? "";
    case "url": return prop.url ?? "";
    case "number": return prop.number ?? "";
    default: return "";
  }
}

function props(page) {
  const out = {};
  for (const [k, v] of Object.entries(page.properties)) out[k] = val(v);
  return out;
}

async function save(name, data) {
  await writeFile(path.join(DATA_DIR, name), JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`✅ ${name}（${Array.isArray(data) ? data.length : 1} 筆）`);
}

// ── 聯絡簿 ──
async function syncContactbook() {
  const rows = (await queryDataSource(DS.contactbook)).map(props)
    .filter(r => r["發布"] && r["日期"]?.start)
    .map(r => ({
      date: r["日期"].start,
      homework: r["作業"],
      bring: r["攜帶物品"],
      notes: r["提醒事項"],
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  await save("contactbook.json", rows);
}

// ── 公告（班級/學校共用）──
async function syncAnnouncements(dsId, file) {
  const rows = (await queryDataSource(dsId)).map(props)
    .filter(r => r["發布"] && r["日期"]?.start)
    .map(r => ({
      title: r["標題"],
      content: r["內容"],
      date: r["日期"].start,
      category: r["分類"] || "其他",
      pinned: !!r["置頂"],
      link: r["連結"],
    }))
    .sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date));
  await save(file, rows);
}

// ── 行事曆 ──
async function syncCalendar() {
  const rows = (await queryDataSource(DS.calendar)).map(props)
    .filter(r => r["日期"]?.start)
    .map(r => ({
      title: r["事件"],
      date: r["日期"].start,
      endDate: r["日期"].end || "",
      type: r["類型"] || "其他",
      notes: r["備註"],
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  await save("calendar.json", rows);
}

// ── 週報 ──
async function syncWeekly() {
  const rows = (await queryDataSource(DS.weekly)).map(p => ({ ...props(p), _created: p.created_time }))
    .filter(r => r["狀態"] === "已發布")
    .map(r => ({
      week: r["週次"],
      range: r["日期區間"],
      learning: r["學習重點"],
      activities: r["班級活動"],
      highlights: r["學生亮點"],
      reminders: r["下週提醒"],
      parents: r["家長配合事項"],
      webVersion: r["班網版"],
      _created: r._created,
    }))
    .sort((a, b) => b._created.localeCompare(a._created));
  rows.forEach(r => delete r._created);
  await save("weekly.json", rows);
}

// ── 常用網站 ──
async function syncLinks() {
  const rows = (await queryDataSource(DS.links)).map(props)
    .filter(r => r["網址"])
    .map(r => ({
      name: r["名稱"],
      url: r["網址"],
      category: r["分類"] || "其他",
      icon: r["圖示"] || "🌐",
    }));
  await save("links.json", rows);
}

// ── 相簿索引（照片清單由 sync-drive.mjs 補上）──
async function syncGalleryIndex() {
  const rows = (await queryDataSource(DS.galleryIndex)).map(props)
    .filter(r => r["顯示"] && r["日期"]?.start)
    .map(r => ({
      title: r["活動名稱"],
      date: r["日期"].start,
      folderUrl: r["Drive資料夾"],
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  await save("gallery-index.json", rows);
}

await Promise.all([
  syncContactbook(),
  syncAnnouncements(DS.announcements, "announcements.json"),
  syncAnnouncements(DS.schoolAnnouncements, "school-announcements.json"),
  syncCalendar(),
  syncWeekly(),
  syncLinks(),
  syncGalleryIndex(),
]);
console.log("🎉 Notion 同步完成");
