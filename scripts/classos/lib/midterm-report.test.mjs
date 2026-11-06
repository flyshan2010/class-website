import { test } from "node:test";
import assert from "node:assert/strict";
import { termExamData } from "./midterm-report.mjs";

const item = (subject, kp) => ({ subject, kp: kp.map(([name, rate]) => ({ name, rate })), tips: [], wrong: [] });

test("期中評量：分數對照平時卷平均、缺考不出分析", () => {
  const d = termExamData([
    { subject: "國語", date: "2026-11-05", score: 86, absent: false, item: item("國語", [["錯別字", 80]]) },
    { subject: "社會", date: "2026-11-05", score: null, absent: true, item: null },
  ], [], { 國語: 81 });
  assert.deepEqual(d.subjects.map((s) => [s.subject, s.score, s.quizAvg, !!s.item]), [["國語", 86, 81, true], ["社會", null, null, false]]);
  assert.equal(termExamData([], [], {}), null);
});

test("期中評量：平時卷 < 80％ 的知識點看最近一份考到它的卷，期中 ≥ 80％＝學會了", () => {
  const quizzes = [
    { ...item("數學", [["旋轉角", 40], ["大數的加減", 77]]), date: "2026-10-01", name: "L1-2" },
    { ...item("數學", [["旋轉角", 60]]), date: "2026-10-20", name: "L3-4" },
    { ...item("數學", [["長度", 50]]), date: "2026-11-07", name: "考後的卷" },
    { ...item("國語", [["旋轉角", 10]]), date: "2026-10-21", name: "別科同名" },
  ];
  const d = termExamData([{ subject: "數學", date: "2026-11-06", score: 78, absent: false,
    item: item("數學", [["旋轉角", 33], ["大數的加減", 100], ["長度", 90], ["乘法", 50]]) }], quizzes, { 數學: 84 });
  assert.deepEqual(d.growth, [
    { subject: "數學", name: "大數的加減", quiz: 77, quizName: "L1-2", exam: 100, ok: true },
    { subject: "數學", name: "旋轉角", quiz: 60, quizName: "L3-4", exam: 33, ok: false },
  ]);
});
