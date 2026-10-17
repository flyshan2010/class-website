// 跑法：node --test term-daily-hw.test.mjs（只用虛構紀錄，不含學生資料）
import test from "node:test";
import assert from "node:assert/strict";
import { dailyScore, weeksInRange, splitItems, hwSubjectForScore, homeworkScores } from "./term-daily-hw.mjs";

const W1 = { 週次: 1, 上課起: "2026-09-21" }, W2 = { 週次: 2, 上課起: "2026-09-28" };
const R = (date, polarity, level, desc, subject = null, category = "課堂表現") => ({ date, category, subject, polarity, level, desc });

test("週範圍：上課起落在範圍內且不晚於 asOf", () => {
  const term = { 週: [W1, W2, { 週次: 3, 上課起: "2026-10-05" }, { 週次: 4 }] };
  assert.deepEqual(weeksInRange(term, { from: "2026-09-21", to: "2026-10-31" }, "2026-10-04").map((w) => w.週次), [1, 2]);
});

test("日常：沒有紀錄的週＝甲 90，沒有加分", () => {
  const r = dailyScore([], [W1, W2]);
  assert.deepEqual(r.daily, { 國語: 90, 數學: 90, 社會: 90 });
  assert.deepEqual(r.grades, ["甲", "甲"]);
});

test("日常：基本分取週等第平均＋該科每週最高程度平均×3（四捨五入）", () => {
  // 第 1 週每天國語舉手（程度 1）→ 每日 2 分 ×5＝10＝特優；數學有一次帶全班（程度 3）
  const w1 = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"].map((d) => R(d, "＋", 1, "在國語課舉手回答", "國語"));
  w1.push(R("2026-09-22", "＋", 3, "帶全班複習", "數學"));
  const r = dailyScore(w1, [W1, W2]);   // 第 2 週沒紀錄＝甲
  assert.deepEqual(r.grades, ["特優", "甲"]);
  // 基本 95；國語加分 (1+0)/2×3＝1.5 → 96.5 → 97；數學 (3+0)/2×3＝4.5 → 99.5 → 100；社會 95
  assert.deepEqual(r.daily, { 國語: 97, 數學: 100, 社會: 95 });
});

test("日常：加分上限 +10、總分上限 100；科目空白的正向不計但計數", () => {
  const recs = [R("2026-09-21", "＋", 3, "帶全班", "社會"), R("2026-09-22", "＋", 2, "帶動小組", null)];
  const r = dailyScore(recs, [W1]);
  assert.equal(r.bonus.社會, 9);
  assert.equal(r.daily.社會, 100);         // 週分 4+3+1+1+1＝10＝特優 100（科目空白的正向仍算上課參與）＋9 → 上限 100
  assert.equal(r.blankSubject, 1);
  // 程度最高 3 → 加分最多 9，+10 上限是保險（程度量尺改了才會碰到）
  assert.equal(dailyScore([R("2026-09-21", "＋", 3, "帶全班", "國語"), R("2026-09-28", "＋", 3, "帶全班", "國語")], [W1, W2]).bonus.國語, 9);
});

test("日常：負向在週等第扣（程度 3 一筆＝丙 75），不分科", () => {
  const r = dailyScore([R("2026-09-21", "－", 3, "上課嚴重干擾")], [W1]);
  assert.deepEqual(r.grades, ["丙"]);
  assert.deepEqual(r.daily, { 國語: 75, 數學: 75, 社會: 75 });
});

test("作業備註切份：靠「派）」切，名稱含頓號不會被切壞；舊格式無派出日", () => {
  assert.deepEqual(splitItems("乙本 L2、預習國 L2（10-14 派）、數習 P.1（10-14 派）", "2026-10-15").map((x) => x.key),
    ["乙本 L2、預習國 L2（10-14 派）", "數習 P.1（10-14 派）"]);
  assert.equal(splitItems("數習 P.1（12-30 派）", "2027-01-04")[0].due, "2026-12-30");
  assert.deepEqual(splitItems("國習、數習", "2026-09-03").map((x) => x.key), ["國習@2026-09-03", "數習@2026-09-03"]);
});

test("作業科目：只算國數社；預習國／聯絡簿／回條／考試預告不算；判不出回 null", () => {
  assert.equal(hwSubjectForScore("甲本 綜一 P.23-24"), "國語");
  assert.equal(hwSubjectForScore("數練 4-4"), "數學");
  assert.equal(hwSubjectForScore("社習 L1"), "社會");
  for (const n of ["預習國 L3", "聯絡簿", "交健康檢查通知回條", "考社L1", "【定期評量】", "自然習作"]) assert.equal(hwSubjectForScore(n), "", n);
  assert.equal(hwSubjectForScore("美勞作品"), null);
});

test("作業分：最後狀態為準；完成 100／要訂正 80／未交 0；沒紀錄＝判不出不算", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };
  const rows = [
    { seats: [1], date: "2026-10-15", desc: "作業沒交", note: "數習 P.1（10-14 派）" },
    { seats: [1], date: "2026-10-17", desc: "作業補交完成", note: "數習 P.1（10-14 派）" },        // 補交 → 100
    { seats: [2], date: "2026-10-15", desc: "作業沒有訂正", note: "數習 P.1（10-14 派）" },       // 仍要訂正 → 80
    { seats: [3], date: "2026-10-15", desc: "作業批改要訂正", note: "數習 P.1（10-14 派）" },
    { seats: [3], date: "2026-10-16", desc: "作業批改完成", note: "數習 P.1（10-14 派）" },       // 批改後完成 → 100
    { seats: [1, 2, 3], date: "2026-10-15", desc: "作業完成", note: "數練 4-4（10-14 派）" },
    { seats: [4], date: "2026-10-15", desc: "作業沒交", note: "數練 4-4（10-14 派）、國習 L2（10-14 派）" },
    { seats: [1], date: "2026-10-15", desc: "作業完成", note: "預習國 L3（10-14 派）、聯絡簿（10-15 派）" },
    { seats: [1], date: "2026-09-29", desc: "作業沒交", note: "國習 L1（09-28 派）" },              // 範圍外
  ];
  const { bySeat, manual } = homeworkScores(rows, range, [1, 2, 3, 4]);
  assert.deepEqual([1, 2, 3, 4].map((s) => bySeat.get(s).數學.hw), [100, 90, 100, 0]);
  assert.deepEqual(bySeat.get(2).數學.unknown, []);
  assert.deepEqual(bySeat.get(4).數學.unknown, ["數習 P.1（10-14 派）"]);   // 座號 4 數習沒紀錄 → 不算進平均
  assert.equal(bySeat.get(4).國語.hw, 0);
  assert.equal(bySeat.get(1).國語.hw, null);                                 // 範圍內沒有可算的國語作業（座號 4 的國習 L2 對座號 1 是判不出）
  assert.deepEqual(bySeat.get(1).國語.unknown, ["國習 L2（10-14 派）"]);
  assert.equal(bySeat.get(1).社會.hw, null);
  assert.equal(manual.length, 0);
});

test("作業分：同一天未交＋補交完成取較好；看不懂的描述列需人工；四捨五入不用銀行家", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };
  const rows = [
    { seats: [1], date: "2026-10-15", desc: "作業沒交", note: "社習 L1（10-14 派）" },
    { seats: [1], date: "2026-10-15", desc: "作業補交完成", note: "社習 L1（10-14 派）" },
    { seats: [1], date: "2026-10-16", desc: "作業沒有訂正", note: "社習 L2（10-15 派）" },
    { seats: [1], date: "2026-10-17", desc: "作業完成", note: "社習 L3（10-16 派）" },
    { seats: [1], date: "2026-10-18", desc: "作業完成", note: "社習 L4（10-17 派）" },
    { seats: [1], date: "2026-10-18", desc: "訂正完成", note: "社習 L4（10-17 派）" },
  ];
  const { bySeat, manual } = homeworkScores(rows, range, [1]);
  assert.equal(bySeat.get(1).社會.hw, 95);   // (100+80+100+100)/4＝95
  assert.equal(manual.length, 1);
  // 5 份完成＋3 份要訂正＝740／8＝92.5 → 四捨五入 93（銀行家捨入會變 92）
  const notes = ["A", "B", "C", "D", "E", "F", "G", "H"].map((x, i) => ({ seats: [1], date: "2026-10-15",
    desc: i < 5 ? "作業完成" : "作業沒有訂正", note: `國習 ${x}（10-14 派）` }));
  assert.equal(homeworkScores(notes, range, [1]).bySeat.get(1).國語.hw, 93);
});
