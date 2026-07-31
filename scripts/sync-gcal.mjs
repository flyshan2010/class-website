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

const pad = n => String(n).padStart(2, "0");

/**
 * 解析 ICS 的日期時間 → { date: "YYYY-MM-DD", time: "HH:MM"（全天事件為空） }
 *
 * ⚠️ 2026-07-31 修：Google 匯出的 ICS 定時事件是 **UTC**（結尾 Z），
 * 直接截前 8 碼會少一天——「返校日 8/7 07:40」的 DTSTART 是 20260806T234000Z，
 * 舊寫法就變成 8/6，班網於是顯示「8/6（四）～8/7（五）」和 Google 日曆對不起來。
 * 這裡一律換算成台北時間（+8）再取日期；帶 TZID 的（本地時間）不平移。
 */
const parseIcs = v => {
  const m = String(v).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (!hh) return { date: `${y}-${mo}-${d}`, time: "" };
  const t = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)) + (z ? 8 * 3600e3 : 0));
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
  };
};

let events = [];
try {
  const res = await fetch(ICS_URL);
  if (!res.ok) throw new Error(`ICS ${res.status}（日曆可能尚未設為公開）`);
  const ics = (await res.text()).replace(/\r\n[ \t]/g, ""); // 摺行展開
  for (const block of ics.split("BEGIN:VEVENT").slice(1)) {
    const get = key => (block.match(new RegExp(`^${key}[^:]*:(.*)$`, "m")) || [])[1]?.trim() || "";
    const title = get("SUMMARY").replace(/\\,/g, ",").replace(/\\n/g, " ");
    const s = parseIcs(get("DTSTART"));
    if (!title || !s) continue;
    const e = parseIcs(get("DTEND"));
    let end = e?.date ?? "";
    // 全天事件 DTEND 是「隔天」，顯示上要減一天
    if (end && /^DTEND;VALUE=DATE/m.test(block)) {
      const d = new Date(end + "T00:00:00");
      d.setDate(d.getDate() - 1);
      end = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    events.push({
      title,
      date: s.date,
      endDate: end && end !== s.date ? end : "",
      startTime: s.time,                                 // 空＝全天事件
      endTime: e && e.date === s.date ? e.time : "",     // 只在同一天結束時標結束時刻
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
