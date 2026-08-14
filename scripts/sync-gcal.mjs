/**
 * Google 日曆（公開 ICS）→ data/calendar.json（零相依，Node 18+）
 * 供首頁「近期行事」與行事曆頁「近期事件」列表使用；行事曆主畫面用 iframe 嵌入。
 * 若日曆尚未開啟「公開這個日曆」，ICS 會 404 → 輸出空陣列（網站其他功能不受影響）。
 * 事件類型依關鍵字自動判斷：考/評量→考試、假→放假、其他→活動。
 *
 * ⚠️ Google 端有自己的 ICS 快取（數小時）。在 Google 日曆改完內容後，
 *    這支腳本可能還讀到舊版；班網沒有立刻更新不一定是 bug，隔一輪同步再看。
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ICS_URL = "https://calendar.google.com/calendar/ical/classroom107689580550779751075%40group.calendar.google.com/public/basic.ics";
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

// 重複事件的展開視窗：往前 6 個月（本學期已過的仍查得到）、往後 18 個月（跨到下學年）。
const WINDOW_BACK_MONTHS = 6;
const WINDOW_FWD_MONTHS = 18;

// notes 上限。舊版 200 字會把句子攔腰切斷（含把 HTML 標籤切成半個），
// 放寬到 600 字，前端再做「展開全文」摺疊。
const NOTES_MAX = 600;

const typeOf = title =>
  /考|評量|測驗/.test(title) ? "考試" :
  /假|停課/.test(title) ? "放假" : "活動";

const pad = n => String(n).padStart(2, "0");

/**
 * Google 日曆的「說明」欄是 rich text，匯出到 ICS 就是一段 HTML。
 * 2026-08-14 修：舊版只反轉義 \n 與 \,，標籤原文（<p>…</p>）就這樣被印到班網上
 * （8/28 返校日那筆）。這裡把它還原成純文字換行。
 */
const stripHtml = s => s
  .replace(/<\s*br\s*\/?\s*>/gi, "\n")
  .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
  .replace(/<\s*li[^>]*>/gi, "・")
  .replace(/<[^>]*>/g, "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
  .replace(/&amp;/gi, "&")            // & 一定最後解，否則 &amp;lt; 會被解兩次
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const unescapeIcs = s => String(s)
  .replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

/**
 * 解析 ICS 的日期時間 → { y, m, d, hh, mi, allDay }（一律換算成台北時間）
 *
 * ⚠️ 2026-07-31 修：Google 匯出的 ICS 定時事件是 **UTC**（結尾 Z），
 * 直接截前 8 碼會少一天——「返校日 8/7 07:40」的 DTSTART 是 20260806T234000Z，
 * 舊寫法就變成 8/6。這裡一律換算成台北時間（+8）再取日期；帶 TZID 的（本地時間）不平移。
 */
const parseIcs = v => {
  const m = String(v).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (!hh) return { y: +y, m: +mo, d: +d, hh: null, mi: null, allDay: true };
  const t = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)) + (z ? 8 * 3600e3 : 0));
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    hh: t.getUTCHours(), mi: t.getUTCMinutes(), allDay: false,
  };
};

const isoOf = p => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
const timeOf = p => p.allDay ? "" : `${pad(p.hh)}:${pad(p.mi)}`;
/** 重複事件的比對鍵：EXDATE／RECURRENCE-ID 都用「日期＋時刻」對回原始實例 */
const keyOf = p => `${isoOf(p)}T${timeOf(p)}`;
const toUTCms = p => Date.UTC(p.y, p.m - 1, p.d, p.hh ?? 0, p.mi ?? 0);
const fromUTCms = (ms, allDay) => {
  const t = new Date(ms);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    hh: allDay ? null : t.getUTCHours(), mi: allDay ? null : t.getUTCMinutes(), allDay,
  };
};

/** RRULE 字串 → { freq, interval, count, until(ms) } */
const parseRrule = s => {
  if (!s) return null;
  const kv = Object.fromEntries(s.split(";").map(p => p.split("=")).filter(p => p.length === 2));
  if (!kv.FREQ) return null;
  const until = kv.UNTIL ? parseIcs(kv.UNTIL) : null;
  return {
    freq: kv.FREQ.toUpperCase(),
    interval: Math.max(1, parseInt(kv.INTERVAL || "1", 10) || 1),
    count: kv.COUNT ? parseInt(kv.COUNT, 10) : null,
    until: until ? toUTCms(until) : null,
  };
};

/**
 * 依 RRULE 展開出視窗內的所有實例起始時間。
 * 只支援 Google 日曆在班級行事曆實際會用到的 DAILY／WEEKLY／MONTHLY／YEARLY
 * ＋ INTERVAL／COUNT／UNTIL；BYDAY 等進階規則不展開（維持只取首次，寧可少不可錯）。
 */
const expandRrule = (start, rule, winStart, winEnd) => {
  const out = [];
  if (!rule) return [start];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.freq)) return [start];
  let cur = { ...start };
  for (let i = 0; i < 2000; i++) {
    const ms = toUTCms(cur);
    if (rule.until && ms > rule.until) break;
    if (rule.count && i >= rule.count) break;
    if (ms > winEnd) break;
    if (ms >= winStart) out.push({ ...cur });
    // 下一次
    if (rule.freq === "YEARLY") cur = { ...cur, y: cur.y + rule.interval };
    else if (rule.freq === "MONTHLY") {
      const t = cur.m - 1 + rule.interval;
      cur = { ...cur, y: cur.y + Math.floor(t / 12), m: (t % 12) + 1 };
    } else {
      const step = (rule.freq === "WEEKLY" ? 7 : 1) * rule.interval;
      cur = fromUTCms(toUTCms(cur) + step * 864e5, cur.allDay);
    }
  }
  return out;
};

let events = [];
try {
  const res = await fetch(ICS_URL);
  if (!res.ok) throw new Error(`ICS ${res.status}（日曆可能尚未設為公開）`);
  const ics = (await res.text()).replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, ""); // 摺行展開

  const now = new Date();
  const winStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - WINDOW_BACK_MONTHS, 1);
  const winEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + WINDOW_FWD_MONTHS, 1);

  const masters = [];
  const overrides = new Map();   // `${uid}|${keyOf(recurrenceId)}` → 事件原始資料
  const cancelled = new Set();   // 同上的 key；被取消的單次實例

  for (const block of ics.split("BEGIN:VEVENT").slice(1)) {
    const get = key => (block.match(new RegExp(`^${key}([^:\\n]*):(.*)$`, "m")) || [])[2]?.trim() || "";
    const param = key => (block.match(new RegExp(`^${key}([^:\\n]*):`, "m")) || [])[1] || "";

    const title = unescapeIcs(get("SUMMARY")).replace(/\n/g, " ").trim();
    const s = parseIcs(get("DTSTART"));
    if (!title || !s) continue;

    const uid = get("UID") || `${title}|${keyOf(s)}`;
    const e = parseIcs(get("DTEND"));
    const allDay = /VALUE=DATE\b/.test(param("DTSTART"));
    const recId = get("RECURRENCE-ID") ? parseIcs(get("RECURRENCE-ID")) : null;
    const isCancelled = /^STATUS:CANCELLED\s*$/m.test(block);

    // EXDATE 可有多行、一行可有多個值（逗號分隔）
    const exdates = new Set();
    for (const line of block.match(/^EXDATE[^:\n]*:.*$/gm) || []) {
      for (const v of line.split(":").slice(1).join(":").split(",")) {
        const p = parseIcs(v);
        if (p) exdates.add(keyOf(p));
      }
    }

    const rec = {
      uid, title, allDay,
      start: { ...s, allDay },
      durationMs: e ? toUTCms(e) - toUTCms(s) : 0,
      rrule: parseRrule(get("RRULE")),
      exdates,
      notes: stripHtml(unescapeIcs(get("DESCRIPTION"))),
    };

    if (recId) {
      const k = `${uid}|${keyOf(recId)}`;
      if (isCancelled) cancelled.add(k); else overrides.set(k, rec);
    } else if (!isCancelled) {
      masters.push(rec);
    }
  }

  // 展開重複事件；被 EXDATE 排除的跳過，被 RECURRENCE-ID 修改的換成修改後的內容
  const usedOverrides = new Set();
  const rows = [];
  for (const m of masters) {
    for (const occ of expandRrule(m.start, m.rrule, winStart, winEnd)) {
      const k = `${m.uid}|${keyOf(occ)}`;
      if (m.exdates.has(keyOf(occ))) continue;   // 老師在 Google 日曆刪掉的單次實例
      if (cancelled.has(k)) continue;
      const ov = overrides.get(k);
      if (ov) { usedOverrides.add(k); rows.push({ ...ov, start: ov.start }); continue; }
      rows.push({ ...m, start: occ });
    }
  }
  // 找不到對應母事件的 override（母事件在展開視窗外）仍要顯示
  for (const [k, ov] of overrides) if (!usedOverrides.has(k)) rows.push(ov);

  events = rows.map(r => {
    const startMs = toUTCms(r.start);
    const endP = r.durationMs ? fromUTCms(startMs + r.durationMs, r.allDay) : null;
    let end = endP ? isoOf(endP) : "";
    // 全天事件 DTEND 是「隔天」，顯示上要減一天
    if (end && r.allDay) end = isoOf(fromUTCms(toUTCms(endP) - 864e5, true));
    return {
      title: r.title,
      date: isoOf(r.start),
      endDate: end && end !== isoOf(r.start) ? end : "",
      startTime: timeOf(r.start),                                        // 空＝全天事件
      endTime: endP && isoOf(endP) === isoOf(r.start) ? timeOf(endP) : "", // 只在同一天結束時標結束時刻
      type: typeOf(r.title),
      notes: r.notes.slice(0, NOTES_MAX),
    };
  });

  // 同一天同標題只留一筆（母事件與 override 撞號時的最後保險）
  const seen = new Set();
  events = events.filter(e => {
    const k = `${e.date}|${e.startTime}|${e.title}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  events.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  console.log(`✅ calendar.json（${events.length} 筆，來自 Google 日曆；含重複事件展開）`);
} catch (e) {
  console.warn(`⚠️ Google 日曆 ICS 無法讀取：${e.message}；calendar.json 輸出空清單`);
}
await writeFile(path.join(DATA_DIR, "calendar.json"), JSON.stringify(events, null, 2) + "\n", "utf8");
