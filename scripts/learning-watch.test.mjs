// 執行：node --test scripts/learning-watch.test.mjs
// 「需要關注」規則（assets/js/learning-watch.js）——老師 2026-10-15 裁定：
//   連 2 週下滑且累計 ≥0.5，或本週低於 2 分；缺資料＝需人工。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { judgeDim, judgeClass } = require("../assets/js/learning-watch.js");

test("本週低於 2 分 → 關注", () => {
  const r = judgeDim([3, 3, 1.5], 2);
  assert.equal(r.level, "watch");
  assert.equal(r.rule, "低於2分");
});

test("剛好 2 分不算低於 2 分", () => {
  assert.equal(judgeDim([2, 2, 2], 2).level, "ok");
});

test("連 2 週下滑且累計剛好 0.5 → 關注（浮點不誤判）", () => {
  // 3.5→3.25 不會出現，但 3.5→3.0 的差在浮點下要能正確等於 0.5
  const r = judgeDim([3.5, 3.25, 3.0], 2);
  assert.equal(r.level, "watch");
  assert.equal(r.rule, "連2週下滑");
  assert.equal(r.reason, "連 2 週下滑 3.5→3.3→3");
});

test("連 2 週下滑但累計只有 0.4 → 不關注", () => {
  assert.equal(judgeDim([3.4, 3.2, 3.0], 2).level, "ok");
});

test("只降一週（中間持平）→ 不算連 2 週下滑", () => {
  assert.equal(judgeDim([4, 3, 3], 2).level, "ok");
  assert.equal(judgeDim([4, 4, 3], 2).level, "ok");
});

test("範例：4→3.5→3→2.5 看最後一週 → 關注", () => {
  assert.equal(judgeDim([4, 3.5, 3, 2.5], 3).level, "watch");
});

test("本週沒分數 → 需人工（不可預設正常）", () => {
  for (const v of [null, undefined, "", 0]) {
    const r = judgeDim([3, 3, v], 2);
    assert.equal(r.level, "manual", `值 ${v}`);
    assert.equal(r.reason, "本週沒有分數");
  }
});

test("分數超出 1–5 → 需人工並標分數異常", () => {
  const r = judgeDim([3, 3, 7], 2);
  assert.equal(r.level, "manual");
  assert.match(r.reason, /分數異常/);
});

test("前兩週缺一週 → 需人工（無法判斷趨勢）", () => {
  assert.equal(judgeDim([null, 3, 3], 2).level, "manual");
  assert.equal(judgeDim([3, null, 3], 2).level, "manual");
});

test("前兩週缺但本週低於 2 → 仍是關注（低分優先）", () => {
  assert.equal(judgeDim([null, null, 1], 2).level, "watch");
});

test("學期前兩份報告：只看低分，趨勢標週次不足、不算需人工", () => {
  assert.equal(judgeDim([3], 0).level, "ok");
  assert.equal(judgeDim([3, 2.5], 1).rule, "週次不足");
  assert.equal(judgeDim([3, 1.5], 1).level, "watch");
});

test("全班：名冊有、報告沒有的座號 → 一筆「全部」需人工", () => {
  const bySeat = {
    1: { 國語: [3, 3, 3], 數學: [3, 3, 3], 社會: [3, 3, 3], 人際互動: [3, 3, 3], 生活技能: [3, 3, 3] },
    2: { 國語: [4, 3.5, 3], 數學: [3, 3, 1.5], 社會: [3, 3, 3], 人際互動: [3, 3, null], 生活技能: [3, 3, 3] },
  };
  const r = judgeClass(bySeat, [1, 2, 3], 2);
  assert.deepEqual(r.okSeats, [1]);
  assert.deepEqual(r.watch.map(x => `${x.seat}${x.dim}`), ["2國語", "2數學"]);
  assert.deepEqual(r.manual.map(x => `${x.seat}${x.dim}`), ["2人際互動", "3全部"]);
});

test("全班：本週五向度全空的座號也算整週沒報告", () => {
  const bySeat = { 5: { 國語: [3, null], 數學: [3, null], 社會: [3, null], 人際互動: [3, null], 生活技能: [3, null] } };
  const r = judgeClass(bySeat, [5], 1);
  assert.equal(r.manual.length, 1);
  assert.equal(r.manual[0].dim, "全部");
});
