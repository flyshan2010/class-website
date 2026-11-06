import { test } from "node:test";
import assert from "node:assert/strict";
import { termExamScores, examLayout, postExamAnalysis } from "./term-exam.mjs";

// 10 題 × 10 分＝100 分；選擇 5 題、計算 5 題
const EXAM = {
  format: "quiz-exam/1", id: "115上-數學-期中考", name: "期中考",
  tags: { A: ["分數的意義", ""], B: ["整數乘法", ""], C: ["角的組成", ""] },
  sections: [
    { name: "一、選擇題（每題10分）", items: [["1", 10, "2", "A"], ["2", 10, "3", "C"], ["3", 10, "1", "A"], ["4", 10, "4", "C"], ["5", 10, "2", "C"]] },
    { name: "計算題", items: [["1", 10, "", "B"], ["2", 10, "", "B"], ["3 直式", 10, "", "B"], ["4", 10, "", "A"], ["5", 10, "", "C"]] },
  ],
};
const score = (code) => 100 - (code === "無" ? 0 : code.split(",").reduce((a, c) => a + (/\(-(\d+)\)/.exec(c)?.[1] * 1 || 10), 0));
const stu = (seat, errors) => ({ seat, errors, score: score(errors), absent: false });

test("examLayout：試題類型顯示比照老師照片，沒有中文序號的大題補上", () => {
  const l = examLayout(EXAM);
  assert.equal(l[1].label, "一、選擇題第2題");
  assert.equal(l[5].label, "二、計算題第1題");
  assert.equal(l[7].label, "二、計算題第3題（直式）");
  assert.equal(l[7].code, "二3直式");
  assert.equal(l[0].kp, "分數的意義");
});

test("試後分析：等距、平均、錯誤率四捨五入、三級門檻、依題目順序", () => {
  // 10 人應考＋1 人缺考；一1 錯 3 人（30％ 全班）、一3 錯 3 人（30％ 全班，同屬分數的意義）、
  // 二2 錯 2 人（20％ 小組）、一2 錯 1 人（10％ 不列）
  const rows = [
    stu(1, "一1,一3"), stu(2, "一1,一3,二2"), stu(3, "一1"), stu(4, "一3,二2(-5)"),
    stu(5, "一2"), stu(6, "無"), stu(7, "無"), stu(8, "無"), stu(9, "無"), stu(10, "無"),
    { seat: 11, score: null, absent: true, errors: "" },
  ];
  const r = postExamAnalysis(EXAM, rows);
  assert.equal(r.manual, undefined);
  assert.equal(r.n, 10); assert.equal(r.absent, 1);
  // 分數：80, 70, 90, 85, 90, 100×5 → 100:5、90–99:2、80–89:2、70–79:1
  assert.deepEqual(r.bins, [5, 2, 2, 1, 0, 0]);
  assert.equal(r.avg, 92); // 915/10＝91.5 → 92
  assert.deepEqual(r.listed.map((x) => [x.label, x.wrong, x.rate, x.level]), [
    ["一、選擇題第1題", 3, 30, "全班"], ["一、選擇題第3題", 3, 30, "全班"], ["二、計算題第2題", 2, 20, "小組"],
  ]);
  assert.match(r.listed[0].note, /與一、選擇題第3題同屬「分數的意義」觀念/);
  assert.equal(r.listed[2].remedyPrefix, "小組補救（2 人）：");
  assert.equal(r.listed[2].note, ""); // 2 人中 1 人部分扣分，沒過半不註明
  assert.deepEqual(r.groups, { "二2": [2, 4] });
  assert.match(r.summary, /全班平均 92 分；80 分以上 9 人（90%）；無未滿 60 分者。錯誤率 30% 以上 2 題全班補救、20%～29% 1 題小組補救/);
});

test("試後分析：錯的人過半是部分扣分要註明；0.5 一律進位", () => {
  // 8 人應考，二1 錯 2 人（25％）其中 2 人部分扣分
  const rows = [stu(1, "二1(-5)"), stu(2, "二1(-4)"), ...[3, 4, 5, 6, 7, 8].map((s) => stu(s, "無"))];
  const r = postExamAnalysis(EXAM, rows);
  assert.equal(r.listed[0].rate, 25);
  assert.match(r.listed[0].note, /2 人中 2 人為部分扣分/);
  assert.equal(r.avg, 99); // (95+96+600)/8＝98.875 → 99
  const half = postExamAnalysis(EXAM, [stu(1, "一1(-1)"), stu(2, "無")]); // 99.5 → 100
  assert.equal(half.avg, 100);
});

test("試後分析 fail-closed：錯題碼對不到、分數不符、有分數沒登記 → 整科不出表", () => {
  assert.match(postExamAnalysis(EXAM, [stu(1, "九9")]).manual[0], /對不到題目/);
  assert.match(postExamAnalysis(EXAM, [{ seat: 2, score: 95, absent: false, errors: "一1" }]).manual[0], /算出 90 分/);
  assert.match(postExamAnalysis(EXAM, [{ seat: 3, score: 100, absent: false, errors: "" }]).manual[0], /全對請登記「無」/);
  assert.match(postExamAnalysis(EXAM, [{ seat: 4, score: null, absent: true, errors: "" }]).manual[0], /沒有任何應考成績/);
});

test("期考分數：只收同階段名稱、學期範圍內；缺考保留；同科兩筆與判不出＝需人工", () => {
  const rec = (seats, subject, score, extra = {}) => ({ seats, date: "2026-11-05", category: "評量", subject, score,
    name: "期中考", desc: "", errors: "無", ...extra });
  const recs = [
    rec([1], "國語", 88), rec([1], "數學", null, { desc: "缺考" }), rec([2], "國語", 90), rec([2], "國語", 91),
    rec([2], "社會", null), rec([3], "數學", 77, { name: "期末考" }), rec([3], "社會", 66, { date: "2026-01-20" }),
    rec([3], "國語", 70, { name: "L1平時卷" }), rec([99], "國語", 50),
  ];
  const r = termExamScores(recs, [1, 2, 3], { stage: "期中", from: "2026-08-30", to: "2027-01-20" });
  const s = (seat, m) => r.rows.find((x) => x.seat === seat).subjects[m];
  assert.equal(s(1, "國語").score, 88);
  assert.equal(s(1, "數學").absent, true);
  assert.equal(s(2, "國語"), null);
  assert.equal(s(3, "數學"), null);       // 期末考不收
  assert.equal(s(3, "社會"), null);       // 範圍外
  assert.equal(s(3, "國語"), null);       // 平時卷不收
  assert.equal(r.orphan, 1);
  assert.deepEqual(r.manual.sort(), ["座號2 社會期中考：沒有分數（也沒寫缺考）", "座號2 國語期中考有 2 筆，請刪到剩一筆"].sort());
});
