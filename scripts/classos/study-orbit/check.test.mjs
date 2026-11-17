import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBundle, worstSaveBytes, SAVE_LIMIT_BYTES } from "./check.mjs";

import { BOOK, L1, L2, fixture } from "./fixture.mjs";

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
  12: (b) => {                                                                             // 關卡與盲點多到存檔爆量（第 2 版一關最多 B35）
    const book = b.books[0], isl = book.structure.islands[0];
    for (let n = 2; n <= 60; n++) {
      const code = `${book.code}-9-${n}`;
      isl.levels.push({ code, name: "x", exam: "期中", slots: isl.levels[0].slots });
      for (let i = 1; i <= 35; i++) b.blindspots.push({ code: `${code}-B${i}`, name: "x", kp: `${L1}-K1`, level: code, fix: "a", ex: "b", chk: "c", status: "可用" });
    }
  },
  "11b": (b) => { b.blindspots.push({ code: `${L1}-B36`, name: "x", kp: `${L1}-K1`, level: L1, fix: "a", ex: "b", chk: "c", status: "可用" }); }, // 盲點超過 B35
  14: (b) => { b.reviewCards[0].subject = "國語"; },                                        // 觀念卡科目不同
};
for (const [rule, breakIt] of Object.entries(BROKEN)) {
  test(`第 ${rule} 條：故意做錯會被抓到`, () => {
    const b = fixture();
    breakIt(b);
    assert.ok(rulesHit(b).has(parseInt(rule)), `第 ${rule} 條沒報錯`);
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
  assert.ok(bytes <= SAVE_LIMIT_BYTES, `${bytes} 超過 ${SAVE_LIMIT_BYTES}`); // P2 SPEC §4 第 2 版：試算約 4.1KB
  console.log(`國語 66 關 × 8 盲點最壞存檔：${bytes} bytes（上限 ${SAVE_LIMIT_BYTES}）`);
});
