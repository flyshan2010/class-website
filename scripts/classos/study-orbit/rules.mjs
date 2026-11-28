// 自學星圖闖關規則（規格正本：ClassOS_v3.5_藍圖/SPEC_自學星圖_P1資料模型.md §5.1–5.3）
// 全部是純函式；P2 前台與代理共用這一支，不各自重寫（U83）。

/**
 * §5.1 一格的燈。
 * @param {{first:boolean, hinted:boolean, retry?:boolean|null, fast?:boolean}} a
 *   first＝第一次是否答對；hinted＝第一次是否用過提示（1–3 層都算）；
 *   retry＝第一次答錯後再挑戰是否答對（沒再挑戰為 null）；
 *   fast＝第一次作答秒數 <2（P2 SPEC §1 第 6 項：太快答對只給銀燈，和用了提示一樣）
 * @returns {{light:"gold"|"silver"|"dark", streak:"+1"|"keep"|"reset", card:null|"待複習"|"已克服"}}
 */
export const FAST_SEC = 2; // 第一次作答 <2 秒＝作答過快
export const isFast = (sec) => Number.isFinite(Number(sec)) && Number(sec) < FAST_SEC;
export function slotLight({ first, hinted, retry = null, fast = false }) {
  if (first) return hinted || fast
    ? { light: "silver", streak: "keep", card: null }
    : { light: "gold", streak: "+1", card: null };
  if (retry === true) return { light: "silver", streak: "keep", card: "已克服" }; // 再挑戰用不用提示都是銀燈
  return { light: "dark", streak: "reset", card: "待複習" };
}

/** 套用連對變化 */
export function nextStreak(streak, change) {
  return change === "+1" ? streak + 1 : change === "reset" ? 0 : streak;
}

/** §5.2 星等：由上往下，先符合先算 */
export function stars(gold, silver) {
  const lit = gold + silver;
  if (lit === 7 && gold >= 6) return 3;
  if (lit >= 5) return 2;
  if (lit >= 3) return 1;
  return 0;
}
export const allGold = (gold) => gold === 7; // 全對＝七盞都是金燈（≠3 星）
export const passed = (gold, silver) => stars(gold, silver) >= 1;

/**
 * 一回合結束後更新該關紀錄（存檔 lv：[最高星等, 曾經七盞全金, 挑戰次數]）
 * @returns {{record:[number,0|1,number], gained:number}} gained＝刷新紀錄多出來的星（加進本週星數）
 */
export function applyRound(record, gold, silver) {
  const [best, everGold, tries] = record ?? [0, 0, 0];
  const s = stars(gold, silver);
  const newBest = Math.max(best, s);
  return {
    record: [newBest, everGold || allGold(gold) ? 1 : 0, tries + 1],
    gained: newBest - best,
  };
}

/* ---------- P3 §1：島心試煉與寶箱（第②步） ----------
   island＝{id, levels:[{code, name}]}（code 可以是完整代碼或省略題本的短鍵，回傳同一種）；lv＝存檔的關卡紀錄 */
export const CORE_RE = /評量複習$/;
/** 島心：名稱以「評量複習」結尾的那一關（國語）；沒有就是虛擬島心 <島>-0（數學、社會，從各關題池抽題） */
export function islandCore(island) {
  const lvs = (island && island.levels) || [];
  const i = lvs.findIndex((l) => CORE_RE.test(String(l.name || "")));
  if (i >= 0) return { key: lvs[i].code, levels: lvs.filter((_, k) => k !== i).map((l) => l.code), virtual: false };
  const all = lvs.map((l) => l.code);
  return { key: (all.length ? all[0].replace(/-[^-]+$/, "") : String(island && island.id)) + "-0", levels: all, virtual: true };
}
/** 島心開放前還差幾關（各關最高星等 ≥1 才算過） */
export function coreLeft(island, lv) {
  return islandCore(island).levels.filter((k) => !(((lv || {})[k] || [0])[0] >= 1)).length;
}
/** 島心開放＝其餘每一關都 ≥1 星；島心已經有紀錄的照樣開（不倒退） */
export function coreOpen(island, lv) {
  const c = islandCore(island);
  if ((lv || {})[c.key]) return true;
  return c.levels.length > 0 && coreLeft(island, lv) === 0;
}
/** 寶箱：島心曾經七盞全金，或（舊條件）島上每一關都曾經全金——任一成立就開（P3 §11 第 2 題 A，不寫遷移） */
export function chestOpen(island, lv) {
  const c = islandCore(island), L = lv || {}, all = ((island && island.levels) || []).map((l) => l.code);
  if ((L[c.key] || [])[1] === 1) return true;
  return all.length > 0 && all.every((k) => (L[k] || [])[1] === 1);
}
/** 本週一～日哪幾天有自學：days＝日期字串陣列（YYYY-MM-DD），回 7 個 true／false */
export function weekDays(days, today) {
  const set = new Set(days || []), ws = Date.parse(weekStart(`${today}T12:00:00+08:00`) + "T00:00:00Z");
  return Array.from({ length: 7 }, (_, i) => set.has(new Date(ws + i * 864e5).toISOString().slice(0, 10)));
}

/** §5.3 星數＝各關最高星等加總；完成關數＝最高星等 ≥1 的關數 */
export function totals(lv) {
  const recs = Object.values(lv ?? {});
  return {
    stars: recs.reduce((n, r) => n + r[0], 0),
    completed: recs.filter((r) => r[0] >= 1).length,
  };
}

/** 本週起算日（臺北時間週一），回傳 YYYY-MM-DD */
export function weekStart(date) {
  const tpe = new Date(new Date(date).getTime() + 8 * 3600e3); // 用 UTC 欄位讀臺北時間
  const dow = (tpe.getUTCDay() + 6) % 7; // 週一＝0
  tpe.setUTCDate(tpe.getUTCDate() - dow);
  return tpe.toISOString().slice(0, 10);
}

/** 換週就把本週星數歸零，再加這次多出來的星 */
export function addWeekly({ weekly, since }, gained, now) {
  const ws = weekStart(now);
  return since === ws ? { weekly: weekly + gained, since } : { weekly: gained, since: ws };
}

/**
 * 排行：同分並列同一名次（1、1、3）。keys 由大到小比；回傳依名次排序的 [{...row, rank}]
 * 進度榜：keys＝[完成關數, 星數]；星數榜：[星數]；本週榜：[本週星數]
 */
export function rank(rows, keys) {
  const cmp = (a, b) => { for (const k of keys) if (b[k] !== a[k]) return b[k] - a[k]; return 0; };
  const sorted = [...rows].sort(cmp);
  let r = 0;
  return sorted.map((row, i) => {
    if (i === 0 || cmp(sorted[i - 1], row) !== 0) r = i + 1;
    return { ...row, rank: r };
  });
}

/** 「再 N 顆星就追平前一名」：自己是第一名回 null */
export function starsToCatchUp(ranked, seat, key = "stars") {
  const me = ranked.find((x) => x.seat === seat);
  if (!me || me.rank === 1) return null;
  const ahead = ranked.filter((x) => x.rank < me.rank);
  const prev = ahead[ahead.length - 1];
  return prev[key] - me[key];
}

// ── 存檔（P2 SPEC §4：第 2 版；第 1 版只讀不寫）──────────────────────────
// 記憶體裡的形狀（兩版共用，鍵都省略題本代碼）：
//   { lv:{關:[最高星等,曾經全金,挑戰次數]}, cd:{盲點:["t"|"d","YYYY-MM-DD"]}, ok:[盲點], sc:[關], mid:{k,i,res,q,t?}|null }
// 第 2 版字串：{"v":2,"L":{關:[星,全金,次數,故事卡,盲點串]},"mid":{…,"t":毫秒}}
//   盲點串一筆＝序號 1 字（36 進位，B1→1、B10→a）＋狀態 1 字（t／d 再接 3 字日期；o 不帶日期）

const DAY0 = Date.UTC(2026, 0, 1);
const dayToStr = (n) => new Date(DAY0 + n * 864e5).toISOString().slice(0, 10);
const strToDay = (s) => Math.round((Date.parse(`${s}T00:00:00Z`) - DAY0) / 864e5);

/** 日期 YYYY-MM-DD → 3 字（距 2026-01-01 天數，36 進位補零） */
export function encodeDay(s) {
  const n = strToDay(s);
  if (!(n >= 0 && n < 36 ** 3)) throw new Error(`存檔日期超出範圍：${s}`);
  return n.toString(36).padStart(3, "0");
}
export const decodeDay = (s3) => dayToStr(parseInt(s3, 36));

const splitBs = (code) => { // "1-1-B10" → ["1-1", 10]
  const m = /^(.+)-B(\d+)$/.exec(code);
  if (!m) throw new Error(`盲點代碼格式不符：${code}`);
  const n = Number(m[2]);
  if (!(n >= 1 && n <= 35)) throw new Error(`盲點序號超出 1–35：${code}`);
  return [m[1], n];
};

/** 一關的盲點串：entries＝[[序號, "t"|"d"|"o", 日期|null]] */
export function encodeBsStr(entries) {
  return [...entries].sort((a, b) => a[0] - b[0])
    .map(([n, st, d]) => n.toString(36) + st + (st === "o" ? "" : encodeDay(d))).join("");
}
export function decodeBsStr(str) {
  const out = [];
  for (let i = 0; i < str.length;) {
    const n = parseInt(str[i], 36), st = str[i + 1];
    if (st === "o") { out.push([n, "o", null]); i += 2; }
    else if (st === "t" || st === "d") { out.push([n, st, decodeDay(str.slice(i + 2, i + 5))]); i += 5; }
    else throw new Error(`盲點串無法解析：${str}`);
  }
  return out;
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
const empty = () => ({ lv: {}, cd: {}, ok: [], sc: [], mid: null });

/** 讀存檔（字串或物件；第 1、2 版都讀得進），回傳記憶體形狀（鍵已排序，方便比對） */
export function decodeSave(raw) {
  if (raw == null || raw === "") return empty();
  const s = typeof raw === "string" ? JSON.parse(raw) : raw;
  const m = empty();
  if (s.v === 1) {
    for (const [k, r] of Object.entries(s.lv ?? {})) m.lv[k] = [r[0], r[1], r[2]];
    for (const [k, r] of Object.entries(s.cd ?? {})) m.cd[k] = [r[0], r[1]];
    m.ok = [...(s.ok ?? [])];
    m.sc = [...(s.sc ?? [])];
    m.mid = s.mid ?? null;
  } else if (s.v === 2) {
    for (const [k, r] of Object.entries(s.L ?? {})) {
      const [best, gold, tries, story, bs = ""] = r;
      if (best || gold || tries) m.lv[k] = [best, gold, tries];
      if (story) m.sc.push(k);
      for (const [n, st, d] of decodeBsStr(bs)) {
        const code = `${k}-B${n}`;
        if (st === "o") m.ok.push(code); else m.cd[code] = [st, d];
      }
    }
    m.mid = s.mid ?? null;
  } else throw new Error(`不認得的存檔版本：${s.v}`);
  m.lv = sortObj(m.lv); m.cd = sortObj(m.cd);
  const byNum = (a, b) => a.localeCompare(b, "en", { numeric: true });
  m.ok.sort(byNum); m.sc.sort(byNum);
  return m;
}

/** 寫存檔：一律第 2 版，回傳 JSON 字串 */
export function encodeSave(m) {
  const L = {};
  const row = (k) => L[k] || (L[k] = [...((m.lv && m.lv[k]) || [0, 0, 0]), 0, []]); // 不用 ??=：代理（Apps Script）共用這支
  for (const k of Object.keys(m.lv ?? {})) row(k);
  for (const k of m.sc ?? []) row(k)[3] = 1;
  for (const [code, [st, d]] of Object.entries(m.cd ?? {})) { const [k, n] = splitBs(code); row(k)[4].push([n, st, d]); }
  for (const code of m.ok ?? []) { const [k, n] = splitBs(code); row(k)[4].push([n, "o", null]); }
  for (const r of Object.values(L)) r[4] = encodeBsStr(r[4]);
  const out = { v: 2, L: sortObj(L) };
  if (m.mid) out.mid = m.mid;
  return JSON.stringify(out);
}

/* ---------- P3 §1：四季與節氣（皇城圖像化第①步；日期一律臺北日期字串 YYYY-MM-DD） ---------- */
/** 季節：月份制 3–5 春／6–8 夏／9–11 秋／12–2 冬 */
export function season(ymd) {
  const m = Number(String(ymd).slice(5, 7));
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
}
const SOLAR_NAMES = ["小寒", "大寒", "立春", "雨水", "驚蟄", "春分", "清明", "穀雨", "立夏", "小滿", "芒種", "夏至",
  "小暑", "大暑", "立秋", "處暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至"];
// 壽星公式 21 世紀 C 值（依上表順序；每月兩個節氣）
const SOLAR_C = [5.4055, 20.12, 3.87, 18.73, 5.63, 20.646, 4.81, 20.1, 5.52, 21.04, 5.678, 21.37,
  7.108, 22.83, 7.5, 23.13, 7.646, 23.042, 8.318, 23.438, 7.438, 22.36, 7.18, 21.94];
// 公式例外（21 世紀已知；臺灣時間）：年-節氣序號 → 加減天數。2026 雨水已對照中央氣象署 115 年日曆資料表（2/18 23:52）
const SOLAR_FIX = { "2002-14": 1, "2008-9": 1, "2016-12": 1, "2019-0": -1, "2021-23": -1, "2026-3": -1,
  "2082-1": 1, "2084-5": 1, "2089-19": 1, "2089-20": 1 };
/** 某年第 i 個節氣（0＝小寒）是幾號 */
export function solarTermDay(year, i) {
  const y = year % 100, L = i < 4 ? Math.floor((y - 1) / 4) : Math.floor(y / 4);
  return Math.floor(y * 0.2422 + SOLAR_C[i]) - L + (SOLAR_FIX[year + "-" + i] || 0);
}
/** 今天所在的節氣名（例：2026-11-28 → 小雪）；只支援 2001–2099 年 */
export function solarTerm(ymd) {
  const Y = Number(String(ymd).slice(0, 4)), m = Number(String(ymd).slice(5, 7)), d = Number(String(ymd).slice(8, 10));
  let i = (m - 1) * 2 + 1; // 從本月第二個節氣往回找
  if (d < solarTermDay(Y, i)) i--;
  if (i >= 0 && d < solarTermDay(Y, i)) i--;
  return SOLAR_NAMES[(i + 24) % 24]; // 1 月 5 日前＝前一年的冬至
}
