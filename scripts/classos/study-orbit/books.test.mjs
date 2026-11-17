import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOptions, bundleFromNotion, buildBookFiles } from "./books.mjs";
import { BOOK, L1, L2, fixture } from "./fixture.mjs";

const live = () => { const b = fixture(); b.books[0].status = "上線"; b.books[0].name = "測試本"; b.books[0].semester = "4上"; return b; };

test("選項欄：選擇題四個選項、配合題左 1. 右 A.", () => {
  assert.deepEqual(parseOptions("選擇", "A. 甲\nB. 乙\nC. 丙\nD. 丁"), { options: ["甲", "乙", "丙", "丁"] });
  assert.deepEqual(parseOptions("配合", "1. 一\n2. 二\nA. 甲\nB. 乙"), { left: ["一", "二"], right: ["甲", "乙"] });
});

test("Notion 列轉資料包：關聯換成代碼、沒有關卡代碼的一般題庫題不收", () => {
  const raw = {
    books: [{ _id: "b1", 代碼: "m-h-4a", 名稱: "四上數學", 科目: "數學", 狀態: "上線", 年級: "4", 學期: "上", 最後更新日期: { start: "2026-11-17" } }],
    structures: new Map([["b1", { islands: [] }]]),
    kps: [{ _id: "k1", 代碼: "m-h-4a-1-1-K1", 名稱: "位值", 科目: "數學", 題本: ["b1"], 關卡代碼: "m-h-4a-1-1", 觀念複習卡: ["c1"], 狀態: "可用" }],
    blindspots: [{ _id: "s1", 代碼: "m-h-4a-1-1-B1", 卡名: "漏位", 知識點: ["k1"], 關卡代碼: "m-h-4a-1-1", 正確的想法: "a", 看例子: "b", 檢查口訣: "c", 狀態: "可用" }],
    stories: [{ _id: "t1", 關卡代碼: "m-h-4a-1-1", 題本: ["b1"], 標題: "小", 內文: "文", 狀態: "可用" }],
    questions: [
      { _id: "q1", 題目ID: "MA4-0001", 題型: "選擇", 關卡代碼: "m-h-4a-1-1", 格: 1, 占格: 1, 母題: [], 知識點: ["k1"], 盲點: ["s1"],
        選項盲點: "B=m-h-4a-1-1-B1", 選項: "A. 1\nB. 2\nC. 3\nD. 4", 正確答案: "A", 題幹: "幾？", 提示1: "x", 提示2: "y", 解析: "z", 題組: "", 共用素材: "", 素材類型: "", 狀態: "可用" },
      { _id: "q2", 題目ID: "MA4-0002", 題型: "選擇", 關卡代碼: "m-h-4a-1-1", 格: 1, 占格: "", 母題: ["q1"], 知識點: ["k1"], 盲點: ["s1"], 狀態: "可用" },
      { _id: "q3", 題目ID: "MA4-0100", 題型: "選擇", 關卡代碼: "", 狀態: "可用" },
    ],
    reviewCards: [{ _id: "c1", 卡名: "大數", 科目: "數學", 狀態: "上架" }],
  };
  const B = bundleFromNotion(raw);
  assert.equal(B.books[0].semester, "4上");
  assert.equal(B.kps[0].book, "m-h-4a");
  assert.equal(B.kps[0].reviewCard, "大數");
  assert.equal(B.blindspots[0].kp, "m-h-4a-1-1-K1");
  assert.equal(B.questions.length, 2, "一般題庫題不收");
  assert.equal(B.questions[1].mother, "MA4-0001");
  assert.equal(B.questions[1].span, 1, "占格空白當 1");
  assert.deepEqual(B.questions[0].blindspots, ["m-h-4a-1-1-B1"]);
  assert.deepEqual(B.questions[0].options, ["1", "2", "3", "4"]);
});

test("合格又上線：輸出兩關、題數 = 14 × 2、沒有座號姓名查詢碼與審題欄", () => {
  const { index, files, log } = buildBookFiles(live());
  assert.equal(index.books.length, 1);
  assert.equal(index.books[0].structure.islands[0].levels.length, 2);
  const f = files[BOOK];
  assert.equal(f.questions.reduce((n, q) => n + q.span, 0), 28);
  assert.equal(f.stories.length, 2);
  const s = JSON.stringify({ index, files });
  assert.doesNotMatch(s, /座號|查詢碼|姓名|"status"|optionBlindspots/);
  const m = f.questions.find((q) => q.type === "配合");
  assert.deepEqual(m.ob, { 1: `${L2}-B1`, 2: `${L2}-B2`, 3: `${L2}-B1`, 4: `${L2}-B2` });
  assert.ok(f.blindspots[0].card.fix);
  assert.match(log.at(-1), /✅/);
});

test("不是上線的題本不輸出", () => {
  const b = fixture(); // 狀態＝試行
  assert.equal(buildBookFiles(b).index.books.length, 0);
});

test("有檢核錯誤：這本不輸出，index 沿用上一版那一列；別本照常", () => {
  const b = live();
  const other = live();
  // 第二本：把代碼換掉當作另一本
  const rename = (x) => JSON.parse(JSON.stringify(x).replaceAll(BOOK, "m-x-t2"));
  const b2 = rename(other);
  for (const k of ["books", "kps", "blindspots", "stories", "questions"]) b[k].push(...b2[k]);
  b.questions.find((q) => q.level === L1).options[1] = b.questions.find((q) => q.level === L1).options[0]; // 第 3 條：選項重複
  const prev = { books: [{ code: BOOK, title: "上一版" }] };
  const r = buildBookFiles(b, prev);
  assert.equal(r.files[BOOK], undefined, "壞的那本不輸出");
  assert.deepEqual(r.kept, [BOOK]);
  assert.deepEqual(r.index.books.map((x) => x.title ?? x.code), ["上一版", "測試本"]);
  assert.ok(r.files["m-x-t2"], "另一本照常");
  assert.ok(r.log.some((l) => /第 3 條/.test(l)));
});

test("一題待審：那一關不放（fail-closed），其他關照常", () => {
  const b = live();
  b.questions.find((q) => q.level === L1).status = "待審";
  const r = buildBookFiles(b);
  assert.deepEqual(r.index.books[0].structure.islands[0].levels.map((l) => l.code), [L2]);
  assert.ok(r.files[BOOK].questions.every((q) => q.level === L2));
});
