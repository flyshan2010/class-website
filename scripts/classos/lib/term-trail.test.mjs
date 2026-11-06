import { test } from "node:test";
import assert from "node:assert/strict";
import { trailOf, termSummary, levelOf } from "./term-trail.mjs";

const q = (subject, date, score, name = `${subject}${date}`) => ({ subject, date, score, name, absent: score == null, manual: null });
const ex = (rows, growth = []) => ({ subjects: rows.map(([subject, score]) => ({ subject, score, absent: score == null })), growth });

test("四格：平時卷平均四捨五入、缺考不計、還沒考＝null；階段狀態", () => {
  const t = trailOf({ s1: [q("國語", "2026-10-01", 80), q("國語", "2026-10-08", 85), q("國語", "2026-10-09", null)], mid: null, s3: [], fin: null });
  assert.deepEqual(t.subjects.國語.cells, [83, null, null, null]); // 82.5 → 83（不是銀行家捨入）
  assert.deepEqual(t.subjects.數學.cells, [null, null, null, null]);
  assert.deepEqual(t.state, { s1: "now", mid: "lock", s3: "lock", fin: "lock" });
  const t2 = trailOf({ s1: [q("國語", "2026-10-01", 80)], mid: ex([["國語", 90], ["數學", null]]), s3: [], fin: null });
  assert.deepEqual(t2.state, { s1: "done", mid: "done", s3: "lock", fin: "lock" });
  assert.deepEqual(t2.subjects.數學.cells, [null, null, null, null]); // 缺考不畫分數
});

test("折線格位：每段至少 3 格，超過 3 份就加寬，期中考／期末考跟著往後移", () => {
  const s1 = ["01", "02", "03", "04"].map((d) => q("數學", `2026-10-${d}`, 70));
  const t = trailOf({ s1, mid: ex([["數學", 76]]), s3: [q("數學", "2026-11-20", 80)], fin: ex([["數學", 88]]) });
  assert.deepEqual(t.slots, { s1: 4, s3: 3 });
  assert.deepEqual(t.subjects.數學.points.map((p) => [p.slot, p.score, !!p.exam]),
    [[0, 70, false], [1, 70, false], [2, 70, false], [3, 70, false], [4, 76, true], [5, 80, false], [8, 88, true]]);
});

test("五等第：界線 90／80／70／60", () => {
  assert.deepEqual([90, 89, 80, 79, 70, 60, 59, null].map(levelOf), ["優", "甲", "甲", "乙", "乙", "丙", "丁", null]);
});

test("學期總結：總成績 floor((期中＋期末)/2＋0.5)、缺考不算；觀念合併期末蓋過期中", () => {
  const mid = ex([["國語", 88], ["數學", 79], ["社會", 90]], [
    { subject: "數學", name: "估算", quiz: 70, exam: 60, ok: false },
    { subject: "國語", name: "修辭", quiz: 67, exam: 85, ok: true },
  ]);
  const fin = ex([["國語", 91], ["數學", 80], ["社會", null]], [
    { subject: "數學", name: "估算", quiz: 72, exam: 82, ok: true },
    { subject: "數學", name: "分數加減", quiz: 58, exam: 70, ok: false },
  ]);
  const t = trailOf({ s1: [q("數學", "2026-10-01", 70)], mid, s3: [q("數學", "2026-11-20", 74)], fin });
  const s = termSummary(t, mid, fin);
  assert.deepEqual(s.grades, [
    { subject: "國語", total: 90, level: "優" }, // 89.5 → 90
    { subject: "數學", total: 80, level: "甲" }, // 79.5 → 80
    { subject: "社會", total: null, level: null }, // 期末缺考 → 不算
  ]);
  assert.deepEqual(s.tracked.map((x) => [x.subject, x.name, x.exam, x.ok]),
    [["國語", "修辭", 85, true], ["數學", "估算", 82, true], ["數學", "分數加減", 70, false]]);
  assert.deepEqual(s.bySubject, { 國語: { n: 1, ok: 1 }, 數學: { n: 2, ok: 1 }, 社會: { n: 0, ok: 0 } });
  assert.deepEqual(s.lines.find((x) => x.subject === "數學"), { subject: "數學", cells: [70, 79, 74, 80], delta: 10, verdict: "up" });
  assert.equal(termSummary(t, mid, null), null);
});
