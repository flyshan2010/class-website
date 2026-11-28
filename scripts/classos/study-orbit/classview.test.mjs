// 執行：node --test scripts/classos/study-orbit/classview.test.mjs
// 教師專區彙整（P3 SPEC §4.3）：小 fixture（2 本、4 位）→ 每個 KPI、熱圖格、盲點 Top5、這週需要您看的事，對照下方手算答案。
// 手算日期：今天 2026-12-02（週三），本週起算日 2026-11-30，上週 11-23～11-29。
import { test } from "node:test";
import assert from "node:assert/strict";
import { classView, studentView, cvIslandState, cvIslands } from "./classview.mjs";

const day = (s) => Math.round((Date.parse(s + "T00:00:00Z") - Date.UTC(2026, 0, 1)) / 864e5);
const TODAY = "2026-12-02";
// 數學：兩座虛擬島心（1-0、2-0）；國語：第 2 關「評量複習」＝島心
const BOOKS = [
  { code: "m-x", subject: "數學", structure: { islands: [
    { id: "1", name: "一", levels: [{ code: "m-x-1-1", name: "a" }, { code: "m-x-1-2", name: "b" }] },
    { id: "2", name: "二", levels: [{ code: "m-x-2-1", name: "c" }] }] } },
  { code: "c-x", subject: "國語", structure: { islands: [
    { id: "1", name: "課一", levels: [{ code: "c-x-1-1", name: "字詞" }, { code: "c-x-1-2", name: "課一・評量複習" }] }] } },
];
const v1 = (lv, cd = {}, ok = []) => ({ v: 1, lv, cd, ok, sc: [] });
const SAVES = {
  "m-x": {
    1: v1({ "1-1": [3, 1, 1], "1-2": [2, 0, 1], "1-0": [3, 1, 1], "2-1": [0, 0, 2] }, { "2-1-B1": ["t", "2026-12-01"] }),
    2: v1({ "1-1": [1, 0, 3], "1-2": [1, 0, 1], "2-1": [0, 0, 3] },
      { "2-1-B1": ["t", "2026-11-29"], "1-1-B2": ["d", "2026-11-20"], "1-2-B1": ["d", "2026-11-25"], "1-1-B3": ["d", "2026-11-26"] }),
    3: JSON.stringify(v1({ "2-1": [0, 0, 2] },
      { "2-1-B1": ["t", "2026-11-30"], "1-1-B2": ["d", "2026-11-01"], "1-1-B4": ["d", "2026-11-02"], "1-2-B1": ["d", "2026-11-03"] })),
    4: v1({ "1-1": [0, 0, 1] }),
  },
  "c-x": {
    1: v1({ "1-1": [1, 0, 1] }),
    3: v1({ "1-1": [3, 1, 1], "1-2": [3, 1, 2] }, { "1-1-B1": ["t", "2026-12-02"] }),
  },
};
const MES = {
  1: { days: ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-30", "2026-12-01", "2026-12-02"].map(day), cw: ["2026-11-30", 4, 3], wr: ["2026-11-30", 5, 2], streak: 6 },
  2: { days: ["2026-11-24", "2026-11-27"].map(day), cw: ["2026-11-23", 9, 9], wr: ["2026-11-30", 1, 0], streak: 0 },
  3: { days: [day("2026-12-01")], cw: ["2026-11-30", 1, 0], streak: 1 },
};
const V = classView({ books: BOOKS, seats: [4, 3, 2, 1], saves: SAVES, mes: MES, today: TODAY });

test("KPI：本週 ≥3 天、全班亮度、卡關星、到期複習答對率（手算）", () => {
  assert.equal(V.weekStart, "2026-11-30");
  assert.equal(V.n, 4);
  assert.deepEqual(V.kpi.week3, { n: 1, of: 4 });
  assert.deepEqual(V.kpi.bright, { lit: 8, of: 28, pct: 29 }, "7 關（含虛擬島心）× 4 人；8／28＝28.57%");
  assert.deepEqual(V.kpi.stuck, { n: 1, levels: [{ book: "m-x", key: "2-1", n: 3 }] }, "座號 4 的 1-1 只試 1 次不算卡關");
  assert.deepEqual(V.kpi.due, { pass: 3, tries: 5, pct: 60 }, "座號 2 的 cw 是上週的，不算");
});

test("熱圖：島格五色與每關格（依座號排）", () => {
  const m = V.heat[0], c = V.heat[1];
  assert.deepEqual(m.keys, ["1-1", "1-2", "1-0", "2-1", "2-0"]);
  assert.deepEqual(m.rows, { 1: [4, 1], 2: [2, 1], 3: [0, 1], 4: [1, 0] });
  assert.deepEqual(m.detail, { 1: [3, 2, 3, 0, -1], 2: [1, 1, -1, 0, -1], 3: [-1, -1, -1, 0, -1], 4: [0, -1, -1, -1, -1] });
  assert.deepEqual(c.keys, ["1-1", "1-2"]);
  assert.deepEqual(c.rows, { 1: [2], 2: [0], 3: [4], 4: [0] });
  assert.deepEqual(c.detail, { 1: [1, -1], 2: [-1, -1], 3: [3, 3], 4: [-1, -1] });
  assert.deepEqual(c.islands[0], { id: "1", name: "課一", keys: ["1-1"], core: "1-2", virtual: false });
});

test("盲點 Top5：本週拿到、還沒克服；上週的不算", () => {
  assert.deepEqual(V.bsTop, [{ code: "m-x-2-1-B1", n: 2 }, { code: "c-x-1-1-B1", n: 1 }]);
});

test("這週需要您看的事：照順序、最多 5 句；練習使用量", () => {
  assert.deepEqual(V.todo, [
    { t: "zero", seats: [2] },
    { t: "stuck", book: "m-x", key: "2-1", n: 3 },
    { t: "bs", code: "m-x-2-1-B1", n: 2 },
    { t: "due", seats: [{ seat: 3, n: 3 }] },
    { t: "streak", seats: [1] },
  ]);
  assert.deepEqual(V.usage, { after: 6, core: 2, tower: 0 });
  assert.equal(V.tower, null, "沒有人玩過塔＝整塊不顯示");
  assert.deepEqual(V.week[1], { days: [true, true, true, false, false, false, false], n: 3, streak: 6, due: 0 });
  assert.deepEqual(V.week[4], { days: [false, false, false, false, false, false, false], n: 0, streak: 0, due: 0 });
});

test("分母為 0：沒有到期卡 pct＝null；沒有學生亮度 0；壞存檔當空檔", () => {
  const e = classView({ books: BOOKS, seats: [], saves: {}, mes: {}, today: TODAY });
  assert.equal(e.kpi.due.pct, null);
  assert.equal(e.kpi.bright.pct, 0);
  const bad = classView({ books: BOOKS, seats: [1], saves: { "m-x": { 1: "{壞掉" } }, mes: {}, today: TODAY });
  assert.deepEqual(bad.heat[0].rows[1], [0, 0]);
});

test("島格：寶箱舊條件（每關都曾全金）也算島心全金；虛擬島心沒玩不算全過", () => {
  const isl = cvIslands(BOOKS[0])[0];
  assert.equal(cvIslandState(isl, { "1-1": [3, 1, 1], "1-2": [3, 1, 1] }), 4, "舊條件：各關都曾全金＝寶箱開（不含虛擬島心）");
  assert.equal(cvIslandState(isl, { "1-1": [3, 1, 1], "1-2": [3, 0, 1] }), 2, "缺虛擬島心 1-0 不算全過");
  const c = cvIslands(BOOKS[1])[0];
  assert.equal(cvIslandState(c, { "1-1": [3, 1, 1], "1-2": [2, 0, 1] }), 3);
});

test("個人頁：卡冊三種狀態、本週七天、練習回合；回覆沒有姓名或查詢碼欄位", () => {
  const s = studentView({ books: BOOKS, seat: 2, saves: { "m-x": SAVES["m-x"][2] }, me: MES[2], today: TODAY });
  assert.deepEqual(s.books[0].cards.map((c) => [c.code, c.st]), [
    ["m-x-1-1-B2", "due"], ["m-x-1-1-B3", "wait"], ["m-x-1-2-B1", "due"], ["m-x-2-1-B1", "todo"]]);
  assert.deepEqual(s.books[0].islands[0].cells, [1, 1]);
  assert.equal(s.books[0].islands[0].coreCell, -1);
  assert.equal(s.books[1].islands[0].state, 0);
  assert.equal(s.weekN, 0);
  assert.deepEqual(s.usage, { after: 1, core: 0, tower: 0 });
  assert.deepEqual(s.due, { pass: 0, tries: 0 }, "上週的 cw 歸零");
  const txt = JSON.stringify([s, V]);
  assert.equal(/姓名|查詢碼|"name":"學生/.test(txt), false);
});
