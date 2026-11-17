// 執行：node --test scripts/so-proxy.test.mjs
// 代理 v2.21 自學星圖 so_* 的本機模擬（SPEC_自學星圖_P2前台與線上紀錄.md §10.1）：
// 把 apps-script-proxy-v2.gs 原樣載入 vm，Apps Script 的服務（屬性、快取、鎖、觸發器、UrlFetch）換成記憶體假物件，
// 時鐘可撥，Notion 與班網公開檔都是假的，不碰真資料。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import vm from "node:vm";
import { build } from "./build-so-proxy.mjs";
import { decodeSave } from "./classos/study-orbit/rules.mjs";

const SRC = readFileSync(new URL("./apps-script-proxy-v2.gs", import.meta.url), "utf8");
const BOOK = JSON.parse(readFileSync(new URL("../data/study-orbit/m-h-4a.json", import.meta.url), "utf8"));
const INDEX = { books: [{ code: "m-h-4a", subject: "數學" }, { code: "s-k-4a", subject: "社會" }] };
const DS = { roster: "ad232b7a-c7f8-4a68-b224-5b2d5b16599a", book: "41ab1f9d-7e45-8171-bb0d-000be3c15679",
  prog: "41ab1f9d-7e45-819c-90b8-000b0870e17e", log: "41ab1f9d-7e45-814c-83c1-000b89fcfdf0",
  progSim: "41bb1f9d-7e45-8171-8630-000b4c3f9633", logSim: "41bb1f9d-7e45-8188-a73b-000b5f24b177" };
const TEST_KEY = "test-key-123";

// 1-1 關每格一題（第一題）＋同格另一題（再挑戰用）
const Q = {};
for (const q of BOOK.questions) if (q.level === "m-h-4a-1-1") (Q[q.slot] ??= []).push(q);
const wrongOpt = (q) => Object.keys(q.ob)[0];

const rt = (s) => [{ plain_text: s, text: { content: s } }];
const signed = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));

function makeWorld({ start = "2026-11-20T02:00:00Z", n = 8, calendar = [] } = {}) {
  const clock = { t: Date.parse(start) };
  class FakeDate extends Date {
    constructor(...a) { a.length ? super(...a) : super(clock.t); }
    static now() { return clock.t; }
  }
  // ── 假 Notion ──
  let seq = 0;
  const pages = new Map();
  const add = (ds, properties) => { const id = `pg-${++seq}`; pages.set(id, { ds, properties, created: seq }); return id; };
  const stu = {};
  for (let i = 1; i <= n; i++) stu[i] = add(DS.roster, { 姓名: { title: rt(`學生${i}`) }, 座號: { number: i }, 在學: { checkbox: true }, 學年: { select: { name: "115" } }, 查詢碼: { rich_text: rt(`code${i}`) } });
  const bookPg = add(DS.book, { 代碼: { title: rt("m-h-4a") } });
  const text = (p) => (p?.title || p?.rich_text || []).map((x) => x.plain_text ?? x.text.content).join("");
  const match = (props, f) => {
    if (!f) return true;
    if (f.and) return f.and.every((x) => match(props, x));
    const p = props[f.property];
    if (f.checkbox) return !!p?.checkbox === f.checkbox.equals;
    if (f.select) return p?.select?.name === f.select.equals;
    if (f.number) return p?.number === f.number.equals;
    if (f.title?.equals !== undefined) return text(p) === f.title.equals;
    if (f.title?.contains !== undefined) return text(p).includes(f.title.contains);
    throw new Error("假 Notion 不支援的篩選 " + JSON.stringify(f));
  };
  const norm = (props) => {
    const o = {};
    for (const [k, v] of Object.entries(props)) {
      if (v.title) o[k] = { title: v.title.map((x) => ({ plain_text: x.text.content, text: x.text })) };
      else if (v.rich_text) o[k] = { rich_text: v.rich_text.map((x) => ({ plain_text: x.text.content, text: x.text })) };
      else o[k] = JSON.parse(JSON.stringify(v));
    }
    return o;
  };
  const calls = { notion: 0, writes: 0, n429: 0 };
  const hooks = { onWrite: null, siteDown: false, give429: 0 };
  const resp = (code, data, headers = {}) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(data), getHeaders: () => headers });
  const UrlFetchApp = {
    fetch(url, opts = {}) {
      if (url.startsWith("https://flyshan2010.github.io/")) {
        if (hooks.siteDown) return resp(503, {});
        const path = url.split("/data/")[1];
        if (path === "study-orbit/index.json") return resp(200, INDEX);
        if (path === "study-orbit/m-h-4a.json") return resp(200, BOOK);
        if (path === "study-orbit/s-k-4a.json") return resp(200, { questions: [] });
        if (path === "calendar.json") return resp(200, calendar);
        return resp(404, {});
      }
      calls.notion++;
      const path = url.replace("https://api.notion.com/v1/", ""), body = opts.payload ? JSON.parse(opts.payload) : null;
      if (hooks.give429 > 0 && opts.method !== "get" && path.startsWith("pages")) { hooks.give429--; calls.n429++; return resp(429, {}, { "Retry-After": "2" }); }
      let m;
      if ((m = path.match(/^data_sources\/([^/]+)\/query$/))) {
        const rows = [...pages].filter(([, p]) => p.ds === m[1] && match(p.properties, body.filter)).map(([id, p]) => ({ id, properties: p.properties }));
        return resp(200, { results: rows, has_more: false });
      }
      if (path === "pages" && opts.method === "post") {
        calls.writes++; hooks.onWrite?.(body);
        return resp(200, { id: add(body.parent.data_source_id, norm(body.properties)) });
      }
      if ((m = path.match(/^pages\/(.+)$/))) {
        const pg = pages.get(m[1]); if (!pg) return resp(404, {});
        if (opts.method === "patch") { calls.writes++; hooks.onWrite?.(body); Object.assign(pg.properties, norm(body.properties)); }
        return resp(200, { id: m[1], properties: pg.properties });
      }
      return resp(400, { message: "假 Notion 未實作 " + path });
    },
  };
  // ── 假 Apps Script 服務 ──
  const store = new Map([["PASSWORD", "pw"], ["NOTION_TOKEN", "t"], ["SO_TEST_KEY", TEST_KEY]]);
  const props = {
    getProperty: (k) => (store.has(k) ? store.get(k) : null),
    setProperty: (k, v) => { store.set(k, String(v)); },
    setProperties: (o) => { for (const [k, v] of Object.entries(o)) store.set(k, String(v)); },
    deleteProperty: (k) => { store.delete(k); },
    getProperties: () => Object.fromEntries(store),
  };
  const cacheMap = new Map();
  const cache = {
    get: (k) => { const e = cacheMap.get(k); return e && e.exp > clock.t ? e.v : null; },
    put: (k, v, sec = 600) => { cacheMap.set(k, { v: String(v), exp: clock.t + sec * 1000 }); },
    remove: (k) => { cacheMap.delete(k); },
  };
  const triggers = [];
  const ScriptApp = {
    getOAuthToken: () => "x",
    getProjectTriggers: () => [...triggers],
    deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
    newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {
      const id = "trig-" + (triggers.length + 1) + "-" + clock.t; const t = { getUniqueId: () => id, getHandlerFunction: () => fn };
      triggers.push(t); return t; } }) }) }),
  };
  const tpe = (d) => { const x = new Date(d.getTime() + 8 * 3600e3); const p = (n) => String(n).padStart(2, "0");
    return { yyyy: x.getUTCFullYear(), MM: p(x.getUTCMonth() + 1), dd: p(x.getUTCDate()), HH: p(x.getUTCHours()), mm: p(x.getUTCMinutes()), ss: p(x.getUTCSeconds()) }; };
  const lock = { free: true };
  const ctx = {
    UrlFetchApp, console, Date: FakeDate, ScriptApp,
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => lock.free, waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    Utilities: {
      formatDate: (d, _tz, fmt) => { const t = tpe(d); return fmt.replace(/'T'/, "T").replace("yyyy", t.yyyy).replace("MM", t.MM).replace("dd", t.dd).replace("HH", t.HH).replace("mm", t.mm).replace("ss", t.ss); },
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (_a, s) => signed(createHash("sha256").update(s, "utf8").digest()),
      computeHmacSha256Signature: (v, k) => signed(createHmac("sha256", k).update(v, "utf8").digest()),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => (b + 256) % 256)).toString("base64url"),
      getUuid: () => randomUUID(),
      sleep: (ms) => { clock.t += ms; },
    },
    ContentService: { createTextOutput: (s) => ({ setMimeType() { return s; } }), MimeType: { JSON: "json" } },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }));
  const rowsOf = (ds) => [...pages.values()].filter((p) => p.ds === ds);
  const cell = (seat, book = "m-h-4a") => JSON.parse(store.get(`so:s:${book}:${seat}`) || "null");
  const at = (iso) => { clock.t = Date.parse(iso); };
  const login = (seat, code = `code${seat}`) => post({ action: "so_login", seat, code });
  return { post, ctx, clock, store, cacheMap, pages, stu, bookPg, calls, hooks, triggers, lock, rowsOf, cell, at, login, text, flush: () => ctx.soFlush() };
}

// 一回合作答事件：plan[格-1]＝"g"(首答對)／"f"(首答對但 1 秒)／"h"(用提示答對)／"r"(錯→再挑戰對)／"x"(錯→再挑戰錯)
function round(plan, src = "n", k = "1-1") {
  const ev = [];
  [...plan].forEach((p, i) => {
    const slot = i + 1, q = Q[slot][0], q2 = Q[slot][1] ?? q;
    if (p === "g") ev.push(["a", k, slot, q.id, q.answer, 0, 8, 1]);
    if (p === "f") ev.push(["a", k, slot, q.id, q.answer, 0, 1, 1]);
    if (p === "h") ev.push(["a", k, slot, q.id, q.answer, 1, 8, 1]);
    if (p === "r" || p === "x") {
      ev.push(["a", k, slot, q.id, wrongOpt(q), 0, 8, 1]);
      ev.push(["a", k, slot, q2.id, p === "r" ? q2.answer : wrongOpt(q2), 0, 8, 2]);
    }
  });
  ev.push(["e", k, src]);
  return ev;
}
function session(w, seat, code) {
  const r = w.login(seat, code);
  assert.equal(r.ok, true, JSON.stringify(r));
  const s = { token: r.token, seq: 1 };
  s.pull = (book = "m-h-4a") => w.post({ action: "so_pull", token: s.token, book });
  s.push = (ev, dev = "devA0001", extra = {}) => { const r = w.post({ action: "so_push", token: s.token, book: "m-h-4a", dev, seq0: s.seq, ev, ...extra }); if (r.ok) s.seq += ev.length; return r; };
  return s;
}

// ───────────── 登入與憑證 ─────────────
test("登入：對的回憑證；碼錯與座號不存在回同一句；每分鐘 10 次上限", () => {
  const w = makeWorld();
  const ok = w.login(3);
  assert.equal(ok.ok, true);
  assert.match(ok.token, /^3\.\d+\.[0-9a-f]{8}\.[A-Za-z0-9_-]{22}$/);
  assert.ok(!ok.token.includes("code3"), "憑證不含查詢碼原碼");
  assert.equal(w.login(3, "nope").error, "座號或查詢碼不正確");
  assert.equal(w.login(77, "code77").error, "座號或查詢碼不正確");
  for (let i = 0; i < 10; i++) w.login(5, "bad");
  assert.equal(w.login(5).error, "嘗試太多次，請等一分鐘再試"); // 同一座號第 11 次，連對的碼也擋
  w.clock.t += 61e3;
  assert.equal(w.login(5).ok, true);
  assert.ok(![...w.store.values()].some((v) => v.includes("code3")), "暫存區不存查詢碼");
});

test("憑證：180 天過期；老師換查詢碼後舊憑證失效", () => {
  const w = makeWorld();
  const s = session(w, 3);
  assert.equal(s.pull().ok, true);
  w.pages.get(w.stu[3]).properties.查詢碼 = { rich_text: rt("newcode") };
  assert.equal(w.login(3, "newcode").ok, true); // 指紋不符 → 重讀名冊 → 新碼登入成功
  assert.equal(s.pull().relogin, true, "舊憑證失效");
  const s2 = session(w, 4);
  w.clock.t += 181 * 864e5;
  assert.equal(s2.pull().relogin, true);
});

test("測試座號：只認 SO_TEST_KEY；沒設金鑰就不能登入", () => {
  const w = makeWorld();
  assert.equal(w.login(901, TEST_KEY).ok, true);
  assert.equal(w.login(902, "code902").error, "座號或查詢碼不正確");
  assert.equal(w.login(955, TEST_KEY).error, "座號或查詢碼不正確");
  const s = session(w, 903, TEST_KEY);
  w.store.delete("SO_TEST_KEY");
  assert.equal(s.pull().relogin, true);
});

// ───────────── 上傳與規則 ─────────────
test("上傳前要先 so_pull；全金一回合＝3 星、全對、今日任務與連續天數", () => {
  const w = makeWorld();
  const s = session(w, 3);
  assert.equal(s.push(round("ggggggg")).needPull, true);
  s.seq = 1;
  const p = s.pull();
  assert.equal(p.ver, 0);
  const r = s.push(round("ggggggg"));
  assert.equal(r.ok, true);
  assert.deepEqual(r.sum, { stars: 3, completed: 1, weekly: 3 });
  assert.deepEqual(r.today, { done: 1, of: 3, src: ["n"] });
  assert.equal(r.streak, 1);
  const m = decodeSave(w.cell(3).save);
  assert.deepEqual(m.lv["1-1"], [3, 1, 1]);
  assert.deepEqual(m.sc, ["1-1"]);
});

test("作答過快＝銀燈；提示＝銀燈；錯了發卡、再挑戰對＝已克服", () => {
  const w = makeWorld();
  const s = session(w, 3); s.pull();
  s.push(round("fgggggg"));
  let m = decodeSave(w.cell(3).save);
  assert.deepEqual(m.lv["1-1"], [3, 0, 1], "6 金 1 銀＝3 星但不是全對");
  s.push(round("rgggghh"));
  m = decodeSave(w.cell(3).save);
  const bs = Q[1][0].ob[wrongOpt(Q[1][0])].replace("m-h-4a-", "");
  assert.equal(m.cd[bs][0], "d", "再挑戰答對 → 已克服");
  assert.deepEqual(m.lv["1-1"], [3, 0, 2]);
  s.push(round("xxxxggg"));
  m = decodeSave(w.cell(3).save);
  assert.equal(m.cd[bs][0], "t", "又答錯 → 回到待複習");
  assert.deepEqual(m.lv["1-1"], [3, 0, 3], "重玩只記最高星等");
});

test("同一包重送＝無作用", () => {
  const w = makeWorld();
  const s = session(w, 3); s.pull();
  const ev = round("ggggggg");
  const r1 = s.push(ev);
  const before = w.store.get("so:s:m-h-4a:3"), logBefore = w.store.get(`so:log:2026-11-20:3`);
  s.seq -= ev.length;
  const r2 = s.push(ev);
  assert.equal(r2.ver, r1.ver);
  assert.equal(w.store.get("so:s:m-h-4a:3"), before);
  assert.equal(w.store.get(`so:log:2026-11-20:3`), logBefore);
  // 部分重疊：前半已收、後半新的 → 只收後半
  const ev2 = round("ggggggg");
  s.seq -= 3;
  const r3 = w.post({ action: "so_push", token: s.token, book: "m-h-4a", dev: "devA0001", seq0: s.seq, ev: [...ev.slice(-3), ...ev2] });
  assert.equal(r3.ok, true);
  assert.deepEqual(decodeSave(w.cell(3).save).lv["1-1"], [3, 1, 2]);
});

test("兩台載具交錯送出＝單台依序送出", () => {
  const evs = [...round("gggrggg", "n"), ...round("ghggggx", "f")];
  const one = makeWorld(), two = makeWorld();
  const a = session(one, 3); a.pull(); a.push(evs);
  const b1 = session(two, 3), b2 = session(two, 3); b1.pull();
  // A 台答前 5 筆、B 台接著答、A 台再補完（各自的 seq）
  b1.push(evs.slice(0, 5), "devA0001");
  b2.push(evs.slice(5, 11), "devB0002");
  b1.push(evs.slice(11), "devA0001");
  assert.equal(two.cell(3).save, one.cell(3).save);
  assert.equal(two.store.get("so:sum:m-h-4a"), one.store.get("so:sum:m-h-4a"));
});

test("接續：mid 取 t 大的；結算的關不收舊 mid", () => {
  const w = makeWorld();
  const s = session(w, 3); s.pull();
  s.push([round("ggg")[0]], "devA0001", { mid: { k: "1-1", i: 2, res: "g", q: ["MA4-0001"], t: 100 } });
  s.push([], "devB0002", { mid: { k: "1-1", i: 1, res: "", q: [], t: 50 } });
  assert.equal(decodeSave(w.cell(3).save).mid.i, 2, "舊的 mid 不覆蓋新的");
  const pulled = s.pull();
  assert.equal(JSON.parse(pulled.save).mid.i, 2, "另一台 so_pull 看得到 mid（繼續上次）");
  s.push(round("ggggggg").slice(1), "devA0001", { mid: { k: "1-1", i: 7, res: "ggggggg", q: [], t: 200 } });
  assert.equal(decodeSave(w.cell(3).save).mid, null, "過關就清掉 mid");
});

test("答案鍵讀不到：照收標待判，落地前再判", () => {
  const w = makeWorld();
  const s = session(w, 3); s.pull();
  w.hooks.siteDown = true;
  const r = s.push(round("ggggggg"));
  assert.equal(r.ok, true);
  assert.equal(r.wait, 8);
  assert.equal(r.sum.stars, 0);
  w.flush();
  assert.equal(w.cell(3).wait.length, 8, "還是讀不到 → 不落地也不丟");
  assert.equal(w.rowsOf(DS.prog).length, 0);
  w.hooks.siteDown = false;
  w.clock.t += 60e3; w.flush();
  assert.equal(w.cell(3).wait.length, 0);
  const row = w.rowsOf(DS.prog)[0];
  assert.equal(row.properties.星數.number, 3);
});

// ───────────── 落地 ─────────────
test("落地：自學進度與紀錄建列、再寫只更新同一列；測試座號寫沙盒表", () => {
  const w = makeWorld();
  const s = session(w, 3); s.pull();
  s.push(round("ggggggg"));
  w.flush();
  const prog = w.rowsOf(DS.prog);
  assert.equal(prog.length, 1);
  const p = prog[0].properties;
  assert.equal(w.text(p.標題), "115｜m-h-4a｜03");
  assert.equal(p.學年.select.name, "115");
  assert.equal(p.學生.relation[0].id, w.stu[3]);
  assert.equal(p.題本.relation[0].id, w.bookPg);
  assert.equal(p.星數.number, 3);
  assert.equal(p.存檔版本.number, w.cell(3).ver);
  assert.equal(w.cell(3).dirty, 0);
  const log = w.rowsOf(DS.log);
  assert.equal(log.length, 1);
  assert.equal(w.text(log[0].properties.標題), "2026-11-20｜03");
  assert.equal(w.text(log[0].properties.作答明細).split("\n").length, 7);
  assert.equal(w.text(log[0].properties.回合摘要), "m-h-4a-1-1,3,7,0,0,56,n");
  // 第二回合：1 分鐘後只寫進度，5 分鐘後紀錄接在同一列後面
  s.push(round("rgggggg", "f"));
  w.clock.t += 60e3; w.flush();
  assert.equal(w.rowsOf(DS.prog).length, 1);
  assert.equal(w.text(w.rowsOf(DS.log)[0].properties.回合摘要).split("\n").length, 1, "紀錄每 5 分鐘才寫");
  w.clock.t += 5 * 60e3; w.flush();
  const lg = w.rowsOf(DS.log)[0].properties;
  assert.equal(w.rowsOf(DS.log).length, 1);
  assert.equal(w.text(lg.作答明細).split("\n").length, 15, "0 遺失 0 重複");
  assert.equal(lg.題數.number, 15);
  assert.equal(lg.答對數.number, 14);
  assert.deepEqual(JSON.parse(w.store.get("so:log:2026-11-20:3")).a, [], "已落地的行從暫存區移除");
  // 測試座號
  const t = session(w, 901, TEST_KEY); t.pull(); t.push(round("ggggggg"));
  w.clock.t += 5 * 60e3; w.flush();
  assert.equal(w.rowsOf(DS.progSim).length, 1);
  assert.equal(w.rowsOf(DS.logSim).length, 1);
  assert.equal(w.rowsOf(DS.progSim)[0].properties.學生, undefined);
  assert.equal(w.rowsOf(DS.prog).length, 1, "測試座號不進正式表");
});

test("落地期間又被改過 → 保留 dirty 下一輪再寫；429 照 Retry-After 等後補寫", () => {
  const w = makeWorld();
  const s = session(w, 3); s.pull();
  s.push(round("ggggggg"));
  w.hooks.onWrite = () => { w.hooks.onWrite = null; const c = w.cell(3); c.ver += 1; w.store.set("so:s:m-h-4a:3", JSON.stringify(c)); };
  w.flush();
  assert.equal(w.cell(3).dirty, 1);
  assert.ok(w.cell(3).pid, "頁面 id 已存回");
  w.hooks.give429 = 1;
  w.clock.t += 60e3; w.flush();
  assert.equal(w.calls.n429, 1);
  assert.equal(w.cell(3).dirty, 0);
  assert.equal(w.rowsOf(DS.prog).length, 1);
  assert.equal(w.rowsOf(DS.prog)[0].properties.存檔版本.number, w.cell(3).ver);
  assert.match(w.store.get("so:err"), /429/);
});

test("被逐出的格：so_pull 從 Notion 讀回同一份存檔", () => {
  const w = makeWorld();
  const s = session(w, 3); s.pull();
  s.push(round("ggggggg"));
  w.flush();
  const save = w.cell(3).save, ver = w.cell(3).ver;
  w.store.delete("so:s:m-h-4a:3");
  const p = s.pull();
  assert.equal(p.save, save);
  assert.equal(p.ver, ver);
});

// ───────────── 排行、今日任務、連續天數 ─────────────
test("排行：同分 1、1、3；只回前 5 名＋本人；測試座號不進正式榜", () => {
  const w = makeWorld();
  const plans = { 1: "ggggggg", 2: "ggggggg", 3: "ggggghh", 4: "gggghhx", 5: "ggghxxx", 6: "ggxxxxx", 7: "gxxxxxx", 8: "gxxxxxx" };
  for (const [seat, plan] of Object.entries(plans)) { const s = session(w, Number(seat)); s.pull(); s.push(round(plan)); }
  const t = session(w, 901, TEST_KEY); t.pull(); t.push(round("ggggggg"));
  const me = session(w, 8);
  const r = w.post({ action: "so_rank", token: me.token, scope: "all", metric: "stars" });
  assert.deepEqual(r.top.map((x) => [x.seat, x.rank, x.value]), [[1, 1, 3], [2, 1, 3], [3, 3, 2], [4, 3, 2], [5, 5, 1]]);
  assert.deepEqual([r.me.rank, r.me.value], [6, 0]);
  assert.equal(r.catchUp, 1);
  assert.ok(!r.top.some((x) => x.seat === 901));
  const rs = w.post({ action: "so_rank", token: t.token, scope: "數學", metric: "weekly" });
  assert.deepEqual(rs.top.map((x) => x.seat), [901], "測試座號只和測試座號比");
  assert.equal(w.post({ action: "so_rank", token: me.token, scope: "all", metric: "x" }).ok, false);
  // 換週：本週星數歸零
  w.at("2026-11-23T02:00:00Z");
  const r2 = w.post({ action: "so_rank", token: me.token, scope: "all", metric: "weekly" });
  assert.ok(r2.top.every((x) => x.value === 0));
});

test("今日任務：一回合一件，做完 3／3 不再加", () => {
  const w = makeWorld();
  const s = session(w, 3); s.pull();
  s.push(round("ggggggg", "r")); s.push(round("ggggggg", "n")); s.push(round("ggggggg", "n"));
  let r = s.push(round("ggggggg", "f"));
  assert.deepEqual(r.today, { done: 3, of: 3, src: ["r", "n", "f"] });
  r = s.push(round("ggggggg", ""));
  assert.equal(r.today.done, 3);
  w.at("2026-11-21T02:00:00Z");
  assert.equal(s.pull().today.done, 0, "隔天重算");
});

test("連續自學天數：週末與停課日沒玩不中斷，上課日沒玩就斷", () => {
  const w = makeWorld({ start: "2026-11-20T02:00:00Z", calendar: [{ title: "停課", date: "2026-11-24", endDate: "", type: "放假" }] });
  const s = session(w, 3); s.pull();
  s.push(round("ggggggg"));                         // 11/20 五
  w.at("2026-11-23T02:00:00Z");                      // 11/23 一（隔週末）
  assert.equal(s.pull().streak, 1);
  assert.equal(s.push(round("ggggggg")).streak, 2);
  w.at("2026-11-25T02:00:00Z");                      // 11/25 三（11/24 停課）
  assert.equal(s.push(round("ggggggg")).streak, 3);
  w.at("2026-11-27T02:00:00Z");                      // 11/27 五（11/26 四沒玩）
  assert.equal(s.pull().streak, 0);
  assert.equal(s.push(round("ggggggg")).streak, 1);
});

test("複習卡冊：待複習答對→已克服；滿 7 天再對→結案；不影響星等", () => {
  const w = makeWorld();
  const s = session(w, 3); s.pull();
  s.push(round("xgggggg"));
  const q = Q[1][0], bs = q.ob[wrongOpt(q)].replace("m-h-4a-", "");
  const before = decodeSave(w.cell(3).save).lv["1-1"];
  s.push([["c", bs, q.id, q.answer, 6]]);
  assert.equal(decodeSave(w.cell(3).save).cd[bs][0], "d");
  w.clock.t += 3 * 864e5;
  s.push([["c", bs, q.id, q.answer, 6]]);
  assert.equal(decodeSave(w.cell(3).save).cd[bs][0], "d", "還沒滿 7 天不結案");
  w.clock.t += 4 * 864e5;
  const r = s.push([["c", bs, q.id, q.answer, 6]]);
  const m = decodeSave(w.cell(3).save);
  assert.ok(m.ok.includes(bs) && !m.cd[bs], "結案");
  assert.deepEqual(m.lv["1-1"], before);
  assert.equal(r.today.src[0], "r");
});

// ───────────── 暫存區護欄與觸發器 ─────────────
test("總量護欄：超過 400KB 先刪已落地且最久沒動的格，降到 300KB 以下；未落地的不動", () => {
  const w = makeWorld();
  const pad = "x".repeat(8000);
  for (let i = 0; i < 60; i++) w.store.set(`so:s:m-h-4a:${100 + i}`, JSON.stringify({ save: pad, ver: 1, dirty: i % 10 === 0 ? 1 : 0, ds: {}, at: 1000 + i }));
  w.store.set("so:trig", JSON.stringify({ id: "x", lastWork: w.clock.t, lastLog: w.clock.t, clean: "2026-11-20" }));
  w.store.set("NOTION_TOKEN", ""); // 只測護欄
  w.flush();
  const left = [...w.store.keys()].filter((k) => k.startsWith("so:s:")).map((k) => Number(k.split(":")[3]));
  const bytes = [...w.store].reduce((n, [k, v]) => n + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
  assert.ok(bytes < 300 * 1024, `剩 ${bytes}`);
  for (let i = 0; i < 60; i += 10) assert.ok(left.includes(100 + i), "未落地的格保留");
  const kept = left.filter((s) => (s - 100) % 10);
  assert.ok(Math.min(...kept) > Math.max(...[...Array(60).keys()].map((i) => 100 + i).filter((s) => (s - 100) % 10 && !left.includes(s))), "先刪最久沒動的");
});

test("觸發器：上傳時沒有就建；過 17:00 落地完自刪；沒工作 10 分鐘自刪", () => {
  const w = makeWorld();
  const s = session(w, 3); s.pull();
  s.push(round("ggggggg"));
  assert.equal(w.triggers.length, 1);
  s.push(round("ggggggg"));
  assert.equal(w.triggers.length, 1, "不重複建");
  w.flush();
  assert.equal(w.triggers.length, 1, "上課時間、剛有工作 → 留著");
  for (let i = 0; i < 9; i++) { w.clock.t += 60e3; w.flush(); }
  assert.equal(w.triggers.length, 1);
  w.clock.t += 2 * 60e3; w.flush();
  assert.equal(w.triggers.length, 0, "沒工作 10 分鐘 → 自刪");
  // 17:00 後：有工作先落地，落地完才刪
  w.at("2026-11-20T09:30:00Z"); // 臺北 17:30
  w.cacheMap.clear();
  s.push(round("ggggggg"));
  assert.equal(w.triggers.length, 1, "下課後學生上傳 → 再建");
  w.flush();
  assert.equal(w.triggers.length, 0, "落地完、過 17:00 → 自刪");
  assert.equal(w.cell(3).dirty, 0);
});

test("so_test_clear：只清測試座號的暫存區；dry 回用量", () => {
  const w = makeWorld();
  const a = session(w, 3); a.pull(); a.push(round("ggggggg"));
  const t = session(w, 901, TEST_KEY); t.pull(); t.push(round("ggggggg"));
  assert.equal(w.post({ action: "so_test_clear", testKey: "bad" }).ok, false);
  const d = w.post({ action: "so_test_clear", testKey: TEST_KEY, dry: true });
  assert.ok(d.usage.bytes > 0 && d.usage.soBytes > 0);
  const r = w.post({ action: "so_test_clear", testKey: TEST_KEY });
  assert.equal(r.ok, true);
  assert.ok(![...w.store.keys()].some((k) => /:901$/.test(k)));
  assert.ok(!JSON.parse(w.store.get("so:sum:m-h-4a"))["901"]);
  assert.ok(w.cell(3), "正式座號不動");
  assert.ok(r.after.bytes < r.before.bytes);
});

test("暫停開關、鎖拿不到、版本號", () => {
  const w = makeWorld();
  assert.equal(w.post({ action: "version" }).version, "2.21");
  const s = session(w, 3); s.pull();
  w.lock.free = false;
  const busy = s.push(round("ggggggg"));
  assert.equal(busy.retry, true);
  w.lock.free = true;
  w.store.set("SO_PAUSED", "1");
  assert.equal(w.login(3).paused, true);
});

test("配合題：一對一筆事件逐對判；配錯的對發卡、一題最多兩張；再挑戰只算原本錯的對", () => {
  const w = makeWorld(), c = w.ctx;
  // 判題：整題（卡冊送整串）與單一對（闖關一對一筆）
  assert.equal(c.soJudge_("1B,2D,3A,4C", "1B,2D,3A,4C"), true);
  assert.equal(c.soJudge_("1B,2D,3A,4C", "1B,2D,3C,4A"), false);
  assert.equal(c.soJudge_("1B,2D,3A,4C", "2D"), true);
  assert.equal(c.soJudge_("1B,2D,3A,4C", "3C"), false);
  const ob = { 1: "1-1-B1", 2: "1-1-B2", 3: "1-1-B3", 4: "1-1-B4" };
  assert.deepEqual([...c.soWrongBs_("1B,2D,3A,4C", "3C", ob)], ["1-1-B3"]);
  assert.deepEqual([...c.soWrongBs_("1B,2D,3A,4C", "2D", ob)], []);
  assert.deepEqual([...c.soWrongBs_("1B,2D,3A,4C", "1A,2B,3A,4C", ob)], ["1-1-B1", "1-1-B2"]);
  // 折算：配合題占 1–4 格，第 1、3、4 對配錯 → 只發兩張；再挑戰第 1、3、4 對換另一題，答對 1、3
  const ak = { M1: ["1B,2D,3A,4C", ob], M2: ["1C,2A,3D,4B", ob] };
  for (let s = 5; s <= 7; s++) ak["X" + s] = ["A", {}];
  const cell = { save: c.encodeSave(c.decodeSave(null)), ds: {}, ver: 0 };
  const me = { today: { done: [] }, streak: 0, last: "" };
  const ev = [["a", "1-1", 1, "M1", "1A", 0, 9, 1], ["a", "1-1", 2, "M1", "2D", 0, 9, 1], ["a", "1-1", 3, "M1", "3B", 0, 9, 1], ["a", "1-1", 4, "M1", "4D", 0, 9, 1],
    ["a", "1-1", 1, "M2", "1C", 0, 9, 2], ["a", "1-1", 3, "M2", "3D", 0, 9, 2], ["a", "1-1", 4, "M2", "4A", 0, 9, 2]];
  for (let s = 5; s <= 7; s++) ev.push(["a", "1-1", s, "X" + s, "A", 0, 9, 1]);
  c.soFold_(cell, "m-h-4a", ev, ak, me, "2026-11-20");
  assert.equal(cell.rr.L, "sgsxggg"); // 第 2 對第一次就對＝金；1、3 再挑戰對＝銀；4 再挑戰又錯＝不亮
  const m = decodeSave(cell.save);
  assert.deepEqual(Object.keys(m.cd).sort(), ["1-1-B1", "1-1-B3"]); // 只發兩張（第 4 對的卡被上限擋掉）
  assert.deepEqual(m.cd["1-1-B1"][0], "d"); // 再挑戰對＝已克服
  assert.deepEqual(m.cd["1-1-B3"][0], "d");
});

test("代理的 rules 區塊＝rules.mjs 正本（不准手改）", () => {
  const { current, block } = build();
  assert.equal(current, block);
});
