import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { roundHalfUp, quizRange, toQuiz, inRange, trendOf, summarize, othersNote, reviewTip } from "./term-quiz.mjs";

const ROOT = new URL("../../../", import.meta.url);
const calendar = JSON.parse(readFileSync(new URL("data/calendar.json", ROOT), "utf8"));
const weeks = JSON.parse(readFileSync(new URL("data/weeks.json", ROOT), "utf8"));
const q = (date, subject, score, over = {}) => ({ date, category: "評量", subject, score, name: `${subject}${date}`, desc: "", ...over });

test("四捨五入：.5 一律進位（不是銀行家捨入）", () => {
  assert.equal(roundHalfUp(84.5), 85);
  assert.equal(roundHalfUp(82.5), 83);
  assert.equal(roundHalfUp(82.49), 82);
});

test("115上範圍讀真行事曆：期中＝開學～11/4，期末＝11/5～1/11", () => {
  assert.deepEqual(quizRange(calendar, weeks, "115上", "期中"), { from: "2026-08-31", to: "2026-11-04" });
  assert.deepEqual(quizRange(calendar, weeks, "115上", "期末"), { from: "2026-11-05", to: "2027-01-11" });
  assert.ok(quizRange(calendar, weeks, "115", "期中").error);
  assert.ok(quizRange(calendar, weeks, "115上", "期考").error);
});

test("預排日早於開學日 → 範圍從預排日起", () => {
  const w = { 學期: [{ 學年: "115", 學期: "上", 開學日: "2026-08-31", 休業日: "2027-01-20", 週: [{ 預排日: ["2026-08-28"] }] }] };
  assert.equal(quizRange([{ title: "期中考", date: "2026-11-05" }], w, "115上", "期中").from, "2026-08-28");
});

test("toQuiz：分數欄、缺考、判不出", () => {
  assert.deepEqual(toQuiz(q("2026-10-01", "數學", 85)), { date: "2026-10-01", subject: "數學", name: "數學2026-10-01", score: 85, absent: false, manual: null });
  const ab = toQuiz(q("2026-10-02", "數學", null, { desc: "數學4-1小考 缺考" }));
  assert.equal(ab.absent, true); assert.equal(ab.manual, null);
  assert.equal(toQuiz(q("2026-10-03", "數學", null, { desc: "小考粗心" })).manual, "沒有分數（也沒寫缺考）");
  assert.equal(toQuiz(q("2026-10-03", "", 90)).manual, "科目空白");
  assert.equal(toQuiz(q("2026-10-03", "數學", 105)).manual, "分數不在 0–100");
  assert.equal(toQuiz({ ...q("2026-10-03", "數學", 90), category: "作業" }), null);
  assert.equal(toQuiz(q("2026-10-03", "數學", 0)).score, 0, "0 分是真分數不是空白");
});

test("summarize：缺考不計入平均、平均四捨五入取整數、其他科分開", () => {
  const rs = [
    q("2026-09-16", "數學", 86), q("2026-09-24", "數學", 84), q("2026-10-02", "數學", 82),
    q("2026-10-08", "數學", null, { desc: "缺考" }), q("2026-10-14", "數學", 74), q("2026-10-16", "數學", 72),
    q("2026-09-22", "社會", 85), q("2026-10-01", "社會", 90),
    q("2026-10-07", "綜合", 95), q("2026-10-09", "健康", 88), q("2026-10-10", "數學", null, { desc: "粗心" }),
  ].map(toQuiz);
  const s = summarize(rs);
  assert.equal(s.subjects.數學.n, 5);
  assert.equal(s.subjects.數學.absent, 1);
  assert.equal(s.subjects.數學.avg, 80);            // (86+84+82+74+72)/5 = 79.6 → 80
  assert.equal(s.subjects.社會.avg, 88);            // 87.5 → 88（不是銀行家的 88，也不是 87）
  assert.equal(s.subjects.數學.latest, 72);
  assert.equal(s.subjects.數學.items.length, 6);     // 缺考那筆照列，分頁顯示「缺考（不計入）」
  assert.equal(s.subjects.國語.avg, null);
  assert.equal(s.others.length, 2);
  assert.equal(s.manual.length, 1);
  assert.equal(othersNote(s.others), "其他科平時考平均：綜合 95（1 次）、健康 88（1 次）");
});

test("範圍篩選含頭含尾", () => {
  const r = { from: "2026-08-31", to: "2026-11-04" };
  assert.ok(inRange({ date: "2026-11-04" }, r));
  assert.ok(!inRange({ date: "2026-11-05" }, r));
});

test("走勢：近 k 次比緊接在前 k 次", () => {
  assert.deepEqual(trendOf([80, 85, 83, 88, 97, 92]), { k: 3, delta: 9.7 });
  assert.deepEqual(trendOf([88, 92, 90, 90]), { k: 2, delta: 0 });
  assert.deepEqual(trendOf([86, 84, 82, 74, 72]), { k: 2, delta: -10 });
  assert.equal(trendOf([90]), null);
});

test("複習建議：挑跌最多的科、點名最近幾次評量", () => {
  const s = summarize([
    q("2026-09-01", "數學", 90, { name: "1-1" }), q("2026-09-08", "數學", 90, { name: "1-2" }),
    q("2026-09-15", "數學", 70, { name: "2-1" }), q("2026-09-22", "數學", 72, { name: "2-2" }),
    q("2026-09-01", "國語", 80), q("2026-09-08", "國語", 90),
  ].map(toQuiz));
  assert.equal(reviewTip(s.subjects), "數學最近 2 次往下走，期中考前建議優先複習「2-1」「2-2」的易錯題。");
  const up = summarize([q("2026-09-01", "國語", 80), q("2026-09-08", "國語", 90)].map(toQuiz));
  assert.equal(reviewTip(up.subjects, "期末"), "國語最近進步了，保持目前的複習節奏。");
  assert.equal(reviewTip(summarize([]).subjects), "");
});
