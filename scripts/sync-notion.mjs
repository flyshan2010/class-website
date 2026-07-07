/**
 * Notion → data/*.json 同步腳本（零相依，Node 18+）
 * 用法：NOTION_TOKEN=secret_xxx node scripts/sync-notion.mjs
 * 圖片：Notion 的檔案連結會過期，因此同步時下載到 data/uploads/ 一併發布。
 */
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { webcrypto as crypto } from "node:crypto";

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error("缺少 NOTION_TOKEN 環境變數");
  process.exit(1);
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
await mkdir(UPLOAD_DIR, { recursive: true });

// 各資料庫的 data source ID（Notion「班級經營中心」底下）
const DS = {
  contactbook: "12825acc-e6b6-4273-afdf-a505f6b36ad3",
  announcements: "d113e3bb-23e5-4528-8125-cc6d9ec9834e", // 📣 公告（班級＋學校合併）
  weekly: "dcb8db22-0533-4ffc-8662-a9a9eef22eda",
  links: "3c3bf383-49b4-4492-9e65-f4d36ce62ef4",
  galleryIndex: "694e8649-0434-453f-8a55-43283a0ba102",
  schedule: "e648a412-b8ee-469d-98b8-a2ada9fd9513", // 🕐 日課表（一列＝一節課）
  settings: "166cce91-e6f1-456e-9275-097d71207b9b", // ⚙️ 網站設定與關於我們（項目/內容）
  reports: "10dbe7ca-291b-4501-a2b4-2ac30f53a7f1", // 📊 學生學習報告（一列＝一生一次評量）
  roster: "ad232b7a-c7f8-4a68-b224-5b2d5b16599a", // 👥 學生名冊
  bank: "1868a25d-f4e8-4952-9181-75bc2e349aa9", // 🏦 班級銀行帳本（一列＝一筆交易）
  store: "9e421ad0-0312-423d-b870-867b019b23d8", // 🏪 班級商店
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
    case "files": return prop.files.map(f => ({ name: f.name, url: f.file?.url || f.external?.url || "" }));
    case "relation": return prop.relation.map(r => r.id);
    default: return "";
  }
}

function props(page) {
  const out = { _id: page.id, _created: page.created_time };
  for (const [k, v] of Object.entries(page.properties)) out[k] = val(v);
  return out;
}

// 下載 Notion 圖片到 data/uploads/（Notion 檔案網址一小時就過期，必須落地）
async function saveImages(files, pageId) {
  const saved = [];
  let i = 0;
  for (const f of files || []) {
    if (!f.url) continue;
    const extMatch = (f.name || "").match(/\.(jpe?g|png|gif|webp|heic)$/i) ||
                     f.url.split("?")[0].match(/\.(jpe?g|png|gif|webp|heic)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
    // 取 ID 後 12 碼：同工作區頁面 ID 前段幾乎相同，取前段會讓不同頁面的圖互相覆蓋
    const filename = `${pageId.replace(/-/g, "").slice(-12)}-${i++}.${ext}`;
    try {
      const res = await fetch(f.url);
      if (!res.ok) { console.warn(`⚠️ 圖片下載失敗（${res.status}）：${f.name}`); continue; }
      await writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(await res.arrayBuffer()));
      saved.push(`data/uploads/${filename}`);
    } catch (e) {
      console.warn(`⚠️ 圖片下載失敗：${f.name}（${e.message}）`);
    }
  }
  return saved;
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

// ── 公告（班級＋學校合併，「來源」欄區分）──
async function syncAnnouncements() {
  const pages = (await queryDataSource(DS.announcements)).map(props)
    .filter(r => r["發布"] && r["日期"]?.start);
  const rows = [];
  for (const r of pages) {
    rows.push({
      title: r["標題"],
      content: r["內容"],
      date: r["日期"].start,
      source: r["來源"] || "班級",
      category: r["分類"] || "其他",
      pinned: !!r["置頂"],
      link: r["連結"],
      images: await saveImages(r["圖片"], r._id),
    });
  }
  rows.sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date));
  await save("announcements.json", rows);
}

// ── 週報 ──
async function syncWeekly() {
  const pages = (await queryDataSource(DS.weekly)).map(props)
    .filter(r => r["狀態"] === "已發布");
  const rows = [];
  for (const r of pages) {
    rows.push({
      week: r["週次"],
      range: r["日期區間"],
      learning: {
        chinese: r["學習重點-國語"] || r["學習重點"],
        math: r["學習重點-數學"],
        social: r["學習重點-社會"],
        other: r["學習重點-其他"],
      },
      activities: r["班級活動"],
      highlights: r["學生亮點"],
      reminders: r["下週提醒"],
      parents: r["家長配合事項"],
      webVersion: r["班網版"],
      images: await saveImages(r["圖片"], r._id),
      _range: r["日期區間"],
    });
  }
  // 依日期區間新→舊排序（格式 yyyy/mm/dd ～ yyyy/mm/dd 可直接字串比較）
  rows.sort((a, b) => String(b._range).localeCompare(String(a._range)));
  rows.forEach(r => delete r._range);
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
      note: r["備註"],
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

// ── 網站設定與關於我們（項目→內容 對照表；nav 與模組色維持在 repo）──
async function syncSettings() {
  const kv = {};
  for (const r of (await queryDataSource(DS.settings)).map(props)) {
    if (r["項目"] && String(r["內容"]).trim()) kv[r["項目"]] = String(r["內容"]).trim();
  }
  // site-config.json：只覆蓋文字欄位，nav/moduleColors/gcalEmbedUrl 由 repo 管
  const cfg = JSON.parse(await readFile(path.join(DATA_DIR, "site-config.json"), "utf8"));
  const map = {
    "校名": "schoolName", "班級": "className", "學年度": "schoolYear",
    "網站標題": "siteTitle", "導師稱呼": "teacherName", "班級口號": "motto",
    "一鍵更新網址": "updateProxyUrl",
  };
  for (const [k, field] of Object.entries(map)) if (kv[k]) cfg[field] = kv[k];
  await save("site-config.json", cfg);
  // about.json
  const about = JSON.parse(await readFile(path.join(DATA_DIR, "about.json"), "utf8"));
  if (kv["班級介紹"]) about.intro = kv["班級介紹"];
  if (kv["老師的話"]) about.teacherWords = kv["老師的話"];
  if (kv["班級公約"]) about.rules = kv["班級公約"];
  await save("about.json", about);
}

// ── 日課表（課程節次由 Notion 管理；固定時段與配色在下方常數）──
const SCHEDULE_META = {
  periods: [
    { name: "晨掃", time: "07:40-08:00" },
    { name: "早自修", time: "08:00-08:35" },
    { name: "第一節", time: "08:40-09:20" },
    { name: "第二節", time: "09:30-10:10" },
    { name: "第三節", time: "10:30-11:10" },
    { name: "第四節", time: "11:10-12:00" },
    { name: "午休", time: "12:30-13:30" },
    { name: "第五節", time: "13:40-14:20" },
    { name: "第六節", time: "14:30-15:10" },
    { name: "第七節", time: "15:20-16:00" },
  ],
  // 固定時段（非課程節次）；週三、週五半天，下午留空
  fixedRows: {
    "晨掃": ["晨掃", "晨掃", "晨掃", "晨掃", "晨掃"],
    "早自修": ["早自修", "早自修", "朝會", "早自修", "早自修"],
    "午休": ["午休", "午休", "", "午休", ""],
  },
  subjectColors: {
    "國語": "#FFF3E0", "數學": "#E3F2FD", "自然": "#E8F5E9", "社會": "#FFF8E1",
    "英語": "#F3E5F5", "英語(彈性)": "#F3E5F5", "體育": "#FFEBEE", "音樂": "#E0F7FA",
    "視覺藝術": "#FCE4EC", "玩美(彈性)": "#FCE4EC", "健康": "#F1F8E9",
    "資訊(彈性)": "#ECEFF1", "綜合": "#E8EAF6", "崑山活力Go(彈性)": "#FFEBEE", "本土語": "#FFF9C4",
    "午休": "#F5F5F5", "晨掃": "#F5F5F5", "早自修": "#FAFAF5", "朝會": "#FAFAF5",
  },
  notes: "週三、週五為半天課，中午 12:40 放學\n體育課與崑山活力Go請穿運動服與運動鞋",
};

async function syncSchedule() {
  const rows = (await queryDataSource(DS.schedule)).map(props).filter(r => r["顯示"]);
  const dayIdx = { "一": 0, "二": 1, "三": 2, "四": 3, "五": 4 };
  const cells = {}; // "第一節-0" → {subject, teacher, room}
  for (const r of rows) {
    const d = dayIdx[r["星期"]];
    if (d === undefined || !r["節次"]) continue;
    cells[`${r["節次"]}-${d}`] = { subject: r["科目"], teacher: r["教師"], room: r["教室"] };
  }
  const table = SCHEDULE_META.periods.map(p =>
    SCHEDULE_META.fixedRows[p.name] ||
    [0, 1, 2, 3, 4].map(d => cells[`${p.name}-${d}`] || ""));
  await save("schedule.json", {
    periods: SCHEDULE_META.periods,
    table,
    subjectColors: SCHEDULE_META.subjectColors,
    notes: SCHEDULE_META.notes,
  });
}

// ── 學生學習報告（隱私：用該生查詢碼 AES-GCM 加密後才發布；前台輸入座號＋查詢碼解密）──
const b64 = buf => Buffer.from(buf).toString("base64");

async function encryptReport(plainObj, code, seat) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(`${seat}:${code}`), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(plainObj)));
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

// 頭貼不落地成公開檔案，改抓成 base64 放進加密內容裡
async function avatarDataURL(files) {
  const f = (files || [])[0];
  if (!f?.url) return "";
  try {
    const res = await fetch(f.url);
    if (!res.ok) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 400 * 1024) { console.warn("⚠️ 頭貼超過 400KB，略過（請用小圖）"); return ""; }
    const ext = (f.url.split("?")[0].match(/\.(jpe?g|png|gif|webp)$/i) || [, "jpeg"])[1].toLowerCase().replace("jpg", "jpeg");
    return `data:image/${ext};base64,${buf.toString("base64")}`;
  } catch { return ""; }
}

async function syncReports() {
  const SUBJECTS = ["國語", "數學", "社會", "人際互動", "生活技能"];
  const rows = (await queryDataSource(DS.reports)).map(props)
    .filter(r => r["發布"] && r["座號"] !== "" && String(r["查詢碼"]).trim())
    .sort((a, b) => a._created.localeCompare(b._created)); // 週次依建立時間排序

  const bySeat = {};
  for (const r of rows) {
    const seat = Number(r["座號"]);
    const s = (bySeat[seat] ||= { seat, name: r["學生"], code: String(r["查詢碼"]).trim(), avatar: "", periods: [] });
    const av = await avatarDataURL(r["頭貼"]);
    if (av) s.avatar = av; // 用最新一列有頭貼者
    s.periods.push({
        period: r["期間"],
        radar: Object.fromEntries(SUBJECTS.map(s => [s, Number(r[`${s}分數`]) || 0])),
        grades: { "考試成績": r["考試成績"], "作業成績": r["作業成績"], "上課參與": r["上課參與"], "生活常規": r["生活常規"] },
        subjects: SUBJECTS.map(s => ({ name: s, state: r[`${s}狀態`], advice: r[`${s}建議`] })),
        highlights: r["學生亮點"],
        shortGoal: r["短期目標"],
        longGoal: r["長期目標"],
        parentTips: r["家長協助建議"],
      });
  }

  const dir = path.join(DATA_DIR, "reports");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const s of Object.values(bySeat)) {
    const payload = await encryptReport({ name: s.name, seat: s.seat, avatar: s.avatar, periods: s.periods }, s.code, s.seat);
    await writeFile(path.join(dir, `${s.seat}.json`), JSON.stringify(payload) + "\n", "utf8");
  }
  // 只公開「哪些座號有報告」，不含任何個資
  await writeFile(path.join(dir, "index.json"),
    JSON.stringify(Object.keys(bySeat).map(Number).sort((a, b) => a - b)) + "\n", "utf8");
  console.log(`✅ reports/（${Object.keys(bySeat).length} 位學生，已加密）`);
}

// ── 班級商店（公開櫥窗，無個資）──
async function syncStore() {
  const rows = (await queryDataSource(DS.store)).map(props)
    .filter(r => r["上架"] && r["品項"])
    .map(r => ({
      name: r["品項"],
      category: r["分類"] || "小物",
      price: Number(r["價格"]) || 0,
      stock: Number(r["庫存"]) || 0,
      icon: r["圖示"] || "🎁",
      note: r["說明"],
    }))
    .sort((a, b) => a.category.localeCompare(b.category, "zh-Hant") || a.price - b.price);
  await save("store.json", rows);
}

// ── 班級銀行（隱私：同學習報告，用座號＋查詢碼派生金鑰 AES-GCM 加密）──
async function syncBank() {
  const roster = (await queryDataSource(DS.roster)).map(props)
    .filter(r => r["在學"] && r["座號"] !== "" && String(r["查詢碼"]).trim());
  const txRows = (await queryDataSource(DS.bank)).map(props)
    .filter(r => r["學生"]?.length && r["金額"] !== "")
    .sort((a, b) => String(a["日期"]?.start || "").localeCompare(String(b["日期"]?.start || "")) ||
                    a._created.localeCompare(b._created));

  const byPageId = Object.fromEntries(roster.map(r => [r._id, r]));
  const accounts = {}; // seat → {name, seat, code, balance, tx[]}
  for (const t of txRows) {
    const stu = byPageId[t["學生"][0]];
    if (!stu) continue;
    const seat = Number(stu["座號"]);
    const acc = (accounts[seat] ||= {
      seat, name: stu["姓名"], code: String(stu["查詢碼"]).trim(), balance: 0, tx: [],
    });
    const amount = Math.round(Number(t["金額"]) || 0);
    acc.balance += amount;
    acc.tx.push({
      date: t["日期"]?.start || "",
      week: t["週次"],
      type: t["類型"] || "調整",
      reason: t["事由"],
      amount,
      after: acc.balance,
    });
  }

  const dir = path.join(DATA_DIR, "bank");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const acc of Object.values(accounts)) {
    acc.tx.reverse(); // 存摺新→舊
    const payload = await encryptReport(
      { name: acc.name, seat: acc.seat, balance: acc.balance, tx: acc.tx }, acc.code, acc.seat);
    await writeFile(path.join(dir, `${acc.seat}.json`), JSON.stringify(payload) + "\n", "utf8");
  }
  // 只公開「哪些座號有帳戶」，不含任何個資
  await writeFile(path.join(dir, "index.json"),
    JSON.stringify(Object.keys(accounts).map(Number).sort((a, b) => a - b)) + "\n", "utf8");
  console.log(`✅ bank/（${Object.keys(accounts).length} 位學生，已加密）`);
}

await Promise.all([
  syncContactbook(),
  syncAnnouncements(),
  syncWeekly(),
  syncLinks(),
  syncGalleryIndex(),
  syncSchedule(),
  syncSettings(),
  syncReports(),
  syncStore(),
  syncBank(),
]);
console.log("🎉 Notion 同步完成");
