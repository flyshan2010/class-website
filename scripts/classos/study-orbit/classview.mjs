// 教師專區「自學星圖」分頁的彙整（P3 SPEC §4，第③步）。純函式、node 可測；
// 代理 v2.27 的 orbit_class／orbit_student 用同一支（build-so-proxy.mjs 把本檔去掉 import／export 後貼進 .gs，U83）。
// 輸出只有座號與數字（盲點、關卡只給代碼，名稱由教師頁從班網公開題本檔對照），不含姓名、查詢碼、作答原文。
// ⚠️ 代理是 Apps Script：不用 ??=、?.，名稱一律 cv 開頭（避免和代理、rules.mjs 撞名，建置時會檢查）。
import { decodeSave, islandCore, chestOpen, weekStart, weekDays, towerNames, TOWER_STAIR_SUBJ, TOWER_STAIR_TITLE } from "./rules.mjs";

export const CV_SINCE = "2026-11-28"; // days／cw／wr 從代理 v2.26 部署這天起累積（部署前的日子不補）
export const CV_STUCK_TRIES = 2;      // 卡關＝挑戰 ≥2 次仍 0 星
export const CV_STUCK_SEATS = 3;      // 一關有 ≥3 人卡關＝卡關星
export const CV_DUE_CARDS = 3;        // 到期沒複習 ≥3 張才提醒
export const CV_STREAK_GOOD = 5;      // 連續天數 ≥5（正向）
export const CV_TODO_MAX = 5;

const CV_DAY0 = Date.UTC(2026, 0, 1);
function cvDayStr(n) { return new Date(CV_DAY0 + n * 864e5).toISOString().slice(0, 10); }
function cvAddDays(ymd, n) { return new Date(Date.parse(ymd + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10); }
function cvDiff(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5); }
function cvSave(raw) { // 存檔字串或物件 → 記憶體形狀；壞檔當空檔（不讓一位學生的壞檔擋住全班）
  try { return decodeSave(raw == null ? null : raw); } catch (e) { return decodeSave(null); }
}
function cvShort(book, code) { return code.indexOf(book + "-") === 0 ? code.slice(book.length + 1) : code; }

/** 題本結構 → 每座島 {id, name, keys:[一般關…], core:島心鍵, virtual}（鍵一律省略題本代碼，和存檔一致） */
export function cvIslands(book) {
  const isl = ((book.structure || {}).islands) || [];
  return isl.map(function (x) {
    const island = { id: x.id, levels: (x.levels || []).map(function (l) { return { code: cvShort(book.code, l.code), name: l.name }; }) };
    const c = islandCore(island);
    return { id: String(x.id), name: x.name || "", island: island, keys: c.levels, core: c.key, virtual: c.virtual };
  });
}

/** 一關的格子值：-1 沒玩、0 試過沒過、1–3 最高星等 */
function cvCell(lv, k) { const r = lv[k]; if (!r) return -1; return r[0] >= 1 ? r[0] : (r[2] > 0 ? 0 : -1); }
/** 一座島的熱圖格：0 沒玩、1 卡關（試過沒過）、2 部分過關、3 全過、4 島心全金（寶箱開） */
export function cvIslandState(isl, lv) {
  if (chestOpen(isl.island, lv)) return 4;
  const all = isl.keys.concat([isl.core]).map(function (k) { return cvCell(lv, k); });
  if (all.every(function (v) { return v >= 1; })) return 3;
  if (all.some(function (v) { return v >= 1; })) return 2;
  if (all.some(function (v) { return v === 0; })) return 1;
  return 0;
}

/** 本週、上週有自學的天數；days＝代理存的天數（距 2026-01-01） */
function cvWeekCount(days, today) {
  const ws = weekStart(today + "T12:00:00+08:00"), pws = cvAddDays(ws, -7);
  let cur = 0, prev = 0;
  (days || []).forEach(function (n) { const d = cvDayStr(n); if (d >= ws && d <= today) cur++; else if (d >= pws && d < ws) prev++; });
  return { cur: cur, prev: prev };
}
function cvWk(arr, ws) { // 週計數 [起算日, …]；不是本週＝全 0；v2.28 前的 wr 只有 3 格，缺的格當 0
  const a = Array.isArray(arr) && arr[0] === ws ? arr.slice() : [ws];
  while (a.length < 4) a.push(0);
  return a;
}
/**
 * 百鍊之塔（v2.29 三階，P3 §13.4）：tws＝{座號: {ch:[…], ma:[最高過層, 各層最佳秒…], so:[…]}} → 每一階各層停住人數（0＝還沒過任何層）。
 * 回 [{stair, title, names, at, played}]（依 國語、數學、社會；沒有人玩過的階不列）；三階都沒人玩回 null。國社層名從題本結構取。
 */
const CV_STAIRS = ["ch", "ma", "so"];
function cvTower(seats, tws, books) {
  const out = [];
  CV_STAIRS.forEach(function (st) {
    const book = (books || []).find(function (b) { return b.subject === TOWER_STAIR_SUBJ[st]; });
    const names = towerNames(st, book && book.structure), n = names.length, at = []; let played = 0;
    for (let i = 0; i <= n; i++) at.push(0);
    seats.forEach(function (s) {
      const r = ((tws || {})[s] || {})[st];
      if (!r) { at[0]++; return; }
      played++; at[Math.min(n, Math.max(0, r[0] || 0))]++;
    });
    if (played) out.push({ stair: st, title: TOWER_STAIR_TITLE[st], names: names, at: at, played: played });
  });
  return out.length ? out : null;
}

/**
 * 全班彙整。
 * @param {object} a
 *   books：[{code, subject, structure}]（班網 index.json）
 *   seats：在學座號（名冊；不含體驗座號）
 *   saves：{題本: {座號: 存檔字串|物件}}（缺＝沒玩）
 *   mes：{座號: {days, cw, wr, streak}}（streak＝代理算好的「現在」連續天數）
 *   tws：{座號: {ch／ma／so:[最高過層, 各層最佳秒…]}}（v2.28 百鍊之塔、v2.29 三階；缺＝沒玩）
 *   today：臺北日期 YYYY-MM-DD
 */
export function classView(a) {
  const today = a.today, ws = weekStart(today + "T12:00:00+08:00");
  const seats = (a.seats || []).slice().sort(function (x, y) { return x - y; });
  const N = seats.length, mes = a.mes || {};
  const out = {
    ok: true, today: today, weekStart: ws, since: CV_SINCE, n: N,
    kpi: {}, todo: [], heat: [], bsTop: [], usage: {}, tower: null, week: {},
  };
  let lit = 0, slots = 0;
  const stuck = [], bsCount = {}, due = {};
  (a.books || []).forEach(function (book) {
    const isl = cvIslands(book), bySeat = ((a.saves || {})[book.code]) || {};
    const keys = []; isl.forEach(function (x) { x.keys.concat([x.core]).forEach(function (k) { keys.push(k); }); });
    const stuckN = {};
    const rows = {}, detail = {};
    seats.forEach(function (s) {
      const m = cvSave(bySeat[s]), lv = m.lv;
      rows[s] = isl.map(function (x) { return cvIslandState(x, lv); });
      detail[s] = keys.map(function (k) { return cvCell(lv, k); });
      keys.forEach(function (k) {
        const r = lv[k];
        if (r && r[0] >= 1) lit++;
        if (r && r[0] === 0 && r[2] >= CV_STUCK_TRIES) stuckN[k] = (stuckN[k] || 0) + 1;
      });
      Object.keys(m.cd).forEach(function (code) {
        const c = m.cd[code];
        if (c[0] === "t" && c[1] >= ws) { const full = book.code + "-" + code; bsCount[full] = (bsCount[full] || 0) + 1; }
        if (c[0] === "d" && cvDiff(c[1], today) >= 7) due[s] = (due[s] || 0) + 1;
      });
    });
    slots += N * keys.length;
    keys.forEach(function (k) { if ((stuckN[k] || 0) >= CV_STUCK_SEATS) stuck.push({ book: book.code, key: k, n: stuckN[k] }); });
    out.heat.push({
      book: book.code, subject: book.subject || "",
      islands: isl.map(function (x) { return { id: x.id, name: x.name, keys: x.keys, core: x.core, virtual: x.virtual }; }),
      keys: keys, rows: rows, detail: detail,
    });
  });
  stuck.sort(function (x, y) { return y.n - x.n || (x.book + x.key).localeCompare(y.book + y.key, "en", { numeric: true }); });

  // 週資料
  let d3 = 0, cwT = 0, cwP = 0, wrA = 0, wrC = 0, wrT = 0;
  const zero = [], good = [];
  seats.forEach(function (s) {
    const me = mes[s] || {}, wc = cvWeekCount(me.days, today);
    out.week[s] = { days: weekDays((me.days || []).map(cvDayStr), today), n: wc.cur, streak: me.streak || 0, due: due[s] || 0 };
    if (wc.cur >= 3) d3++;
    if (wc.cur === 0 && wc.prev >= 2) zero.push(s);
    if ((me.streak || 0) >= CV_STREAK_GOOD) good.push(s);
    const cw = cvWk(me.cw, ws), wr = cvWk(me.wr, ws);
    cwT += cw[1]; cwP += cw[2]; wrA += wr[1]; wrC += wr[2]; wrT += wr[3];
  });

  out.kpi = {
    week3: { n: d3, of: N },
    bright: { lit: lit, of: slots, pct: slots ? Math.floor(lit / slots * 100 + 0.5) : 0 }, // 四捨五入（ROUND_HALF_UP）
    stuck: { n: stuck.length, levels: stuck },
    due: { pass: cwP, tries: cwT, pct: cwT ? Math.floor(cwP / cwT * 100 + 0.5) : null },
  };
  out.bsTop = Object.keys(bsCount).map(function (c) { return { code: c, n: bsCount[c] }; })
    .sort(function (x, y) { return y.n - x.n || x.code.localeCompare(y.code, "en", { numeric: true }); }).slice(0, 5);
  out.usage = { after: wrA, core: wrC, tower: wrT };
  out.tower = cvTower(seats, a.tws, a.books);

  // 📌 這週需要您看的事：照順序挑，最多 5 句；一句一種事
  const todo = [];
  if (zero.length) todo.push({ t: "zero", seats: zero });
  stuck.slice(0, 2).forEach(function (x) { todo.push({ t: "stuck", book: x.book, key: x.key, n: x.n }); });
  if (out.bsTop.length) todo.push({ t: "bs", code: out.bsTop[0].code, n: out.bsTop[0].n });
  const dueSeats = seats.filter(function (s) { return (due[s] || 0) >= CV_DUE_CARDS; }).map(function (s) { return { seat: s, n: due[s] }; });
  if (dueSeats.length) todo.push({ t: "due", seats: dueSeats });
  if (good.length) todo.push({ t: "streak", seats: good });
  out.todo = todo.slice(0, CV_TODO_MAX);
  return out;
}

function cvTowerOf(tw) {
  const o = {};
  CV_STAIRS.forEach(function (st) { if (tw && Array.isArray(tw[st])) o[st] = tw[st]; });
  return Object.keys(o).length ? o : null;
}

/**
 * 個人頁（點座號）。
 * @param {object} a  books、today 同上；seat；saves：{題本: 存檔}；me：{days, cw, wr, streak}；tw：{ch／ma／so:[…]}（百鍊之塔）
 */
export function studentView(a) {
  const today = a.today, ws = weekStart(today + "T12:00:00+08:00"), me = a.me || {};
  const books = (a.books || []).map(function (book) {
    const m = cvSave(((a.saves || {})[book.code])), isl = cvIslands(book);
    const cards = Object.keys(m.cd).map(function (code) {
      const c = m.cd[code];
      return { code: book.code + "-" + code, st: c[0] === "t" ? "todo" : cvDiff(c[1], today) >= 7 ? "due" : "wait", date: c[1] };
    }).sort(function (x, y) { return x.code.localeCompare(y.code, "en", { numeric: true }); });
    return {
      book: book.code, subject: book.subject || "",
      islands: isl.map(function (x) {
        return { id: x.id, name: x.name, core: x.core, virtual: x.virtual,
          keys: x.keys, cells: x.keys.map(function (k) { return cvCell(m.lv, k); }), coreCell: cvCell(m.lv, x.core),
          state: cvIslandState(x, m.lv) };
      }),
      cards: cards, overcome: m.ok.length,
    };
  });
  const wc = cvWeekCount(me.days, today), cw = cvWk(me.cw, ws), wr = cvWk(me.wr, ws);
  return {
    ok: true, seat: a.seat, today: today, weekStart: ws, since: CV_SINCE, books: books,
    days: weekDays((me.days || []).map(cvDayStr), today), weekN: wc.cur, streak: me.streak || 0,
    usage: { after: wr[1], core: wr[2], tower: wr[3] }, due: { pass: cw[2], tries: cw[1] },
    tower: cvTowerOf(a.tw), // {ch／ma／so: [最高過層, 各層最佳秒…]}，只留玩過的階；都沒玩＝null
  };
}
