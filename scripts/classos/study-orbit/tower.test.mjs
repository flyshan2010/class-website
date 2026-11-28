// 百鍊之塔・數學算力階（P3 SPEC §5.4）：每層 1,000 個種子——答案唯一、選項不重複、數字在該層範圍；同種子兩次結果相同
import { test } from "node:test";
import assert from "node:assert/strict";
import { towerFloor, towerScore, towerFast, towerOpen, towerFloors, towerResult, towerMerge, TOWER_FLOORS, TOWER_Q } from "./rules.mjs";

const IN = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;
const RANGE = [
  ([a, b]) => IN(a, 10, 99) && IN(b, 10, 99),
  ([a, b]) => IN(a, 100, 899) && IN(b, 100, 899) && a + b <= 999,
  ([a, b]) => IN(a, 200, 999) && IN(b, 100, a - 1),
  ([a, b]) => IN(a, 2, 9) && IN(b, 2, 9),
  ([c, a]) => IN(a, 2, 9) && c % a === 0 && IN(c / a, 2, 9),
  ([n, u]) => (u === 10000 || u === 100000000) ? IN(n, 101, 9999) : IN(n, 10000000, 999999999) && IN(u, 2, 8),
  ([a, b]) => IN(a, 12, 99) && IN(b, 2, 9),
  ([a, b]) => IN(a, 100, 999) && IN(b, 2, 9),
  ([a, b]) => IN(a, 11, 99) && IN(b, 11, 99),
  ([a, b]) => IN(a, 100, 999) && IN(b, 2, 9) && a % b === 0 && a / b >= 12,
  ([a, b]) => IN(b, 11, 99) && a % b === 0 && IN(a / b, 2, 9),
  ([a, b]) => IN(a, 101, 999) && IN(b, 101, 999) && a !== b,
];

test("每層 1,000 個種子：10 題、4 個選項不重複、正解恰好一個、數字在範圍、同層不重題", () => {
  assert.equal(TOWER_FLOORS.ma.length, 12);
  for (let f = 1; f <= 12; f++) {
    for (let seed = 1; seed <= 1000; seed++) {
      const qs = towerFloor("ma", f, seed * 7919);
      assert.equal(qs.length, TOWER_Q, `第 ${f} 層 種子 ${seed}`);
      assert.equal(new Set(qs.map((q) => q.text)).size, TOWER_Q, `第 ${f} 層重題`);
      for (const q of qs) {
        assert.equal(q.opts.length, 4, q.text);
        assert.equal(new Set(q.opts).size, 4, `選項重複：${q.text} ${q.opts}`);
        assert.equal(q.opts.filter((o) => o === q.ans).length, 1, `正解不是恰好一個：${q.text}`);
        assert.ok(RANGE[f - 1](q.v), `第 ${f} 層超出範圍：${q.text} ${q.v}`);
        if (f !== 6) for (const o of q.opts) assert.ok(Number(o.replace(/,/g, "")) >= 0, `負數選項：${q.text} ${o}`);
        if (f === 12) for (const o of q.opts) assert.match(o, /^\d+\.\d\d$/, `小數格式：${o}`);
      }
      // 正解要真的對（由運算式重算）
      for (const q of qs) {
        const m = /^([\d.]+) ([＋－×÷]) ([\d.]+) ＝ ？$/.exec(q.text);
        if (!m) continue;
        const a = Number(m[1]), b = Number(m[3]), v = { "＋": a + b, "－": a - b, "×": a * b, "÷": a / b }[m[2]];
        assert.equal(Number(q.ans), Math.round(v * 100) / 100, q.text);
      }
    }
  }
});

test("同種子兩次結果相同；不同種子出不同題", () => {
  for (let f = 1; f <= 12; f++) {
    assert.deepEqual(towerFloor("ma", f, 424242), towerFloor("ma", f, 424242));
    assert.notDeepEqual(towerFloor("ma", f, 1).map((q) => q.text), towerFloor("ma", f, 2).map((q) => q.text));
  }
});

test("不認得的階、層、種子回 null", () => {
  assert.equal(towerFloor("zh", 1, 5), null);
  assert.equal(towerFloor("ma", 0, 5), null);
  assert.equal(towerFloor("ma", 13, 5), null);
  assert.equal(towerFloor("ma", 1, 0), null);
  assert.equal(towerFloor("ma", 1, 1.5), null);
  assert.equal(towerFloor("ma", 1, 2147483648), null);
});

test("判對錯：全對 10；被竄改的選項（全填正解但種子不同）判錯", () => {
  const qs = towerFloor("ma", 7, 999);
  const right = qs.map((q) => q.ans);
  assert.equal(towerScore("ma", 7, 999, right), 10);
  assert.ok(towerScore("ma", 7, 1000, right) <= 2, "換種子後幾乎全錯");
  assert.equal(towerScore("ma", 7, 999, right.slice(0, 9)), -1, "不是 10 個選項");
  const one = right.slice(); one[3] = qs[3].opts.find((o) => o !== qs[3].ans);
  assert.equal(towerScore("ma", 7, 999, one), 9);
});

test("快答提醒：連續 3 題 1 秒內才算一次，提醒後重新數", () => {
  assert.equal(towerFast([900, 800, 700]), 1);
  assert.equal(towerFast([900, 800, 1000, 700]), 0, "第 3 題剛好 1 秒不算");
  assert.equal(towerFast([500, 500, 500, 500, 500, 500]), 2);
  assert.equal(towerFast([500, 500, 500, 500, 500]), 1);
  assert.equal(towerFast([]), 0);
});

test("開放：第 1 層一定開；過了第 N 層才開第 N+1 層", () => {
  assert.ok(towerOpen("ma", null, 1));
  assert.ok(!towerOpen("ma", null, 2));
  assert.ok(towerOpen("ma", [3, 50, 60, 70], 4));
  assert.ok(!towerOpen("ma", [3, 50, 60, 70], 5));
  assert.ok(!towerOpen("ma", [12], 13));
});

test("開放（§13.1）：數學 1–12 層和舊版逐層開放逐格相同", () => {
  const old = (rec, f) => f >= 1 && f <= 12 && f <= ((rec && rec[0]) || 0) + 1;
  for (let top = 0; top <= 12; top++) for (let f = -1; f <= 14; f++) {
    assert.equal(towerOpen("ma", [top], f, towerFloors("ma")), old([top], f), `top=${top} f=${f}`);
    assert.equal(towerOpen("ma", [top], f), old([top], f));
  }
});

test("開放（§13.1）：國社缺號跳過、補上線的小號層 ≤ 最高層直接開", () => {
  const fl = [4, 5, 8, 12];
  assert.ok(towerOpen("ch", null, 4, fl), "第一個可用層一定開");
  assert.ok(!towerOpen("ch", null, 5, fl));
  assert.ok(!towerOpen("ch", null, 1, fl), "不可用的層不開");
  assert.ok(towerOpen("ch", [4], 5, fl));
  assert.ok(towerOpen("ch", [5], 8, fl), "6、7 層不可用 → 跳過，過了 5 就開 8");
  assert.ok(!towerOpen("ch", [5], 12, fl));
  assert.ok(towerOpen("ch", [8], 2, [2, 4, 5, 8, 12]), "第 2 層後來才可用、≤最高層 → 直接開");
  assert.ok(towerOpen("ch", [8], 6, [4, 5, 6, 8, 12]), "第 6 層後來補上線：前一可用層 5 已過 → 開");
  assert.ok(towerOpen("ch", [3], 10, [3, 10]), "前一可用層 3 已過 → 開 10");
  assert.ok(!towerOpen("so", null, 1, []), "沒有可用層全不開");
});

test("過層與金階（§11 第 1 題 A：打破自己的最佳紀錄）", () => {
  let r = towerResult(null, 1, 8, 40);
  assert.deepEqual([r.pass, r.gold, r.rec], [false, false, [0]], "8 題對沒過、用時不記");
  r = towerResult(r.rec, 1, 9, 52);
  assert.deepEqual([r.pass, r.gold, r.first, r.rec], [true, false, true, [1, 52]], "第一次過層＝記成最佳，不是金階");
  r = towerResult(r.rec, 1, 10, 52);
  assert.deepEqual([r.pass, r.gold, r.rec], [true, false, [1, 52]], "一樣快不算金階");
  r = towerResult(r.rec, 1, 9, 47);
  assert.deepEqual([r.pass, r.gold, r.best, r.rec], [true, true, 52, [1, 47]], "更快＝金階、更新最佳");
  r = towerResult(r.rec, 1, 9, 60);
  assert.deepEqual([r.gold, r.rec], [false, [1, 47]], "比較慢不蓋掉最佳");
  r = towerResult([3, 50, 60, 70], 2, 10, 30);
  assert.deepEqual(r.rec, [3, 50, 30, 70], "重打低層不降最高層");
});

test("合併：最高層取大、各層最佳取小（0＝沒有）", () => {
  assert.deepEqual(towerMerge([2, 50, 60], [3, 55, 0, 80]), [3, 50, 60, 80]);
  assert.deepEqual(towerMerge(null, [1, 40]), [1, 40]);
  assert.deepEqual(towerMerge(null, null), [0]);
});
