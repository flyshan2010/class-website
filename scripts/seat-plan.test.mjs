// 執行：node --test scripts/seat-plan.test.mjs
// 座位編排共用計算程式（assets/js/seat-plan-core.js）——SPEC_座位編排.md §8
// 示意資料取自範本 `座位編排建議_精簡版.html`（全為虛構，只有座號、性別、標籤）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseGrid, formatGrid, evaluate, optimize, prepare } = require("../assets/js/seat-plan-core.js");

// ── 示意資料 ─────────────────────────────────────────
const SEX = "男女女男男女男女男女女男男女男女男女女男男女男女男男女";
const INIT = { 4: ["front"], 15: ["front"], 22: ["front"], 11: ["front"], 9: ["tall"], 18: ["tall"], 26: ["tall"],
  7: ["distract"], 13: ["distract"], 20: ["distract"], 12: ["distract", "needhelp"], 5: ["needhelp"], 21: ["needhelp"],
  2: ["tutor"], 10: ["tutor"], 16: ["tutor"], 24: ["tutor"] };
const CURRENT = `-,4,12,7,13,1
19,3,22,15,2,23
5,18,9,26,10,6
17,8,14,20,16,21
-,-,24,11,25,27`;
const demo = () => {
  const current = parseGrid(CURRENT);
  return {
    rows: current.rows, cols: current.cols, current,
    students: [...SEX].map((sex, i) => ({ seat: i + 1, sex, tags: INIT[i + 1] || [] })),
    relations: [
      { a: 7, b: 13, k: "conflict" }, { a: 11, b: 27, k: "conflict" },
      { a: 3, b: 19, k: "chat" }, { a: 8, b: 14, k: "chat" },
      { a: 1, b: 23, k: "pos" }, { a: 16, b: 21, k: "pos" },
    ],
  };
};
// 小教室：手動擺位測單條規則（3 排 × 3 欄，座號 1–9，不設性別、不給目前座位）
const tiny = (tags = {}, relations = []) => ({
  rows: 3, cols: 3, relations,
  students: Array.from({ length: 9 }, (_, i) => ({ seat: i + 1, sex: "", tags: tags[i + 1] || [] })),
});
const at = (rows, cols, placed) => { const a = Array(rows * cols).fill(null); for (const [i, s] of Object.entries(placed)) a[i] = s; return a; };
const failed = (r, rule) => r.items.filter(x => x.rule === rule && !x.ok);

// ── 解析／輸出 ───────────────────────────────────────
test("座位表解析→輸出來回一致（含 - 空位）", () => {
  const g = parseGrid(CURRENT);
  assert.equal(g.rows, 5); assert.equal(g.cols, 6); assert.equal(g.assign.length, 30);
  assert.equal(g.assign[0], null); assert.equal(g.assign[1], 4);
  assert.equal(formatGrid(g), CURRENT);
  assert.deepEqual(parseGrid(formatGrid(g)), g);
});

test("解析容許全形逗號、全形－、行尾補空位；大小以座位表本身為準", () => {
  const g = parseGrid("1，2，－\n3,4\n");
  assert.deepEqual(g, { rows: 2, cols: 3, assign: [1, 2, null, 3, 4, null] });
  assert.equal(formatGrid(g), "1,2,-\n3,4,-");
});

test("解析擋重複座號與非座號", () => {
  assert.throws(() => parseGrid("1,2\n2,3"), /重複/);
  assert.throws(() => parseGrid("1,x"), /不是座號/);
  assert.throws(() => parseGrid(""), /空/);
});

// ── 三條必須規則：違反→偵測到 ─────────────────────────
test("必須：需坐前面坐第 3 排 → 偵測到", () => {
  const inp = tiny({ 1: ["front"] });
  assert.equal(failed(evaluate(inp, at(3, 3, { 6: 1 }), { detail: true }), "front").length, 1);
  assert.equal(failed(evaluate(inp, at(3, 3, { 3: 1 }), { detail: true }), "front").length, 0);
});

test("必須：易衝突隔一個位子內（含斜角）→ 偵測到；隔開兩格以上才算過", () => {
  const inp = tiny({}, [{ a: 1, b: 2, k: "conflict" }]);
  for (const [ia, ib] of [[0, 1], [0, 2], [0, 4], [0, 6]])  // 左右、直線隔一個、斜角、前後隔一個
    assert.equal(failed(evaluate(inp, at(3, 3, { [ia]: 1, [ib]: 2 }), { detail: true }), "conflict").length, 1, `${ia}-${ib}`);
  // 斜角隔一個（列差²＋欄差²＝8）才算隔開
  assert.equal(failed(evaluate(inp, at(3, 3, { 0: 1, 8: 2 }), { detail: true }), "conflict").length, 0);
});

test("必須：愛聊天相鄰（含斜角）→ 偵測到", () => {
  const inp = tiny({}, [{ a: 1, b: 2, k: "chat" }]);
  for (const ib of [1, 3, 4])
    assert.equal(failed(evaluate(inp, at(3, 3, { 0: 1, [ib]: 2 }), { detail: true }), "chat").length, 1, `0-${ib}`);
  assert.equal(failed(evaluate(inp, at(3, 3, { 0: 1, 2: 2 }), { detail: true }), "chat").length, 0);
});

test("人際同一對只留一筆（後寫蓋前寫）", () => {
  const ctx = prepare(tiny({}, [{ a: 1, b: 2, k: "chat" }, { a: 2, b: 1, k: "pos" }]));
  assert.deepEqual(ctx.relations, [{ a: 2, b: 1, k: "pos" }]);
});

test("不認得的條件代碼整筆拒絕", () => {
  assert.throws(() => prepare(tiny({ 1: ["health"] })), /不認得/);
  assert.throws(() => prepare(tiny({}, [{ a: 1, b: 2, k: "love" }])), /不認得/);
});

// ── 最佳化 ───────────────────────────────────────────
test("同條件同種子結果相同；換種子結果不同", () => {
  const a = optimize(demo(), { seed: 3 }), b = optimize(demo(), { seed: 3 }), c = optimize(demo(), { seed: 4 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.assign, c.assign);
});

test("示意資料 6 個種子：必須與優先全滿足，每人恰一個位子", () => {
  for (let seed = 1; seed <= 6; seed++) {
    const g = optimize(demo(), { seed });
    const seated = g.assign.filter(s => s != null).sort((x, y) => x - y);
    assert.deepEqual(seated, Array.from({ length: 27 }, (_, i) => i + 1), `seed ${seed}`);
    const r = evaluate(demo(), g.assign, { detail: true });
    const bad = r.items.filter(x => !x.ok && x.tier !== "soft").map(x => x.text);
    assert.deepEqual(bad, [], `seed ${seed}：${bad.join("；")}`);
  }
});

test("空位固定放後排（6 個種子；有固定桌時也一樣）", () => {
  for (let seed = 1; seed <= 6; seed++) {
    for (const locks of [{}, { 29: 4, 24: 9 }]) {
      const g = optimize(demo(), { seed, locks });
      const empties = g.assign.map((s, i) => (s == null ? i : -1)).filter(i => i >= 0);
      assert.equal(empties.length, 3);
      assert.ok(empties.every(i => Math.floor(i / 6) === 4), `seed ${seed} 空位在 ${empties}`);
    }
  }
  // 空位比一排多：佔滿最後一排，其餘落在倒數第二排
  const inp = { rows: 3, cols: 3, relations: [], students: [1, 2, 3, 4].map(seat => ({ seat, sex: "", tags: [] })) };
  for (let seed = 1; seed <= 6; seed++) {
    const g = optimize(inp, { seed });
    assert.deepEqual(g.assign.slice(6), [null, null, null], `seed ${seed}`);
    assert.equal(g.assign.slice(3, 6).filter(s => s == null).length, 2, `seed ${seed}`);
  }
});

test("固定桌位不被移動", () => {
  const locks = { 29: 4, 0: 26 };                         // 故意固定在違規位置，也不能被搬走
  for (let seed = 1; seed <= 3; seed++) {
    const g = optimize(demo(), { seed, locks });
    assert.equal(g.assign[29], 4); assert.equal(g.assign[0], 26);
    assert.equal(g.assign.filter(s => s === 4).length, 1);
  }
  assert.deepEqual(optimize(demo(), { seed: 1, locks: new Map([[29, 4]]) }).assign[29], 4);
});

test("固定資料錯誤擋下", () => {
  assert.throws(() => optimize(demo(), { locks: { 30: 1 } }), /不在教室/);
  assert.throws(() => optimize(demo(), { locks: { 0: 99 } }), /不在名單/);
  assert.throws(() => optimize(demo(), { locks: { 0: 1, 1: 1 } }), /兩個位子/);
});

test("人數多於桌數時丟錯", () => {
  const inp = { rows: 2, cols: 2, relations: [], students: [1, 2, 3, 4, 5].map(seat => ({ seat, sex: "", tags: [] })) };
  assert.throws(() => optimize(inp), /教室只有 4 個座位/);
});
