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

/** 寶箱：一座島每一關「曾經七盞全金」都是 1 才開（不必同一次完成） */
export function chestOpen(islandLevelCodes, lv) {
  return islandLevelCodes.length > 0 && islandLevelCodes.every((c) => lv[c]?.[1] === 1);
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
