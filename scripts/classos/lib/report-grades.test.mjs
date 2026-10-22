// 跑法：node --test report-grades.test.mjs
// 題目＝SPEC_學習報告評分標準v2 §4 的範例，答案寫死；規則一漂這裡就紅。只用虛構事件，不含學生資料。
import test from "node:test";
import assert from "node:assert/strict";
import { weekDays, applyNegatives, participation, homework, life, lifeSkillScore, contentGrade, contentFromRecords, gradeStudent } from "./report-grades.mjs";

const D = weekDays("2026-09-21"); // 週一～週五 09-21～09-25
const [MON, TUE, WED, THU, FRI] = D;
const R = (date, category, polarity, level, desc, extra = {}) => ({ date, category, subject: null, polarity, level, desc, ...extra });
const hand = d => R(d, "課堂表現", "＋", null, "在國語課舉手回答", { subject: "國語" });
const talk = d => R(d, "課堂表現", "－", 1, "上課講話");
const done = d => R(d, "作業", "＋", null, "作業完成");
const noHw = d => R(d, "作業", "－", 1, "作業沒交");
const noTeeth = d => [R(d, "生活指導", "－", null, "常規未達成"), R(d, "生活指導", "－", 1, "午餐後沒潔牙，也沒有補刷")];

test("週一到週五：從任何一天起算都回到同一週", () => {
  assert.deepEqual(weekDays("2026-09-24"), D);
  assert.equal(D.length, 5);
  assert.equal(MON, "2026-09-21");
  assert.equal(FRI, "2026-09-25");
});

test("4-1 上課參與範例①～⑥", () => {
  assert.deepEqual([participation([], D).score, participation([], D).grade], [5, "甲"]);                      // ①
  assert.deepEqual([participation([hand(MON)], D).score, participation([hand(MON)], D).grade], [6, "優"]);    // ②
  const all = D.map(hand);
  assert.deepEqual([participation(all, D).score, participation(all, D).grade], [10, "特優"]);                 // ③
  const four = [R(TUE, "課堂表現", "＋", 2, "帶動小組討論"), hand(THU)];
  assert.deepEqual([participation(four, D).score, participation(four, D).grade], [8, "優"]);                  // ④
  const five = [...D.map(hand), talk(WED)];
  assert.deepEqual([participation(five, D).score, participation(five, D).grade], [9, "優"]);                  // ⑤ 輕微不降級
  assert.equal(participation(D.map(talk), D).grade, "乙");                                                    // ⑥
});

test("4-1 同日取最高、負向當天扣、只有講話＝0", () => {
  const twoSubjects = [hand(MON), R(MON, "課堂表現", "＋", 1, "數學課主動發表", { subject: "數學" })];
  assert.equal(participation(twoSubjects, D).score, 6);         // 同天國語數學都舉手仍 +2
  assert.equal(participation([hand(MON), talk(MON)], D).score, 5); // 舉手又講話＝1
  assert.equal(participation([talk(MON)], D).score, 4);         // 只有講話＝0
});

test("4-1 小組扣分不算個人、小組加分算 +2、協助發作業不算課堂", () => {
  const g = [R(MON, "班級", "＋", null, "在數學課小組加分"), R(TUE, "班級", "－", null, "在數學課小組扣分")];
  assert.deepEqual([participation(g, D).score, participation(g, D).grade], [6, "優"]);
  assert.equal(participation([R(MON, "課堂表現", "＋", 1, "協助發作業訂正")], D).score, 5);
});

test("§0-4／0-5 降一級與乙丙門檻", () => {
  assert.equal(applyNegatives("特優", [2]), "乙");  // 程度2 一次＝乙（覆蓋）
  assert.equal(applyNegatives("特優", [3]), "丙");
  assert.equal(applyNegatives("優", [2, 2, 2]), "丙");
  assert.equal(applyNegatives("特優", [1, 1, 1, 1]), "特優"); // 輕微不降級
  assert.equal(applyNegatives("甲", [1, 1, 1, 1, 1]), "乙");
});

test("4-2 作業成績範例①～⑤", () => {
  const five = D.map(done);
  assert.deepEqual([homework(five, D).score, homework(five, D).grade], [5, "甲"]);                              // ①
  const a = [...five, R(WED, "作業", "＋", 1, "8號甲本甲上")];
  assert.deepEqual([homework(a, D).score, homework(a, D).grade], [6, "優"]);                                    // ②
  const b = [...five, R(WED, "作業", "＋", 2, "8號甲本甲上上")];
  assert.deepEqual([homework(b, D).score, homework(b, D).grade], [7, "特優"]);                                  // ③
  const c = [...five, R(TUE, "作業", "＋", 1, "甲本甲上"), R(THU, "作業", "＋", 1, "甲本甲上")];
  assert.equal(homework(c, D).grade, "特優");                                                                   // ③ 甲上兩天
  const d = [done(MON), noHw(TUE), done(WED), done(THU), done(FRI)];
  assert.deepEqual([homework(d, D).score, homework(d, D).grade], [4, "甲"]);                                    // ④ 當天只有未交＝0
  assert.equal(homework(D.map(noHw), D).grade, "乙");                                                         // ⑤
});

test("4-2 兩份完成一份未交＝0；週結獎勵列不算；甲下 −1 但不進班規次數", () => {
  assert.equal(homework([done(MON), done(MON), noHw(MON)], D).score, 4);
  assert.equal(homework([R(FRI, "作業", "＋", null, "第4週作業完成獎勵")], D).score, 5);
  const low = D.map(d => R(d, "作業", "－", 1, "甲本甲下要重寫"));
  assert.deepEqual([homework(low, D).score, homework(low, D).grade], [0, "甲"]);
});

test("4-4 生活範例①～⑦（等第＋生活技能分數）", () => {
  const chk = (recs, score, grade, skill) => assert.deepEqual([life(recs, D).score, life(recs, D).grade, life(recs, D).skill], [score, grade, skill]);
  chk([], 15, "甲", 3);                                                                          // ①
  chk(noTeeth(TUE), 14, "甲", 3);                                                                // ② 本份不進乙丙
  chk([...noTeeth(TUE), ...noTeeth(THU)], 13, "甲", 2);                                          // ③
  chk([R(WED, "生活技能", "＋", null, "打掃支援")], 16, "優", 4);                                 // ④
  chk([R(TUE, "生活技能", "中性", null, "打掃缺席"), R(TUE, "生活技能", "－", 1, "輪到的工作或幹部職務沒做完")], 13, "甲", 2); // ⑤ 無故不掃＝1
  chk(D.map(d => R(d, "生活技能", "＋", 1, "主動整理教室環境")), 20, "特優", 5);                   // ⑥
  chk([R(MON, "生活技能", "中性", null, "打掃缺席"), R(TUE, "生活技能", "中性", null, "午餐缺席")], 15, "甲", 3); // ⑦ 請假
});

test("4-4 有掃沒達標＝2、同日多個正向取最高、遲到不進乙丙次數", () => {
  assert.equal(life([R(MON, "生活技能", "－", null, "打掃未達標")], D).score, 14);
  assert.equal(life([R(MON, "生活技能", "＋", null, "打掃支援"), R(MON, "生活技能", "＋", 2, "帶動同學一起打掃")], D).score, 17);
  assert.equal(life(D.map(d => R(d, "生活指導", "－", 1, "上學遲到")), D).grade, "甲");
  assert.equal(life(D.map(d => R(d, "生活指導", "－", 1, "上課前沒把物品收好")), D).grade, "乙");
  // 週結寫回列（打掃未達標 ≥3 次的 ③ −5）只是入帳彙總，當天的未達標已經各自算過，不重複扣
  const miss3 = [MON, TUE, WED].map(d => R(d, "生活技能", "－", null, "打掃未達標"));
  assert.equal(life([...miss3, R(FRI, "生活技能", "－", 1, "第4週打掃未達標（3 次）")], D).score, 12);
});

test("生活技能分數查表（做法 B：3＋(週分數−15)×0.5，.5 進位，夾 1–5）", () => {
  const got = [9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25].map(lifeSkillScore);
  assert.deepEqual(got, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5]);
});

test("4-3 內容評量：加權平均、英語不列、沒考＝甲、讀不懂＝需人工", () => {
  assert.deepEqual(contentGrade([{ subject: "國語", score: 92 }, { subject: "數學", score: 80 }]), { grade: "優", avg: 86.7 });
  assert.equal(contentGrade([]).grade, "甲");
  assert.equal(contentGrade([{ subject: "英語(彈性)", score: 40 }]).grade, "甲");
  assert.equal(contentGrade([{ subject: "崑山活力Go(彈性)", score: 95 }]).grade, "特優");
  assert.equal(contentGrade([{ subject: "國語", score: 90 }, { subject: "國語", score: 70 }]).grade, "優"); // 同科先平均
  assert.equal(contentGrade([{ subject: "國語", score: 59 }]).grade, "丙");
  assert.equal(contentGrade([{ subject: "自然", score: 90 }]).grade, "需人工");
  assert.equal(contentFromRecords([R(MON, "評量", "中性", null, "國語聽寫 92 分", { subject: "國語" })]).grade, "特優");
  assert.equal(contentFromRecords([R(MON, "評量", "中性", null, "數學小考訂正", { subject: "數學" })]).grade, "需人工");
  // 2026-10-17 BT 線：分數欄優先、缺考不計、科目「其他」＝科任課不列
  assert.equal(contentFromRecords([R(MON, "評量", "中性", null, "數學平時考：2-1小考 50分", { subject: "數學", score: 95 })]).grade, "特優");
  assert.equal(contentFromRecords([R(MON, "評量", "中性", null, "數學平時考：2-1小考 缺考", { subject: "數學", score: null })]).grade, "甲");
  assert.deepEqual(contentFromRecords([
    R(MON, "評量", "中性", null, "數學平時考：2-1小考 缺考", { subject: "數學", score: null }),
    R(MON, "評量", "中性", null, "國語平時考：L3聽寫 82分", { subject: "國語", score: 82 }),
  ]), { grade: "優", avg: 82 });
  assert.equal(contentFromRecords([R(MON, "評量", "中性", null, "自然小考", { subject: "其他", score: 40 })]).grade, "甲");
  assert.equal(contentFromRecords([R(MON, "評量", "中性", null, "綜合平時考：防災 88分", { subject: "綜合", score: 88 })]).grade, "優");
});

test("gradeStudent：沒有紀錄＝四個甲、生活技能 3", () => {
  const g = gradeStudent([], D);
  assert.deepEqual([g.上課參與, g.作業成績, g.生活常規, g.內容評量, g.生活技能分數], ["甲", "甲", "甲", "甲", 3]);
});

test("4-1 課堂作答：＋ 照常進量尺，－ 不扣量尺、不數乙丙（老師 2026-10-22）", () => {
  const ans = (d, pn) => R(d, "課堂表現", pn, 1, "國L7-2 課堂作答：小考 4/5・課中 1/2", { subject: "國語" });
  const wrong5 = D.map(d => ans(d, "－"));
  assert.deepEqual([participation(wrong5, D).score, participation(wrong5, D).grade], [5, "甲"]); // 一週 5 筆答錯仍不是乙
  assert.equal(participation([...D.map(hand), ...wrong5], D).grade, "特優");                      // 答錯不壓掉舉手
  assert.equal(participation([ans(MON, "＋")], D).score, 6);                                     // 答對當天 +2
  assert.equal(participation([...wrong5, talk(MON), talk(TUE), talk(WED), talk(THU), talk(FRI)], D).grade, "乙"); // 真班規照數
});
