import test from "node:test";
import assert from "node:assert/strict";
import { itemCode, parseErrorCode, flatItems, termOf, matchExam, analyze, reportItem } from "./quiz-errors.mjs";

// 示意卷（不是真卷：真卷含答案，不進公開 repo）。總分 100。
const EXAM = {
  id: "115上-社會-L9", subj: "社會", name: "L9平時卷",
  tags: { A: ["地形", "看地形圖"], B: ["氣候", "整理氣候"], C: ["地圖", "找四要素"] },
  sections: [
    { name: "一、是非題（每題2分）", items: [["1", 2, "○", "A"], ["2", 2, "×", "B"], ["3", 2, "○", "C"]] },
    { name: "二、選擇題", items: [["1", 10, "2", "A"], ["2", 10, "3", "B"], ["3", 10, "4", "C"]] },
    { name: "三、題組", items: [["1 地形①", 20, "平原", "A"], ["2", 22, "", "C"], ["8 彷", 11, "彷", "B"], ["8 彿", 11, "彿", "B"]] },
  ],
};

test("題目代碼：大題中文序＋題號去空白（與 quiz.html itemCode 同一套）", () => {
  assert.equal(itemCode(0, "5"), "一5");
  assert.equal(itemCode(2, "1 地形①"), "三1地形①");
  assert.equal(itemCode(1, "8 彷"), "二8彷");
  assert.deepEqual(flatItems(EXAM).map((i) => i.code).slice(-2), ["三8彷", "三8彿"]);
  assert.equal(flatItems(EXAM)[0].label, "一、是非題 1", "標籤去掉配分括號");
});

test("錯題碼解析：全對、部分扣分、全形括號與頓號、錯:前綴", () => {
  assert.deepEqual(parseErrorCode("無"), { none: true });
  assert.deepEqual(parseErrorCode("錯:無"), { none: true });
  assert.deepEqual(parseErrorCode("三2,一5,四填6(-1)").entries,
    [{ code: "三2", ded: null }, { code: "一5", ded: null }, { code: "四填6", ded: 1 }]);
  assert.deepEqual(parseErrorCode("三2（-3）、一5").entries, [{ code: "三2", ded: 3 }, { code: "一5", ded: null }]);
  assert.ok(parseErrorCode("").error, "空白不可當全對");
  assert.ok(parseErrorCode(null).error);
});

test("學期與卷對應：同學期同科同名才算，對到 0 或 2 份都不猜", () => {
  assert.equal(termOf("2026-10-14"), "115上");
  assert.equal(termOf("2027-01-08"), "115上");
  assert.equal(termOf("2027-03-02"), "115下");
  const exams = [{ id: "115上-社會-L9", subject: "社會", name: "L9平時卷" }, { id: "115下-社會-L9", subject: "社會", name: "L9平時卷" }];
  assert.equal(matchExam(exams, { date: "2026-10-14", subject: "社會", name: "L9 平時卷" }).id, "115上-社會-L9");
  assert.equal(matchExam(exams, { date: "2026-10-14", subject: "國語", name: "L9平時卷" }), null);
  assert.equal(matchExam([...exams, exams[0]], { date: "2026-10-14", subject: "社會", name: "L9平時卷" }), null);
});

test("分析：得分率四捨五入、建議門檻（扣≥2 且 <80%）依得分率排序", () => {
  // A 滿分 32：扣 一1(2)＋三1地形①(20) → 10/32＝31%；B 滿分 34：扣 三8彷(11) → 23/34＝68%；C 滿分 34：扣 二3 部分 1 → 97%
  const r = analyze(EXAM, "一1,三1地形①,三8彷,二3(-1)", 66);
  assert.equal(r.score, 66);
  assert.deepEqual(r.kp, [{ name: "地形", rate: 31 }, { name: "氣候", rate: 68 }, { name: "地圖", rate: 97 }]);
  assert.deepEqual(r.tips.map((t) => t.name), ["地形", "氣候"], "地圖只扣 1 分不列");
  assert.equal(r.wrong.length, 4);
  assert.deepEqual(r.wrong[3], { label: "二、選擇題 3", lost: 1, ans: "4", tag: "地圖" });
  assert.equal(analyze(EXAM, "三2", 78).wrong[0].ans, "（看老師評語）", "沒有標準答案的題目");
});

test("全對：每類 100%、沒有建議、沒有錯題", () => {
  const r = analyze(EXAM, "無", 100);
  assert.deepEqual(r.tips, []); assert.deepEqual(r.wrong, []);
  assert.ok(r.kp.every((k) => k.rate === 100));
});

test("判不出就不畫（fail-closed）", () => {
  assert.match(analyze(EXAM, "九9", 90).manual, /對不到/);
  assert.match(analyze(EXAM, "一1(-5)", 95).manual, /超過配分/);
  assert.match(analyze(EXAM, "一1,一1", 96).manual, /兩次/);
  assert.match(analyze(EXAM, "一1", 90).manual, /算出 98 分/, "老師手改分數或漏登 → 不出分析");
  assert.ok(analyze(EXAM, "", 100).manual);
  const dup = { ...EXAM, sections: [{ name: "一、", items: [["1", 50, "", "A"], ["1", 50, "", "B"]] }] };
  assert.match(analyze(dup, "無", 100).manual, /重複/);
});

test("建議最多 5 類", () => {
  const tags = Object.fromEntries("ABCDEFG".split("").map((t) => [t, [t, `複習${t}`]]));
  const ex = { tags, sections: [{ name: "一、", items: "ABCDEFG".split("").map((t, i) => [String(i + 1), i < 2 ? 15 : 14, "", t]) }] };
  const r = analyze(ex, "一1,一2,一3,一4,一5,一6,一7", 0);
  assert.equal(r.tips.length, 5);
});

test("解答開放日閘門：未到或沒填 → 輸出裡完全沒有錯題明細、答案、試卷連結", () => {
  const res = analyze(EXAM, "一1", 98);
  const meta = { subject: "社會", name: "L9平時卷", date: "2026-10-14", open: "2026-11-06", paper: "https://drive.example/x", review: { label: "觀念複習", href: "https://x" } };
  const before = reportItem(meta, res, "2026-11-05");
  assert.equal(before.unlocked, false);
  assert.ok(!("wrong" in before) && !("paper" in before));
  assert.ok(!JSON.stringify(before).includes("drive.example"));
  assert.ok(!JSON.stringify(before).includes("○"), "答案不可出現在輸出");
  const none = reportItem({ ...meta, open: "" }, res, "2099-01-01");
  assert.equal(none.unlocked, false); assert.ok(!("wrong" in none));
  const after = reportItem(meta, res, "2026-11-06");
  assert.equal(after.unlocked, true);
  assert.equal(after.wrong[0].ans, "○");
  assert.equal(after.paper, "https://drive.example/x");
});
