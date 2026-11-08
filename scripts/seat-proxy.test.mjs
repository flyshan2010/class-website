// 執行：node --test scripts/seat-proxy.test.mjs
// 代理 v2.16 seat_get／seat_apply 的本機模擬（SPEC_座位編排.md §6）：
// 把 apps-script-proxy-v2.gs 原樣載入 vm，UrlFetchApp 換成記憶體裡的假 Notion，從 doPost 進去跑，不碰真資料。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("./apps-script-proxy-v2.gs", import.meta.url), "utf8");
const DS = { roster: "ad232b7a-c7f8-4a68-b224-5b2d5b16599a", settings: "166cce91-e6f1-456e-9275-097d71207b9b", cond: "a98130b0-26ff-4599-b830-83aaa8049fe0" };

const rt = s => [{ plain_text: s, text: { content: s } }];
const sel = s => ({ select: s ? { name: s } : null });

function makeWorld({ today = "2026-11-07", n = 6, gridEdited = "2026-10-01T02:00:00.000Z" } = {}) {
  let seq = 0;
  const pages = new Map();                                     // id → { ds, properties }
  const add = (ds, properties, edited) => { const id = `pg-${++seq}`; pages.set(id, { ds, properties, edited, created: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z` }); return id; };
  const stu = {};
  for (let i = 1; i <= n; i++)
    stu[i] = add(DS.roster, { 姓名: { title: rt(`學生${i}`) }, 座號: { number: i }, 性別: sel(i % 2 ? "男" : "女"), 在學: { checkbox: true }, 學年: sel("115") });
  add(DS.roster, { 姓名: { title: rt("轉出生") }, 座號: { number: 99 }, 性別: sel("男"), 在學: { checkbox: false }, 學年: sel("115") });
  const gridId = add(DS.settings, { 項目: { title: rt("座位表") }, 內容: { rich_text: rt("1,2,3\n4,5,6") } }, gridEdited);
  add(DS.settings, { 項目: { title: rt("座位表（九月）") }, 內容: { rich_text: rt("6,5,4\n3,2,1") } });
  add(DS.settings, { 項目: { title: rt("學年度") }, 內容: { rich_text: rt("115學年度") } });
  const calls = { writes: 0, dispatch: 0 };

  const match = (props, f) => {
    if (!f) return true;
    if (f.and) return f.and.every(x => match(props, x));
    const p = props[f.property];
    if (f.checkbox) return !!p?.checkbox === f.checkbox.equals;
    if (f.select) return p?.select?.name === f.select.equals;
    if (f.number) return p?.number === f.number.equals;
    if (f.title) return (p?.title || []).map(x => x.plain_text).join("").startsWith(f.title.starts_with);
    throw new Error("假 Notion 不支援的篩選 " + JSON.stringify(f));
  };
  // 寫入時把 text.content 補成 plain_text（真 Notion 回傳的樣子）
  const norm = props => {
    const o = {};
    for (const [k, v] of Object.entries(props)) {
      if (v.title) o[k] = { title: v.title.map(x => ({ plain_text: x.text.content, text: x.text })) };
      else if (v.rich_text) o[k] = { rich_text: v.rich_text.map(x => ({ plain_text: x.text.content, text: x.text })) };
      else o[k] = JSON.parse(JSON.stringify(v));
    }
    return o;
  };
  const resp = (code, data) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(data) });
  const UrlFetchApp = {
    fetch(url, opts) {
      if (url.includes("api.github.com")) { calls.dispatch++; return resp(204, {}); }
      const path = url.replace("https://api.notion.com/v1/", ""), body = opts.payload ? JSON.parse(opts.payload) : null;
      let m;
      if ((m = path.match(/^data_sources\/([^/]+)\/query$/))) {
        const rows = [...pages].filter(([, p]) => p.ds === m[1] && match(p.properties, body.filter)).map(([id, p]) => ({ id, properties: p.properties, ...(p.edited ? { last_edited_time: p.edited } : {}), created_time: p.created }));
        return resp(200, { results: rows, has_more: false });
      }
      if (path === "pages" && opts.method === "post") {
        calls.writes++;
        return resp(200, { id: add(body.parent.data_source_id, norm(body.properties)) });
      }
      if ((m = path.match(/^pages\/(.+)$/))) {
        const pg = pages.get(m[1]); if (!pg) return resp(404, {});
        if (opts.method === "patch") { calls.writes++; Object.assign(pg.properties, norm(body.properties)); pg.edited = `${today}T03:00:00.000Z`; }
        return resp(200, { id: m[1], properties: pg.properties });
      }
      return resp(400, { message: "假 Notion 未實作 " + path });
    },
  };
  const [Y, M, D] = today.split("-");
  const ctx = {
    UrlFetchApp, console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ PASSWORD: "pw", NOTION_TOKEN: "t", GH_TOKEN: "g" })[k] ?? null }) },
    Utilities: { formatDate: (_d, _tz, fmt) => fmt.replace("yyyy", Y).replace("MM", M).replace("dd", D).replace(/'T'HH:mm:ss/, "T00:00:00").replace("HHmmss", "000000") },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: { createTextOutput: s => ({ setMimeType() { return s; } }), MimeType: { JSON: "json" } },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ pw: "pw", ...body }) } }));
  const items = ds => [...pages.values()].filter(p => p.ds === ds);
  const text = p => (p.title || p.rich_text || []).map(x => x.plain_text).join("");
  const grid = () => text(pages.get(gridId).properties.內容);
  const conds = (status = "有效") => items(DS.cond).filter(p => p.properties.狀態.select.name === status).map(p => text(p.properties.名稱.title ? p.properties.名稱 : {})).sort();
  return { post, pages, stu, calls, items, text, grid, conds, ctx, add };
}

const GOOD = "3,1,2\n6,4,5";

test("口令錯誤擋下", () => {
  const w = makeWorld();
  assert.equal(JSON.parse(w.ctx.doPost({ postData: { contents: JSON.stringify({ action: "seat_get", pw: "x" }) } })).error, "口令錯誤");
});

test("seat_get：只回現行學年在學生、座位表、有效條件（對不到人的列進 skipped）", () => {
  const w = makeWorld();
  w.add(DS.cond, { 名稱: { title: rt("座號1 易分心") }, 學生: { relation: [{ id: w.stu[1] }] }, 條件: sel("易分心"), 狀態: sel("有效"), 學年: sel("115") });
  w.add(DS.cond, { 名稱: { title: rt("座號2↔3 愛聊天") }, 學生: { relation: [{ id: w.stu[2] }] }, 對象: { relation: [{ id: w.stu[3] }] }, 條件: sel("愛聊天"), 狀態: sel("有效"), 學年: sel("115") });
  w.add(DS.cond, { 名稱: { title: rt("座號4 身高高") }, 學生: { relation: [{ id: w.stu[4] }] }, 條件: sel("身高高"), 狀態: sel("已取消"), 學年: sel("115") });
  w.add(DS.cond, { 名稱: { title: rt("座號5 小老師") }, 學生: { relation: [{ id: w.stu[5] }] }, 條件: sel("小老師"), 狀態: sel("有效"), 學年: sel("114") });
  w.add(DS.cond, { 名稱: { title: rt("沒填學生") }, 學生: { relation: [] }, 條件: sel("易分心"), 狀態: sel("有效"), 學年: sel("115") });
  const r = w.post({ action: "seat_get" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.students.map(s => s.seat), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(r.students[0], { seat: 1, name: "學生1", sex: "男" });
  assert.equal(r.grid, "1,2,3\n4,5,6");
  assert.deepEqual(r.conditions, [{ seat: 1, kind: "distract" }, { seat: 2, kind: "chat", other: 3 }]);
  assert.deepEqual(r.skipped, ["沒填學生"]);
});

test("seat_apply：封存舊表成「座位表（十月）2026-10-01-1000」（開始使用時間）、寫新表、建條件、觸發同步", () => {
  const w = makeWorld();
  const r = w.post({ action: "seat_apply", grid: GOOD, conditions: [{ seat: 1, kind: "tutor" }, { seat: 2, kind: "conflict", other: 5 }] });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.archived, "座位表（十月）2026-10-01-1000");
  assert.deepEqual([r.added, r.cancelled], [2, 0]);
  assert.equal(r.sync.ok, true); assert.equal(w.calls.dispatch, 1);
  assert.equal(w.grid(), GOOD);
  const arc = w.items(DS.settings).find(p => w.text(p.properties.項目) === "座位表（十月）2026-10-01-1000");
  assert.equal(w.text(arc.properties.內容), "1,2,3\n4,5,6");
  assert.match(w.text(arc.properties.說明), /^【封存・不公布】115 學年十月座位表（2026-11-07/);
  const rows = w.items(DS.cond);
  assert.deepEqual(rows.map(p => w.text(p.properties.名稱)).sort(), ["座號1 小老師", "座號2↔5 易衝突"]);
  const pair = rows.find(p => w.text(p.properties.名稱) === "座號2↔5 易衝突").properties;
  assert.deepEqual([pair.學生.relation[0].id, pair.對象.relation[0].id, pair.學年.select.name, pair.狀態.select.name], [w.stu[2], w.stu[5], "115", "有效"]);

  // 同內容再送一次：不再封存、條件不重建
  const r2 = w.post({ action: "seat_apply", grid: GOOD, conditions: [{ seat: 1, kind: "tutor" }, { seat: 5, kind: "conflict", other: 2 }] });
  assert.equal(r2.ok, true, r2.error);
  assert.deepEqual([r2.archived, r2.added, r2.cancelled], [null, 0, 0]);
  assert.equal(w.items(DS.cond).length, 2);
});

test("seat_apply：同一對換條件＝舊列改已取消＋建新列；拿掉的條件改已取消（不刪列）", () => {
  const w = makeWorld();
  w.post({ action: "seat_apply", grid: GOOD, conditions: [{ seat: 1, kind: "tutor" }, { seat: 2, kind: "chat", other: 3 }] });
  const r = w.post({ action: "seat_apply", grid: GOOD, conditions: [{ seat: 3, kind: "pos", other: 2 }] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.added, r.cancelled], [1, 2]);
  assert.equal(w.items(DS.cond).length, 3);
  const st = Object.fromEntries(w.items(DS.cond).map(p => [w.text(p.properties.名稱), p.properties.狀態.select.name]));
  assert.deepEqual(st, { "座號1 小老師": "已取消", "座號2↔3 愛聊天": "已取消", "座號3↔2 能互助": "有效" });
});

test("封存名已存在就加（2）；讀不到編輯時間才退回上個月（1 月→十二月）", () => {
  const w = makeWorld({ today: "2026-10-01", gridEdited: "2026-09-01T01:00:00.000Z" });   // 現行表九月寫入，已有「座位表（九月）」
  w.add(DS.settings, { 項目: { title: rt("座位表（九月）2026-09-01-0900") }, 內容: { rich_text: rt("6,5,4\n3,2,1") } });   // 同名同時間才加（2）
  assert.equal(w.post({ action: "seat_apply", grid: GOOD, conditions: [] }).archived, "座位表（九月）2026-09-01-0900（2）");
  assert.equal(w.ctx.seatArchiveName_(w.ctx.seatArchiveMonth_({ edited: "" }, "2027-01-04"), []), "座位表（十二月）");
  assert.equal(w.ctx.seatArchiveMonth_({ edited: "2026-10-31T16:30:00.000Z" }, "2026-12-01").label, "十一月");   // UTC 10/31 晚上＝臺北 11/1
  assert.deepEqual(JSON.parse(JSON.stringify(w.ctx.seatPrevMonth_("2026-08-03"))), { label: "七月", year: "114" });
});

for (const [name, body, re] of [
  ["健康類 front 整筆拒絕", { grid: GOOD, conditions: [{ seat: 1, kind: "tutor" }, { seat: 2, kind: "front" }] }, /不能存雲端/],
  ["不認得的代碼整筆拒絕", { grid: GOOD, conditions: [{ seat: 1, kind: "health" }] }, /不能存雲端/],
  ["人數不符", { grid: "1,2,3\n4,5,-", conditions: [] }, /5 人，名冊 6 人（沒排到：座號6）/],
  ["座號重複", { grid: "1,2,3\n4,5,5", conditions: [] }, /座號5 重複/],
  ["座號不在名冊（含轉出生）", { grid: "1,2,3\n4,5,99", conditions: [] }, /座號99 不在名冊/],
  ["不是座號", { grid: "1,2,3\n4,5,x", conditions: [] }, /不是座號/],
  ["條件對象不在名冊", { grid: GOOD, conditions: [{ seat: 1, kind: "chat", other: 42 }] }, /不在名冊/],
  ["和自己配對", { grid: GOOD, conditions: [{ seat: 1, kind: "chat", other: 1 }] }, /和自己/],
  ["個人狀況帶對象", { grid: GOOD, conditions: [{ seat: 1, kind: "tall", other: 2 }] }, /不用填對象/],
]) {
  test(`seat_apply 驗格式失敗＝什麼都不寫：${name}`, () => {
    const w = makeWorld();
    const r = w.post({ action: "seat_apply", ...body });
    assert.equal(r.ok, false);
    assert.match(r.error, re);
    assert.match(r.error, /沒有寫入任何東西/);
    assert.equal(w.calls.writes, 0); assert.equal(w.calls.dispatch, 0);
    assert.equal(w.grid(), "1,2,3\n4,5,6");
  });
}

test("version 免口令，只回版本號", () => {
  const w = makeWorld();
  assert.deepEqual(JSON.parse(w.ctx.doPost({ postData: { contents: JSON.stringify({ action: "version" }) } })), { ok: true, version: w.ctx.PROXY_VERSION ?? "2.19" });
});

test("老師 11/08 回報：同月再微調，封存名用現行座位寫入的月份（十一月），不是上個月", () => {
  const w = makeWorld({ today: "2026-11-08", gridEdited: "2026-11-07T17:26:00.000Z" });   // 臺北 11/08 01:26 套用的座位
  w.add(DS.settings, { 項目: { title: rt("座位表（十月）") }, 內容: { rich_text: rt("6,5,4\n3,2,1") } });
  const g = w.post({ action: "seat_get" });
  assert.equal(g.archivePreview, "座位表（十一月）2026-11-08-0126");
  assert.deepEqual(g.archives.map(a => a.name), ["座位表（十月）", "座位表（九月）"]);   // 新→舊（依建立時間），不含現行「座位表」
  assert.equal(g.archives[1].grid, "6,5,4\n3,2,1");
  const r = w.post({ action: "seat_apply", grid: GOOD, conditions: [] });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.archived, "座位表（十一月）2026-11-08-0126");
  const arc = w.items(DS.settings).find(p => w.text(p.properties.項目) === "座位表（十一月）2026-11-08-0126");
  assert.match(w.text(arc.properties.說明), /^【封存・不公布】115 學年十一月座位表（2026-11-08/);
  // 同月再改一次：剛寫入的時間（假 Notion 記成臺北 11:00）
  assert.equal(w.post({ action: "seat_apply", grid: "1,2,3\n4,5,6", conditions: [] }).archived, "座位表（十一月）2026-11-08-1100");
});

test("12 月換新：現行表 11 月寫入 → 封存成十一月", () => {
  const w = makeWorld({ today: "2026-12-01", gridEdited: "2026-11-08T05:00:00.000Z" });
  assert.equal(w.post({ action: "seat_apply", grid: GOOD, conditions: [] }).archived, "座位表（十一月）2026-11-08-1300");
});
