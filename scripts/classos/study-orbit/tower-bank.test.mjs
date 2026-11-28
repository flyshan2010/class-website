// 百鍊塔・國語字詞階、社會常識階（P3 SPEC §13.7 第⑤a 步測試）：用班網三本真題本
// 真題本還沒有塔題類（老師裁定後才寫進 Notion）→ 國語用規則化的假標記、社會照小節順序補 tower，只驗程式結構。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { towerPool, towerFloors, towerFloorBank, towerScoreBank, towerAnsMap, TOWER_Q, TOWER_TW } from "./rules.mjs";

const D = new URL("../../../data/study-orbit/", import.meta.url);
const J = (n) => JSON.parse(readFileSync(new URL(n, D), "utf8"));
const IX = Object.fromEntries(J("index.json").books.map((b) => [b.subject, b]));
const TW = Object.keys(TOWER_TW);

function chBook() {
  const b = J(IX["國語"].code + ".json"), kp = Object.fromEntries(b.kps.map((k) => [k.code, k]));
  let i = 0;
  b.questions.forEach((q) => { if (/字詞語詞/.test(kp[q.kp]?.reviewCard || "")) q.tw = q.type === "配合" ? "詞義" : TW[i++ % 5]; });
  return b;
}
function soStructure() {
  const s = JSON.parse(JSON.stringify(IX["社會"].structure));
  let n = 0;
  s.islands.forEach((isl) => isl.levels.forEach((l) => { l.tower = ++n; }));
  return s;
}
const CH = towerPool("ch", chBook(), IX["國語"].structure);
const SO = towerPool("so", J(IX["社會"].code + ".json"), soStructure());

test("towerPool：國語 24 層、社會 10 層、數學回 null", () => {
  assert.deepEqual(Object.keys(CH).map(Number).sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i + 1));
  assert.deepEqual(Object.keys(SO).map(Number).sort((a, b) => a - b), Array.from({ length: 10 }, (_, i) => i + 1));
  assert.equal(towerPool("ma", J(IX["數學"].code + ".json"), IX["數學"].structure), null);
  assert.equal(towerPool("ch", null, IX["國語"].structure), null);
});

test("題目項：key 不重複、4 個不重複選項、ans 在 A–D；配合題拆出的字母和 answer 一致", () => {
  for (const [stair, pool, code] of [["ch", CH, IX["國語"].code], ["so", SO, IX["社會"].code]]) {
    const all = Object.values(pool).flat();
    assert.equal(new Set(all.map((it) => it.key)).size, all.length, stair + " key 重複");
    for (const it of all) {
      assert.deepEqual(it.opts.map((o) => o.L), ["A", "B", "C", "D"], it.key);
      assert.equal(new Set(it.opts.map((o) => o.text)).size, 4, it.key);
      assert.ok(["A", "B", "C", "D"].includes(it.ans), it.key);
    }
    const book = J(code + ".json");
    for (const q of book.questions.filter((x) => x.type === "配合")) {
      const items = all.filter((it) => it.key.startsWith(q.id + "#"));
      if (!items.length) continue;
      assert.equal(items.length, 4, q.id);
      const ans = Object.fromEntries(q.answer.split(",").map((x) => [x.slice(0, -1), x.slice(-1)]));
      items.forEach((it) => {
        const i = Number(it.key.split("#")[1]);
        assert.equal(it.ans, ans[i], it.key);
        assert.equal(it.stem, q.stem + "\n" + q.left[i - 1], "題幹＝原題幹＋換行＋左欄第 i 項");
      });
    }
  }
});

test("社會只收基礎格；國語字層＝2n−1、詞層＝2n", () => {
  const so = J(IX["社會"].code + ".json"), st = soStructure();
  const kind = {}; st.islands.forEach((i) => i.levels.forEach((l) => { kind[l.code] = l; }));
  for (const [f, items] of Object.entries(SO)) for (const it of items) {
    const q = so.questions.find((x) => x.id === it.key.split("#")[0]), L = kind[q.level];
    assert.equal(L.tower, Number(f)); assert.equal(L.slots[q.slot - 1], "基礎", it.key);
  }
  const ch = chBook(), isl = {}; IX["國語"].structure.islands.forEach((i) => i.levels.forEach((l) => { isl[l.code] = Number(i.id); }));
  for (const [f, items] of Object.entries(CH)) for (const it of items) {
    const q = ch.questions.find((x) => x.id === it.key.split("#")[0]);
    assert.equal(Number(f), 2 * isl[q.level] - 1 + TOWER_TW[q.tw], it.key);
  }
});

test("towerFloors：題池 ≥10 才可用；數學 1–12", () => {
  assert.deepEqual(towerFloors("ma"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const fl = towerFloors("ch", CH);
  assert.ok(fl.every((f) => CH[f].length >= 10));
  assert.ok(Object.keys(CH).map(Number).filter((f) => !fl.includes(f)).every((f) => CH[f].length < 10));
  assert.deepEqual(towerFloors("ch", towerAnsMap(CH)), fl, "代理快取的對照表算出同樣的可用層");
  assert.deepEqual(towerFloors("so", { 1: [1, 2], 3: Array(10).fill(0) }), [3]);
});

test("towerFloorBank：每層 1,000 個種子 10 個不同 key、同種子同題、選項有洗牌", () => {
  const fl = towerFloors("ch", CH).concat(towerFloors("so", SO).map((f) => -f));
  assert.ok(fl.length > 0);
  let moved = 0;
  for (const g of fl) {
    const pool = g > 0 ? CH : SO, f = Math.abs(g), keys = new Set(pool[f].map((it) => it.key)), seen = new Set();
    for (let s = 1; s <= 1000; s++) {
      const qs = towerFloorBank(pool, f, s * 7919);
      assert.equal(qs.length, TOWER_Q);
      assert.equal(new Set(qs.map((q) => q.key)).size, TOWER_Q);
      qs.forEach((q) => { assert.ok(keys.has(q.key)); seen.add(q.key); assert.deepEqual(q.opts.map((o) => o.L).sort(), ["A", "B", "C", "D"]); if (q.opts[0].L !== "A") moved++; });
    }
    assert.equal(seen.size, keys.size, `第 ${f} 層 1,000 個種子每題都抽得到`);
    assert.deepEqual(towerFloorBank(pool, f, 424242), towerFloorBank(pool, f, 424242));
  }
  assert.ok(moved > 0, "選項有洗牌");
  const f0 = towerFloors("ch", CH)[0];
  assert.equal(towerFloorBank(CH, f0, 0), null);
  assert.equal(towerFloorBank(CH, f0, 1.5), null);
  assert.equal(towerFloorBank({ 1: CH[f0].slice(0, 9) }, 1, 5), null, "不到 10 題不出");
  assert.equal(towerFloorBank(CH, 99, 5), null);
});

test("towerScoreBank：全對＝10；竄改／重複／不足 10／字母不是 A–D 回 −1；換種子但 key 與字母正確照算", () => {
  const f = towerFloors("ch", CH)[0], qs = towerFloorBank(CH, f, 777), keys = qs.map((q) => q.key), ans = qs.map((q) => q.ans);
  const map = towerAnsMap(CH);
  assert.equal(towerScoreBank(CH, f, keys, ans), 10);
  assert.equal(towerScoreBank(map, f, keys, ans), 10, "代理快取的對照表判法相同");
  const one = ans.slice(); one[3] = one[3] === "A" ? "B" : "A";
  assert.equal(towerScoreBank(CH, f, keys, one), 9);
  assert.equal(towerScoreBank(CH, f, keys.slice(0, 9), ans.slice(0, 9)), -1, "不足 10");
  assert.equal(towerScoreBank(CH, f, [keys[0], ...keys.slice(0, 9)], ans), -1, "key 重複");
  assert.equal(towerScoreBank(CH, f, ["CH4-9999", ...keys.slice(1)], ans), -1, "不在該層的 key");
  assert.equal(towerScoreBank(CH, f, keys, ["E", ...ans.slice(1)]), -1, "字母不是 A–D");
  assert.equal(towerScoreBank(CH, f, keys, ans.map((a) => a.toLowerCase())), -1, "小寫不收");
  const other = towerFloors("ch", CH).find((x) => x !== f);
  if (other) assert.equal(towerScoreBank(CH, other, keys, ans), -1, "別層的 key 不收");
  const qs2 = towerFloorBank(CH, f, 778);
  assert.equal(towerScoreBank(CH, f, qs2.map((q) => q.key), qs2.map((q) => q.ans)), 10, "種子不參與判分");
  assert.equal(towerScoreBank(null, f, keys, ans), -1);
});
