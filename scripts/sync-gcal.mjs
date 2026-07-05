/**
 * Google 日曆（公開 ICS）→ data/calendar.json（零相依，Node 18+）
 * 供首頁「近期行事」與行事曆頁「近期事件」列表使用；行事曆主畫面用 iframe 嵌入。
 * 若日曆尚未開啟「公開這個日曆」，ICS 會 404 → 輸出空陣列（網站其他功能不受影響）。
 * 事件類型依關鍵字自動判斷：考/評量→考試、假→放假、其他→活動。
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ICS_URL = "https://calendar.google.com/calendar/ical/classroom107689580550779751075%40group.calendar.google.com/public/basic.ics";
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

const typeOf = title =>
  /考|評量|測驗/.test(title) ? "考試" :
  /假|停課/.test(title) ? "放假" : "活動";

const isoFromIcs = v => {
  // 20260831 或 20260831T013000Z
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
};

let events = [];
try {
  const res = await fetch(ICS_URL);
  if (!res.ok) throw new Error(`ICS ${res.status}（日曆可能尚未設為公開）`);
  const ics = (await res.text()).replace(/\r\n[ \t]/g, ""); // 摺行展開
  for (const block of ics.split("BEGIN:VEVENT").slice(1)) {
    const get = key => (block.match(new RegExp(`^${key}[^:]*:(.*)$`, "m")) || [])[1]?.trim() || "";
    const title = get("SUMMARY").replace(/\\,/g, ",").replace(/\\n/g, " ");
    const start = isoFromIcs(get("DTSTART"));
    if (!title || !start) continue;
    let end = isoFromIcs(get("DTEND"));
    // 全天事件 DTEND 是「隔天」，顯示上要減一天
    if (end && /^DTEND;VALUE=DATE/m.test(block)) {
      const d = new Date(end + "T00:00:00");
      d.setDate(d.getDate() - 1);
      end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    events.push({
      title,
      date: start,
      endDate: end && end !== start ? end : "",
      type: typeOf(title),
      notes: get("DESCRIPTION").replace(/\\n/g, "\n").replace(/\\,/g, ",").slice(0, 200),
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`✅ calendar.json（${events.length} 筆，來自 Google 日曆）`);
} catch (e) {
  console.warn(`⚠️ Google 日曆 ICS 無法讀取：${e.message}；calendar.json 輸出空清單`);
}
await writeFile(path.join(DATA_DIR, "calendar.json"), JSON.stringify(events, null, 2) + "\n", "utf8");
