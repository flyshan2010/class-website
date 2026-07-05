/**
 * 一次性：把預排好的聯絡簿（192 天）與週報（42 週）填入範本內容。
 * 提醒事項自動參考行事曆：假日前一上課日提醒放假、開學日／休業式、週三五半天。
 * 只填「還是空白」的欄位，不會覆蓋老師已輸入的內容。
 * 用法：NOTION_TOKEN=ntn_xxx node scripts/fill-templates.mjs
 */
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("缺少 NOTION_TOKEN"); process.exit(1); }

const DS = {
  contactbook: "12825acc-e6b6-4273-afdf-a505f6b36ad3",
  weekly: "dcb8db22-0533-4ffc-8662-a9a9eef22eda",
};

const api = async (path, method, body) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { await new Promise(r => setTimeout(r, Number(res.headers.get("retry-after") || 2) * 1000)); continue; }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }
  throw new Error("重試多次仍失敗");
};

async function queryAll(dsId) {
  const results = [];
  let cursor;
  do {
    const json = await api(`/data_sources/${dsId}/query`, "POST", cursor ? { start_cursor: cursor } : {});
    results.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return results;
}

const text = prop => (prop?.rich_text || prop?.title || []).map(t => t.plain_text).join("");
const rt = s => ({ rich_text: [{ text: { content: s } }] });

const HOLIDAYS = {
  "2026-09-25": "中秋節", "2026-09-28": "教師節", "2026-10-09": "國慶日補假",
  "2026-10-26": "光復節補假", "2026-12-25": "行憲紀念日", "2027-01-01": "元旦",
  "2027-03-01": "和平紀念日補假", "2027-04-05": "清明節", "2027-04-06": "兒童節補假",
  "2027-04-30": "勞動節補假", "2027-06-09": "端午節",
};
const WD = "日一二三四五六";
const D = s => new Date(s + "T00:00:00");
const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
const fmt = isoStr => { const d = D(isoStr); return `${md(d)}（${WD[d.getDay()]}）`; };

// ── 聯絡簿 ──
async function fillContactbook() {
  const pages = await queryAll(DS.contactbook);
  // 上課日清單（依日期排序）供「假日前一上課日」計算
  const rows = pages
    .map(p => ({ id: p.id, date: p.properties["日期"]?.date?.start, hw: text(p.properties["作業"]), notes: text(p.properties["提醒事項"]) }))
    .filter(r => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 每個假日 → 它前一個上課日要提醒
  const holidayReminder = {};
  for (const [hd, name] of Object.entries(HOLIDAYS)) {
    const prev = [...rows].reverse().find(r => r.date < hd);
    if (prev) (holidayReminder[prev.date] ||= []).push(`${fmt(hd)}${name}放假`);
  }

  let updated = 0;
  for (const r of rows) {
    if (r.hw) continue; // 已有內容不覆蓋
    const dow = D(r.date).getDay();
    const notes = [];
    if (r.date === "2026-08-31") notes.push("今天是開學日！請繳交暑假作業與相關表件");
    if (r.date === "2027-02-11") notes.push("第二學期開學日！請繳交寒假作業");
    if (r.date === "2027-01-20") notes.push("今天休業式，明天起寒假開始");
    if (r.date === "2027-06-30") notes.push("今天休業式，明天起暑假開始");
    if (dow === 3 || dow === 5) notes.push("今日半天課，中午 12:00 放學");
    notes.push(...(holidayReminder[r.date] || []));
    const props = { "作業": rt("國語：\n數學：\n其他：") };
    if (notes.length && !r.notes) props["提醒事項"] = rt(notes.join("\n"));
    await api(`/pages/${r.id}`, "PATCH", { properties: props });
    if (++updated % 30 === 0) console.log(`  聯絡簿 …${updated}`);
  }
  console.log(`✅ 聯絡簿範本填入 ${updated} 筆`);
}

// ── 週報 ──
async function fillWeekly() {
  const pages = await queryAll(DS.weekly);
  let updated = 0;
  for (const p of pages) {
    if (p.properties["狀態"]?.select?.name !== "草稿") continue;
    if (text(p.properties["學習重點-國語"])) continue; // 已填不覆蓋
    const range = text(p.properties["日期區間"]); // 2026/08/31 ～ 2026/09/04
    const m = range.match(/(\d{4})\/(\d{2})\/(\d{2})\s*～\s*(\d{4})\/(\d{2})\/(\d{2})/);
    const reminders = [];
    if (m) {
      const end = D(`${m[4]}-${m[5]}-${m[6]}`);
      for (let i = 1; i <= 7; i++) {
        const d = new Date(end); d.setDate(d.getDate() + i);
        const isoStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (HOLIDAYS[isoStr]) reminders.push(`${fmt(isoStr)}${HOLIDAYS[isoStr]}放假`);
        if (isoStr === "2027-01-20") reminders.push("1/20（三）休業式，1/21 起寒假開始");
      }
    }
    await api(`/pages/${p.id}`, "PATCH", {
      properties: {
        "學習重點-國語": rt("第◯課"),
        "學習重點-數學": rt("第◯單元"),
        "學習重點-社會": rt("第◯單元"),
        "學習重點-其他": rt("自然／英語／藝文："),
        ...(reminders.length ? { "下週提醒": rt(reminders.join("\n")) } : {}),
      },
    });
    if (++updated % 10 === 0) console.log(`  週報 …${updated}`);
  }
  console.log(`✅ 週報範本填入 ${updated} 筆`);
}

await fillContactbook();
await fillWeekly();
console.log("🎉 範本填入完成");
