import test from "node:test";
import assert from "node:assert/strict";
import { isR20, parsePart, groupBatches, planBatch, execLog, reviewText, STALE_MS } from "./quiz-scores.mjs";

// 示意資料（不是真成績）。
const HEAD = "#QUIZ-SCORES v1 115上-社會-L9 b1 1/1 · 社會 L9平時卷 3 人";
const META = { subject: "社會", name: "L9平時卷", date: "2026-10-15", year: "115", week: "四上第7週(10/12-10/16)" };
const ROSTER = new Map([[1, "s1"], [2, "s2"], [3, "s3"], [4, "s4"]]);

test("指紋：只看第一行開頭", () => {
  assert.equal(isR20(HEAD + "\n座號1 社會 L9平時卷 80分 錯:無"), true);
  assert.equal(isR20("記錄：座號1 #QUIZ-SCORES"), false);
});

test("解析：分數＋錯題碼、全對、缺考、全形冒號、看不懂的行", () => {
  const p = parsePart([HEAD, "座號1 社會 L9平時卷 80分 錯:一11,三1特色①(-1)", "座號2 社會 L9平時卷 100分 錯:無",
    "座號3 社會 L9平時卷 缺考", "座號4 社會 L9平時卷 90分 錯：二5", "亂寫一行"].join("\n"));
  assert.equal(p.examId, "115上-社會-L9");
  assert.deepEqual([p.part, p.total], [1, 1]);
  assert.deepEqual(p.rows, [
    { seat: 1, score: 80, absent: false, errors: "一11,三1特色①(-1)" },
    { seat: 2, score: 100, absent: false, errors: "無" },
    { seat: 3, score: null, absent: true, errors: "" },
    { seat: 4, score: 90, absent: false, errors: "二5" },
  ]);
  assert.deepEqual(p.bad, ["亂寫一行"]);
  assert.ok(parsePart("座號1 80分").error);
});

test("分批：各段到齊才 ready；沒到齊未逾時＝wait、逾時＝broken；格式錯＝broken", () => {
  const now = Date.parse("2026-10-26T10:00:00Z");
  const t = (id, head, created) => ({ id, text: head + "\n座號1 社會 L9平時卷 80分 錯:無", created });
  const g = groupBatches([
    t("a2", "#QUIZ-SCORES v1 X b1 2/2", "2026-10-26T09:59:01Z"),
    t("a1", "#QUIZ-SCORES v1 X b1 1/2", "2026-10-26T09:59:00Z"),
    t("c1", "#QUIZ-SCORES v1 X b2 1/2", "2026-10-26T09:58:00Z"),
    t("d1", "#QUIZ-SCORES v1 X b3 1/2", new Date(now - STALE_MS - 1000).toISOString()),
    { id: "e1", text: "#QUIZ-SCORES 壞掉", created: "2026-10-26T09:00:00Z" },
  ], now);
  const by = Object.fromEntries(g.map((x) => [x.tasks[0], x]));
  assert.equal(by.a1.state, "ready");
  assert.deepEqual(by.a1.tasks, ["a1", "a2"], "依建立時間排序");
  assert.equal(by.a1.rows.length, 2);
  assert.equal(by.c1.state, "wait");
  assert.equal(by.d1.state, "broken");
  assert.equal(by.e1.state, "broken");
});

test("計畫：新建、補錯題、沒變、分數不同保留舊分數仍補錯題、缺考對照", () => {
  const rows = parsePart([HEAD, "座號1 社會 L9平時卷 80分 錯:一11", "座號2 社會 L9平時卷 100分 錯:無",
    "座號3 社會 L9平時卷 70分 錯:二1", "座號4 社會 L9平時卷 缺考"].join("\n")).rows;
  const existing = [
    { id: "r2", student: "s2", score: 100, errors: "無" },      // 沒變
    { id: "r3", student: "s3", score: 75, errors: "" },         // 分數不同 → 保留，錯題仍補
    { id: "r4", student: "s4", score: 60, errors: "" },         // 紀錄庫有分數、錯題表缺考 → 衝突
  ];
  const p = planBatch(META, rows, ROSTER, existing);
  assert.equal(p.creates.length, 1);
  assert.deepEqual(p.creates[0].props, {
    事件描述: "社會平時考：L9平時卷 80分", 學生: "s1", 類別: "評量", 科目: "社會", 正負向: "中性",
    分數: 80, 評量名稱: "L9平時卷", 日期: "2026-10-15", 學年: "115", 週次: "四上第7週(10/12-10/16)", 錯題: "一11",
  });
  assert.deepEqual(p.patches, [{ seat: 3, id: "r3", errors: "二1" }]);
  assert.equal(p.same, 2, "座號2 一樣、座號4 缺考錯題空白一樣");
  assert.deepEqual(p.conflicts, ["座號3 紀錄庫75分／錯題表70分", "座號4 紀錄庫60分／錯題表缺考"]);
  assert.deepEqual(p.problems, []);
  assert.match(execLog(META, p), /新建 1 列、補錯題 1 列、沒變 2 列；分數不同 2 人/);
  assert.match(reviewText(p), /^分數不同/);
});

test("計畫：新建缺考列分數空白", () => {
  const p = planBatch(META, [{ seat: 1, score: null, absent: true, errors: "" }], ROSTER, []);
  assert.equal(p.creates[0].props.分數, null);
  assert.equal(p.creates[0].props.事件描述, "社會平時考：L9平時卷 缺考");
});

test("計畫：fail-closed——名冊查無、重複列、同批重複座號、錯題碼空白都不寫", () => {
  const rows = [
    { seat: 9, score: 80, absent: false, errors: "無" },
    { seat: 1, score: 80, absent: false, errors: "無" },
    { seat: 2, score: 80, absent: false, errors: "無" },
    { seat: 2, score: 70, absent: false, errors: "一1" },
    { seat: 3, score: 80, absent: false, errors: "" },
  ];
  const existing = [{ id: "x", student: "s1", score: 80, errors: "" }, { id: "y", student: "s1", score: 80, errors: "" }];
  const p = planBatch(META, rows, ROSTER, existing);
  assert.equal(p.creates.length, 1, "只有座號2 第一次那行");
  assert.equal(p.patches.length, 0);
  assert.equal(p.problems.length, 4);
  assert.match(p.problems.join("|"), /座號1 紀錄庫已有 2 列/);
  assert.match(p.problems.join("|"), /座號9 名冊查無/);
});
