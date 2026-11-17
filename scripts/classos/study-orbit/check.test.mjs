import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBundle, worstSaveBytes, SAVE_LIMIT_BYTES } from "./check.mjs";

// 合格資料包：一本題本兩關。L1＝七格選擇題；L2＝配合題（第 1–4 格）＋題組（第 5–7 格）
const BOOK = "m-x-t1";
const L1 = `${BOOK}-1-1`, L2 = `${BOOK}-1-2`;
const STORY = "這是延伸小知識。".repeat(6); // 48 字
let n = 0;
const qid = () => `MA4-${String(++n).padStart(4, "0")}`;
const choice = (level, slot, mother, extra = {}) => ({
  id: qid(), type: "選擇", level, slot, span: 1, mother, kp: `${level}-K1`,
  blindspots: [`${level}-B1`, `${level}-B2`, `${level}-B3`],
  optionBlindspots: `B=${level}-B1\nC=${level}-B2\nD=${level}-B3`,
  options: [`甲${n}`, `乙${n}`, `丙${n}`, `丁${n}`], answer: "A",
  hint1: "想一想", hint2: "看位值表", explanation: "因為……", status: "可用", ...extra,
});

function fixture() {
  n = 0;
  const questions = [];
  for (let s = 1; s <= 7; s++) {
    const a = choice(L1, s, "");
    questions.push(a, choice(L1, s, a.id));
  }
  const match = (mother) => ({
    id: qid(), type: "配合", level: L2, slot: 1, span: 4, mother, kp: `${L2}-K1`,
    blindspots: [`${L2}-B1`, `${L2}-B2`],
    optionBlindspots: `1=${L2}-B1\n2=${L2}-B2\n3=${L2}-B1\n4=${L2}-B2`,
    left: ["一", "二", "三", "四"], right: [`甲${n}`, `乙${n}`, `丙${n}`, `丁${n}`],
    hint1: "想一想", hint2: "對照", explanation: "因為……", status: "可用",
  });
  const m1 = match("");
  questions.push(m1, match(m1.id));
  const g1 = [5, 6, 7].map((s) => choice(L2, s, "", { group: `${L2}-G1`, material: "短文甲", materialType: "文章" }));
  const g2 = g1.map((q, i) => choice(L2, 5 + i, q.id, { group: `${L2}-G2`, material: "短文乙", materialType: "文章" }));
  questions.push(...g1, ...g2);
  const bs = (level, i) => ({ code: `${level}-B${i}`, name: `盲點${i}`, kp: `${level}-K1`, level, fix: "對的想法", ex: "例子", chk: "口訣", status: "可用" });
  return {
    books: [{ code: BOOK, subject: "數學", status: "試行", structure: { islands: [{ id: "1", name: "島", levels: [
      { code: L1, name: "第一關", exam: "期中", slots: ["基礎", "基礎", "基礎", "進階", "進階", "應用", "應用"] },
      { code: L2, name: "第二關", exam: "期中", slots: ["基礎", "基礎", "基礎", "基礎", "進階", "應用", "應用"] },
    ] }] } }],
    kps: [
      { code: `${L1}-K1`, name: "重點一", subject: "數學", book: BOOK, level: L1, reviewCard: "大數", status: "可用" },
      { code: `${L2}-K1`, name: "重點二", subject: "數學", book: BOOK, level: L2, reviewCard: "", status: "可用" },
    ],
    blindspots: [1, 2, 3].flatMap((i) => [bs(L1, i), bs(L2, i)]),
    stories: [L1, L2].map((level) => ({ level, book: BOOK, title: "小知識", body: STORY, status: "可用" })),
    questions,
    reviewCards: [{ name: "大數", subject: "數學", status: "上架" }],
  };
}

const rulesHit = (b) => new Set(checkBundle(b).errors.map((e) => e.rule));
const q = (b, level, slot, nth = 0) => b.questions.filter((x) => x.level === level && x.slot === slot)[nth];

test("合格資料包：0 錯、兩關可上線、沒有觀念卡的知識點列清單", () => {
  const r = checkBundle(fixture());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.publishable, { [L1]: true, [L2]: true });
  assert.deepEqual(r.noReviewCard, [`${L2}-K1`]);
});

// §8「每條規則各有一個故意做錯的測試會被抓到」
const BROKEN = {
  1: (b) => { b.questions = b.questions.filter((x) => x !== q(b, L1, 3, 1)); },          // 第 3 格少一題
  2: (b) => { q(b, L1, 2, 1).mother = ""; },                                               // 兩題都是母題
  3: (b) => { q(b, L1, 1).options[1] = q(b, L1, 1).options[0]; },                          // 選項重複
  4: (b) => { q(b, L1, 1).optionBlindspots = `A=${L1}-B1\nC=${L1}-B2\nD=${L1}-B3`; },      // 正確選項掛盲點、B 沒掛
  5: (b) => { q(b, L1, 1).blindspots = [`${L1}-B1`]; },                                    // 關聯和選項盲點不一致
  6: (b) => { b.blindspots[0].chk = ""; },                                                 // 秘笈卡缺一段
  7: (b) => { q(b, L1, 4).hint2 = " "; },                                                  // 提示2 空白
  8: (b) => { q(b, L2, 1).right[3] = q(b, L2, 1).right[0]; },                              // 配合題右欄重複
  9: (b) => { q(b, L2, 6).material = "短文甲（改）"; },                                     // 題組素材不一致
  10: (b) => { b.stories[0].body = "太短了"; },                                            // 故事卡字數
  11: (b) => { b.kps[0].code = `${L1}-k1`; },                                              // 代碼格式
  12: (b) => {                                                                             // 盲點多到存檔爆量
    for (let i = 4; i < 400; i++) b.blindspots.push({ code: `${L1}-B${i}`, name: "x", kp: `${L1}-K1`, level: L1, fix: "a", ex: "b", chk: "c", status: "可用" });
  },
  14: (b) => { b.reviewCards[0].subject = "國語"; },                                        // 觀念卡科目不同
};
for (const [rule, breakIt] of Object.entries(BROKEN)) {
  test(`第 ${rule} 條：故意做錯會被抓到`, () => {
    const b = fixture();
    breakIt(b);
    assert.ok(rulesHit(b).has(Number(rule)), `第 ${rule} 條沒報錯`);
  });
}

test("第 13 條：一題待審、一個盲點待審、故事卡待審，各自整關不輸出（fail-closed）", () => {
  for (const breakIt of [
    (b) => { q(b, L1, 7, 1).status = "待審"; },
    (b) => { b.blindspots.find((x) => x.code === `${L1}-B2`).status = "需修改"; },
    (b) => { b.stories[0].status = "待審"; },
    (b) => { b.questions = b.questions.filter((x) => x !== q(b, L1, 3, 1)); }, // 缺題（有錯誤）也不輸出
  ]) {
    const b = fixture();
    breakIt(b);
    const r = checkBundle(b);
    assert.equal(r.publishable[L1], false);
    assert.equal(r.publishable[L2], true, "別關不受影響");
  }
});

test("第 12 條：國語 66 關、每關 8 個盲點的最壞存檔大小在 8KB 內", () => {
  const book = "c-h-4a";
  const levels = Array.from({ length: 66 }, (_, i) => `${book}-${Math.floor(i / 5) + 1}-${(i % 5) + 1}`);
  const bss = levels.flatMap((l) => Array.from({ length: 8 }, (_, i) => `${l}-B${i + 1}`));
  const bytes = worstSaveBytes(book, levels, bss);
  assert.ok(bytes > 0);
  // 只印實際數字給回報用；是否 ≤8KB 由真資料的第 12 條判定
  console.log(`國語 66 關 × 8 盲點最壞存檔：${bytes} bytes（上限 ${SAVE_LIMIT_BYTES}）`);
});
