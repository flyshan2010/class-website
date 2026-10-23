// 跑法：node --test assess-weak.test.mjs
// 題目＝SPEC_單節課簡報v4 §8 P2d 與 §9-1 的規則，答案寫死；規則一漂這裡就紅。只用虛構座號與虛構頁面 id，不含學生資料。
import test from "node:test";
import assert from "node:assert/strict";
import { pct, rowFromRecord, weekKey, aggregate, teacherWeeks, seatWeek, MIN_ITEMS, LOW_RATE } from "./assess-weak.mjs";

const seatOfId = new Map([["p1", 1], ["p2", 2], ["p3", 3]]);
const rec = (o) => ({ 類別: "課堂表現", 事件描述: "國R1-3 課堂作答：小考 4/5・課中 1/2", 學生: ["p1"], 日期: { start: "2026-10-28" },
  週次: "四上第9週(10/26-10/30)", 作答明細: "Q1:修辭:O,Q2:修辭:X,Q3:句型:O,Q4:句型:N,Q5:書信:O,C1:修辭:O,C2:提取:O", ...o });

test("門檻與四捨五入（ROUND_HALF_UP、整數）", () => {
  assert.equal(MIN_ITEMS, 3); assert.equal(LOW_RATE, 60);
  assert.equal(pct(1, 8), 13);   // 12.5 → 13（銀行家捨入會給 12）
  assert.equal(pct(5, 8), 63);   // 62.5 → 63
  assert.equal(pct(2, 3), 67); assert.equal(pct(0, 4), 0); assert.equal(pct(3, 3), 100);
  assert.equal(pct(0, 0), null);
});

test("紀錄庫列 → 作答列：只收課堂作答、格式壞與多位學生略過", () => {
  const r = rowFromRecord(rec(), seatOfId);
  assert.deepEqual([r.seat, r.lesson, r.subj, r.date, r.items.length], [1, "國R1-3", "國語", "2026-10-28", 7]);
  assert.ok(rowFromRecord(rec({ 類別: "評量" }), seatOfId).skip);
  assert.ok(rowFromRecord(rec({ 事件描述: "座號1 舉手回答" }), seatOfId).skip);
  assert.ok(rowFromRecord(rec({ 作答明細: "Q1:修辭:O,Q1:修辭:X" }), seatOfId).skip);   // 題號重複
  assert.ok(rowFromRecord(rec({ 作答明細: "" }), seatOfId).skip);
  assert.ok(rowFromRecord(rec({ 學生: ["p1", "p2"] }), seatOfId).skip);
  assert.ok(rowFromRecord(rec({ 學生: ["不在名冊"] }), seatOfId).skip);
  assert.equal(rowFromRecord(rec({ 事件描述: "數L3-2 課堂作答：課中 2/3", 作答明細: "C1:乘法:O" }), seatOfId).subj, "數學");
});

test("週次鍵：阿拉伯數字與國字別名同一週", () => {
  assert.equal(weekKey("四上第9週(10/26-10/30)").key, "四上|9");
  assert.equal(weekKey("四上第九週(10/26-10/30)").key, "四上|9");
  assert.equal(weekKey("四上第十二週").key, "四上|12");
  assert.equal(weekKey("四下第二十週").key, "四下|20");
  assert.equal(weekKey(""), null);
});

test("彙總：未答算分母不算對；不到 3 題 rate＝null", () => {
  const a = aggregate(rowFromRecord(rec(), seatOfId).items.map(i => ({ ...i, subj: "國語" })));
  const by = Object.fromEntries(a.map(k => [k.kp, k]));
  assert.deepEqual([by.修辭.o, by.修辭.x, by.修辭.n, by.修辭.rec, by.修辭.rate], [2, 1, 0, 3, 67]);
  assert.deepEqual([by.句型.o, by.句型.n, by.句型.rec, by.句型.rate], [1, 1, 2, null]);   // 2 題＝資料不足
  assert.equal(by.書信.rate, null);
});

test("教師版：依週分組、節次排序、座號×知識點；家長版只看自己那週", () => {
  const rows = [
    rowFromRecord(rec(), seatOfId),
    rowFromRecord(rec({ 學生: ["p2"], 作答明細: "Q1:修辭:X,Q2:修辭:X,Q3:句型:O,C1:修辭:N" }), seatOfId),
    rowFromRecord(rec({ 學生: ["p2"], 事件描述: "國R1-2 課堂作答：小考 1/2", 日期: { start: "2026-10-27" }, 作答明細: "Q1:修辭:O,Q2:推論:X" }), seatOfId),
    rowFromRecord(rec({ 學生: ["p3"], 週次: "四上第8週(10/19-10/23)", 日期: { start: "2026-10-21" } }), seatOfId),
  ];
  const weeks = { 學期: [{ 學年: "115", 學期: "上", 學期名稱: "四上", 週: [
    { 週次: 8, 起: "2026-10-19", 迄: "2026-10-25", 上課起: "2026-10-19", 上課迄: "2026-10-23", 標籤: "四上第8週(10/19-10/23)" },
    { 週次: 9, 起: "2026-10-26", 迄: "2026-11-01", 上課起: "2026-10-26", 上課迄: "2026-10-30", 標籤: "四上第9週(10/26-10/30)" }] }] };
  const tw = teacherWeeks(rows, weeks);
  assert.deepEqual(tw.map(w => w.key), ["四上|8", "四上|9"]);
  const w9 = tw[1];
  assert.deepEqual([w9.label, w9.from, w9.to, w9.rows], ["四上第9週(10/26-10/30)", "2026-10-26", "2026-10-30", 3]);
  assert.deepEqual(w9.lessons.map(l => [l.lesson, l.n]), [["國R1-2", 1], ["國R1-3", 2]]);
  const cls = Object.fromEntries(w9.classKp.map(k => [k.kp, k]));
  assert.deepEqual([cls.修辭.o, cls.修辭.rec, cls.修辭.rate], [3, 7, 43]);   // 1 號 2/3＋2 號 0/3（含未答）＋2 號另一節 1/1
  assert.deepEqual(Object.keys(w9.bySeat), ["1", "2"]);
  assert.equal(w9.bySeat[2].find(k => k.kp === "修辭").rate, 25);           // 兩節合計 1/4
  assert.equal(w9.overall, 54);                                            // (5＋1＋1)/(7＋4＋2)＝53.8
  const s2 = seatWeek(rows, 2, "四上|9");
  assert.deepEqual(s2.lessons, ["國R1-3", "國R1-2"]);
  assert.deepEqual([s2.weak, s2.strong], [["修辭"], []]);
  assert.ok(s2.few.includes("推論") && s2.few.includes("句型"));
  assert.equal(seatWeek(rows, 3, "四上|9"), null);                           // 3 號只有第 8 週
  assert.equal(JSON.stringify(tw).includes("p1"), false);                   // 不帶頁面 id
});
