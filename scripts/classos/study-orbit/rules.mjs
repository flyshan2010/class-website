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

/* ---------- P3 §5：百鍊之塔・數學算力階（第④步） ----------
   出題全部由程式依「階、層、種子」算出，同種子必出同題：前台出題、代理用同一支重算判對錯（P2 §5.3）。
   塔紀錄 rec＝[最高過層, 第 1 層最佳秒, 第 2 層最佳秒, …]（0＝還沒過）；不倒數、不上排行榜、只和自己比。 */
export const TOWER_Q = 10;        // 一層 10 題
export const TOWER_PASS = 9;      // 答對 ≥9 題過層
export const TOWER_FAST_MS = 1000; // 1 秒內作答
export const TOWER_FAST_RUN = 3;   // 連續 3 題 1 秒內 → 提醒「看清楚再答」（只提醒、不扣分）
export const TOWER_FLOORS = { ma: ["二位數加減", "三位數加法（進位）", "三位數減法（借位）", "九九乘法", "九九反推除法", "大數位值（萬、億）",
  "二位數乘一位數", "三位數乘一位數", "二位數乘二位數", "三位數除以一位數", "除以二位數（估商）", "二位小數加減"] };
export const TOWER_SEED_MAX = 2147483647;

function twRng(seed) { // mulberry32：同種子同序列（Apps Script 與瀏覽器結果一致，只用 32 位元整數運算）
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const twInt = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const twComma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const twDigits = (n) => String(n).split("").map(Number);
/* 逐位不進位：各位相加只留個位（進位漏加） */
function twNoCarry(a, b) { let s = 0, p = 1; while (a > 0 || b > 0) { s += ((a % 10 + b % 10) % 10) * p; a = Math.floor(a / 10); b = Math.floor(b / 10); p *= 10; } return s; }
/* 逐位大減小（借位沒減） */
function twAbsDigit(a, b) { let s = 0, p = 1; while (a > 0 || b > 0) { s += Math.abs(a % 10 - b % 10) * p; a = Math.floor(a / 10); b = Math.floor(b / 10); p *= 10; } return s; }
/* 乘一位數各位只寫個位、進位漏加 */
function twMulNoCarry(a, b) { let s = 0, p = 1; while (a > 0) { s += ((a % 10) * b % 10) * p; a = Math.floor(a / 10); p *= 10; } return s; }
/* 乘法有進位時漏加進位：各位乘積各自取個位以外的部分丟掉 */
const twHasCarry = (a, b) => twDigits(a).reverse().some((d, i) => d + (twDigits(b).reverse()[i] || 0) >= 10);
const twHasBorrow = (a, b) => twDigits(a).reverse().some((d, i) => d < (twDigits(b).reverse()[i] || 0));

/* 誘答：先放常見錯誤，再用鄰近數補；全部 ≥0、不等於正解、不重複。fmt＝數字轉選項字串 */
function twOpts(r, ans, errs, near, fmt, min) {
  const lo = min == null ? 0 : min, seen = {}, out = [];
  seen[fmt(ans)] = 1;
  const add = (v) => { if (out.length >= 3 || !(v >= lo) || !Number.isFinite(v)) return; const s = fmt(v); if (seen[s]) return; seen[s] = 1; out.push(s); };
  errs.forEach(add);
  const nb = near.slice();
  for (let i = nb.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = nb[i]; nb[i] = nb[j]; nb[j] = t; }
  nb.forEach((d) => add(ans + d));
  for (let d = 1; out.length < 3; d++) { add(ans + d); add(ans - d); }
  const all = [fmt(ans)].concat(out);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = all[i]; all[i] = all[j]; all[j] = t; }
  return all;
}
const twQ = (text, ans, opts, v) => ({ text: text, ans: ans, opts: opts, v: v });

/* 各層出一題（v＝運算元，測試檢查範圍用） */
const TW_MA = [
  function (r) { // 1 二位數加減
    const a = twInt(r, 10, 99); let b = twInt(r, 10, 99); while (b === a) b = twInt(r, 10, 99);
    if (r() < 0.5) { const s = a + b; return twQ(a + " ＋ " + b + " ＝ ？", String(s), twOpts(r, s, [twHasCarry(a, b) ? s - 10 : s + 10, twNoCarry(a, b)], [1, -1, 10, -10, 2], String), [a, b]); }
    const x = Math.max(a, b), y = a === b ? x - 1 : Math.min(a, b), d = x - y;
    return twQ(x + " － " + y + " ＝ ？", String(d), twOpts(r, d, [twHasBorrow(x, y) ? d + 10 : d - 10, twAbsDigit(x, y)], [1, -1, 10, -10, 2], String), [x, y]);
  },
  function (r) { // 2 三位數加法（進位）
    let a, b, k = 0;
    do { a = twInt(r, 100, 899); b = twInt(r, 100, 999 - a < 100 ? 100 : 999 - a); k++; } while ((!twHasCarry(a, b) || a + b > 999) && k < 50);
    const s = a + b;
    return twQ(a + " ＋ " + b + " ＝ ？", String(s), twOpts(r, s, [twNoCarry(a, b), s - 10, s - 100], [10, -10, 1, -1, 100], String), [a, b]);
  },
  function (r) { // 3 三位數減法（借位）
    let a, b, k = 0;
    do { a = twInt(r, 200, 999); b = twInt(r, 100, a - 1); k++; } while (!twHasBorrow(a, b) && k < 50);
    const d = a - b;
    return twQ(a + " － " + b + " ＝ ？", String(d), twOpts(r, d, [twAbsDigit(a, b), d + 10, d + 100], [10, -10, 1, -1, -100], String), [a, b]);
  },
  function (r) { // 4 九九乘法
    const a = twInt(r, 2, 9), b = twInt(r, 2, 9), p = a * b;
    return twQ(a + " × " + b + " ＝ ？", String(p), twOpts(r, p, [a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b], [1, -1, 2, -2], String, 1), [a, b]);
  },
  function (r) { // 5 九九反推除法
    const a = twInt(r, 2, 9), b = twInt(r, 2, 9), c = a * b;
    return twQ(c + " ÷ " + a + " ＝ ？", String(b), twOpts(r, b, [b + 1, b - 1, b + 2], [1, -1, 2, -2, 3], String, 1), [c, a]);
  },
  function (r) { // 6 大數位值（萬、億）
    const PL = ["個", "十", "百", "千", "萬", "十萬", "百萬", "千萬", "億", "十億"];
    if (r() < 0.5) { // 「3,040 萬＝？」寫成阿拉伯數字（位值錯一位＝多或少一個 0）
      const big = r() < 0.5, k = twInt(r, 101, 9999), unit = big ? 100000000 : 10000, n = k * unit;
      return twQ(twComma(k) + (big ? " 億" : " 萬") + " ＝ ？", twComma(n), twOpts(r, n, [n * 10, n / 10, big ? k * 10000 : k * 100000000], [], twComma, 1), [k, unit]);
    }
    let n, ds, d, pos, k = 0; // 數字 n 裡某個只出現一次的數字在哪一位
    do { n = twInt(r, 10000000, 999999999); ds = String(n).split(""); pos = twInt(r, 2, ds.length - 1); d = ds[ds.length - 1 - pos]; k++; }
    while ((d === "0" || ds.filter((x) => x === d).length !== 1) && k < 80);
    const ans = PL[pos], cand = [pos + 1, pos - 1, pos + 4, pos - 4, pos + 2, pos - 2].filter((i) => i >= 0 && i < PL.length).map((i) => PL[i]);
    const seen = {}, wrong = cand.filter((x) => !seen[x] && (seen[x] = 1)).slice(0, 3), all = [ans].concat(wrong);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = all[i]; all[i] = all[j]; all[j] = t; }
    return twQ("「" + twComma(n) + "」的「" + d + "」在哪一位？", ans + "位", all.map((x) => x + "位"), [n, pos]);
  },
  function (r) { // 7 二位數乘一位數
    const a = twInt(r, 12, 99), b = twInt(r, 2, 9), p = a * b;
    return twQ(a + " × " + b + " ＝ ？", String(p), twOpts(r, p, [twMulNoCarry(a, b), p - 10, p + 10, p + b], [10, -10, 1, -1, b, -b], String, 1), [a, b]);
  },
  function (r) { // 8 三位數乘一位數
    const a = twInt(r, 100, 999), b = twInt(r, 2, 9), p = a * b;
    return twQ(a + " × " + b + " ＝ ？", String(p), twOpts(r, p, [twMulNoCarry(a, b), p - 100, p - 10, p + 10], [10, -10, 100, -100, 1, -1], String, 1), [a, b]);
  },
  function (r) { // 9 二位數乘二位數
    const a = twInt(r, 11, 99), b = twInt(r, 11, 99), p = a * b;
    return twQ(a + " × " + b + " ＝ ？", String(p), twOpts(r, p, [a * (b % 10) + a * Math.floor(b / 10), p - a, p + a, p - 100], [10, -10, 100, -100, 1, -1], String, 1), [a, b]);
  },
  function (r) { // 10 三位數除以一位數（整除）
    const b = twInt(r, 2, 9), q = twInt(r, Math.max(12, Math.ceil(100 / b)), Math.floor(999 / b)), a = q * b;
    const drop0 = /0/.test(String(q).slice(1)) ? Number(String(q).replace(/0/g, "")) : q * 10;
    return twQ(a + " ÷ " + b + " ＝ ？", String(q), twOpts(r, q, [drop0, q + 1, q - 1, q + 10], [1, -1, 10, -10, 2], String, 1), [a, b]);
  },
  function (r) { // 11 除以二位數（估商，整除）
    const b = twInt(r, 11, 99), q = twInt(r, 2, 9), a = q * b;
    return twQ(a + " ÷ " + b + " ＝ ？", String(q), twOpts(r, q, [q + 1, q - 1, q + 2], [1, -1, 2, -2, 3], String, 1), [a, b]);
  },
  function (r) { // 12 二位小數加減（以百分之一為單位算，避免浮點誤差）
    const f = (c) => (c / 100).toFixed(2), a = twInt(r, 101, 999); let b = twInt(r, 101, 999); while (b === a) b = twInt(r, 101, 999);
    if (r() < 0.5) { const s = a + b; return twQ(f(a) + " ＋ " + f(b) + " ＝ ？", f(s), twOpts(r, s, [twHasCarry(a, b) ? s - 10 : s + 10, twNoCarry(a, b), s - 100], [10, -10, 1, -1, 100], f, 1), [a, b]); }
    const x = Math.max(a, b), y = a === b ? x - 1 : Math.min(a, b), d = x - y;
    return twQ(f(x) + " － " + f(y) + " ＝ ？", f(d), twOpts(r, d, [twHasBorrow(x, y) ? d + 10 : d - 10, twAbsDigit(x, y), d + 100], [10, -10, 1, -1, 100], f, 1), [x, y]);
  },
];

/** 出一層 10 題：回 [{text, ans, opts:[4 個選項字串], v}]；同一層不出同一題。不認得的階或層回 null */
export function towerFloor(stair, floor, seed) {
  const gen = stair === "ma" ? TW_MA[floor - 1] : null;
  if (!gen || !(seed >= 1 && seed <= TOWER_SEED_MAX) || Math.floor(seed) !== seed) return null;
  const r = twRng(seed * 31 + floor), out = [], seen = {};
  for (let k = 0; out.length < TOWER_Q && k < 200; k++) { const q = gen(r); if (seen[q.text]) continue; seen[q.text] = 1; out.push(q); }
  return out;
}
/** 判對錯：picked＝學生選的 10 個選項字串；回答對題數（代理用同一支重算） */
export function towerScore(stair, floor, seed, picked) {
  const qs = towerFloor(stair, floor, seed);
  if (!qs || !Array.isArray(picked) || picked.length !== TOWER_Q) return -1;
  return qs.filter((q, i) => String(picked[i]) === q.ans).length;
}
/** 快答提醒次數：ms＝每題作答毫秒；連續 3 題 <1 秒算一次，提醒後重新數 */
export function towerFast(ms) {
  let run = 0, n = 0;
  (ms || []).forEach((t) => { if (Number(t) < TOWER_FAST_MS) { run++; if (run >= TOWER_FAST_RUN) { n++; run = 0; } } else run = 0; });
  return n;
}
/** 這一層開放了沒：第 1 層一定開；之後要過了前一層 */
export function towerOpen(rec, floor) {
  const top = (rec && rec[0]) || 0, n = TOWER_FLOORS.ma.length;
  return floor >= 1 && floor <= n && floor <= top + 1;
}
/**
 * 一層打完：correct＝答對題數、sec＝用時（整數秒）。
 * 回 {pass, gold, first, best:原本最佳秒(0＝沒有), rec:新紀錄}。
 * 金階＝這層已經有最佳紀錄、這次過層且比最佳紀錄快（P3 §11 第 1 題 A）；第一次過層只記成最佳紀錄。沒過層的用時不算紀錄。
 */
export function towerResult(rec, floor, correct, sec) {
  const r = (rec || [0]).slice(), best = r[floor] || 0, pass = correct >= TOWER_PASS;
  if (!pass) return { pass: false, gold: false, first: false, best: best, rec: r }; // 沒過層：紀錄原封不動
  while (r.length <= floor) r.push(0);
  const s = Math.max(1, Math.round(Number(sec) || 0)), gold = best > 0 && s < best;
  if (!best || s < best) r[floor] = s;
  r[0] = Math.max(r[0] || 0, floor);
  return { pass: true, gold: gold, first: !best, best: best, rec: r };
}
/** 兩份塔紀錄合併（本機還沒上傳的 ＋ 伺服器的）：最高層取大、各層最佳取小（0＝沒有） */
export function towerMerge(a, b) {
  const x = a || [0], y = b || [0], n = Math.max(x.length, y.length), out = [Math.max(x[0] || 0, y[0] || 0)];
  for (let i = 1; i < n; i++) { const p = x[i] || 0, q = y[i] || 0; out.push(p && q ? Math.min(p, q) : p || q); }
  return out;
}
