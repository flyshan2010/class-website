import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slotLight, nextStreak, stars, allGold, passed, applyRound, chestOpen,
  totals, weekStart, addWeekly, rank, starsToCatchUp,
  isFast, encodeSave, decodeSave, encodeDay, decodeDay,
} from "./rules.mjs";

test("§5.2 八個案例：星等、全對、過關", () => {
  const CASES = [ // 金, 銀, 暗, 星等, 全對, 過關
    [7, 0, 0, 3, true, true], [6, 1, 0, 3, false, true], [5, 2, 0, 2, false, true], [6, 0, 1, 2, false, true],
    [0, 5, 2, 2, false, true], [2, 2, 3, 1, false, true], [3, 0, 4, 1, false, true], [1, 1, 5, 0, false, false],
  ];
  for (const [g, s, d, st, ag, ps] of CASES) {
    assert.equal(g + s + d, 7);
    assert.equal(stars(g, s), st, `${g}/${s}/${d} 星等`);
    assert.equal(allGold(g), ag, `${g}/${s}/${d} 全對`);
    assert.equal(passed(g, s), ps, `${g}/${s}/${d} 過關`);
  }
});

test("§5.1 五種情況的燈、連對、秘笈卡", () => {
  assert.deepEqual(slotLight({ first: true, hinted: false }), { light: "gold", streak: "+1", card: null });
  assert.deepEqual(slotLight({ first: true, hinted: true }), { light: "silver", streak: "keep", card: null });
  assert.deepEqual(slotLight({ first: false, hinted: false }), { light: "dark", streak: "reset", card: "待複習" });
  assert.deepEqual(slotLight({ first: false, hinted: true, retry: true }), { light: "silver", streak: "keep", card: "已克服" });
  assert.deepEqual(slotLight({ first: false, hinted: false, retry: false }), { light: "dark", streak: "reset", card: "待複習" });
  assert.equal(nextStreak(3, "+1"), 4);
  assert.equal(nextStreak(3, "keep"), 3);
  assert.equal(nextStreak(3, "reset"), 0);
});

test("重玩只記最高星等；曾經全金不會變回 0；多出來的星才算本週", () => {
  let r = applyRound(undefined, 3, 0);          // 1 星
  assert.deepEqual(r, { record: [1, 0, 1], gained: 1 });
  r = applyRound(r.record, 7, 0);               // 3 星＋全金
  assert.deepEqual(r, { record: [3, 1, 2], gained: 2 });
  r = applyRound(r.record, 2, 0);               // 0 星：不倒退
  assert.deepEqual(r, { record: [3, 1, 3], gained: 0 });
});

test("寶箱：島上每關都曾經全金才開，不必同一次", () => {
  const lv = { "1-1": [3, 1, 4], "1-2": [3, 0, 2] };
  assert.equal(chestOpen(["1-1", "1-2"], lv), false);
  lv["1-2"] = [3, 1, 3];
  assert.equal(chestOpen(["1-1", "1-2"], lv), true);
  assert.equal(chestOpen([], lv), false);
});

test("§5.3 星數、完成關數", () => {
  assert.deepEqual(totals({ a: [3, 1, 1], b: [0, 0, 2], c: [2, 0, 1] }), { stars: 5, completed: 2 });
});

test("本週＝臺北時間週一 00:00 起；換週歸零", () => {
  assert.equal(weekStart("2026-11-22T15:59:00Z"), "2026-11-16"); // 臺北週日 23:59
  assert.equal(weekStart("2026-11-22T16:00:00Z"), "2026-11-23"); // 臺北週一 00:00
  assert.deepEqual(addWeekly({ weekly: 4, since: "2026-11-16" }, 2, "2026-11-20T02:00:00Z"), { weekly: 6, since: "2026-11-16" });
  assert.deepEqual(addWeekly({ weekly: 4, since: "2026-11-16" }, 2, "2026-11-23T02:00:00Z"), { weekly: 2, since: "2026-11-23" });
});

test("排行：同分並列；進度榜先比完成關數；追平前一名的差距", () => {
  const rows = [
    { seat: 1, completed: 5, stars: 10 }, { seat: 2, completed: 6, stars: 8 },
    { seat: 3, completed: 5, stars: 10 }, { seat: 4, completed: 4, stars: 12 },
  ];
  const prog = rank(rows, ["completed", "stars"]);
  assert.deepEqual(prog.map((x) => [x.seat, x.rank]), [[2, 1], [1, 2], [3, 2], [4, 4]]);
  const star = rank(rows, ["stars"]);
  assert.deepEqual(star.map((x) => [x.seat, x.rank]), [[4, 1], [1, 2], [3, 2], [2, 4]]);
  assert.equal(starsToCatchUp(star, 4), null);
  assert.equal(starsToCatchUp(star, 1), 2);
  assert.equal(starsToCatchUp(star, 2), 2);
});

test("P2 §1 第 6 項：第一次作答 <2 秒答對＝銀燈、連對不變；2 秒＝金燈；答錯照原流程", () => {
  assert.equal(isFast(1), true);
  assert.equal(isFast(1.99), true);
  assert.equal(isFast(2), false);
  assert.deepEqual(slotLight({ first: true, hinted: false, fast: isFast(1) }), { light: "silver", streak: "keep", card: null });
  assert.deepEqual(slotLight({ first: true, hinted: false, fast: isFast(2) }), { light: "gold", streak: "+1", card: null });
  assert.deepEqual(slotLight({ first: false, hinted: false, fast: true }), { light: "dark", streak: "reset", card: "待複習" });
  assert.deepEqual(slotLight({ first: false, hinted: false, retry: true, fast: true }), { light: "silver", streak: "keep", card: "已克服" });
});

test("P2 §4 存檔第 2 版：日期 3 字、編碼→解碼不變", () => {
  assert.equal(encodeDay("2026-01-01"), "000");
  assert.equal(decodeDay(encodeDay("2026-11-20")), "2026-11-20");
  assert.equal(decodeDay(encodeDay("2153-01-01")), "2153-01-01");
  const m = {
    lv: { "1-1": [3, 1, 4], "1-2": [1, 0, 2] },
    cd: { "1-1-B1": ["d", "2026-11-20"], "1-1-B10": ["t", "2026-11-18"], "2-1-B3": ["t", "2026-12-01"] },
    ok: ["1-1-B2"], sc: ["1-1"],
    mid: { k: "1-2", i: 3, res: "gs", q: ["MA4-0131", "MA4-0133"], t: 1763380000000 },
  };
  const s = encodeSave(m);
  assert.equal(JSON.parse(s).v, 2);
  assert.deepEqual(JSON.parse(s).L["1-1"], [3, 1, 4, 1, "1d08z2oat08x"]);
  assert.deepEqual(JSON.parse(s).L["2-1"], [0, 0, 0, 0, "3t09a"], "只有秘笈卡、沒玩過的關也要存");
  assert.deepEqual(decodeSave(s), decodeSave(m.lv && { v: 1, ...m }));
  assert.equal(encodeSave(decodeSave(s)), s, "再編一次字串完全相同");
  assert.deepEqual(decodeSave(""), { lv: {}, cd: {}, ok: [], sc: [], mid: null });
});

test("P2 §4 第 1 版讀進來轉第 2 版，內容不變", () => {
  const v1 = { v: 1, lv: { "1-1": [3, 1, 4], "3-2": [2, 0, 7] }, cd: { "1-1-B1": ["d", "2026-11-20"], "3-2-B4": ["t", "2026-11-19"] },
    ok: ["1-1-B2", "3-2-B1"], sc: ["1-1", "3-2"], mid: { k: "1-2", i: 3, res: "gs", q: ["MA4-0131", "MA4-0133"] } };
  const before = decodeSave(JSON.stringify(v1));
  const after = decodeSave(encodeSave(before));
  assert.deepEqual(after, before);
  assert.ok(encodeSave(before).length < JSON.stringify(v1).length, "第 2 版比第 1 版短");
});
