import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBundle, worstSaveBytes, SAVE_LIMIT_BYTES, chartProblems } from "./check.mjs";

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
  15: (b) => { Object.assign(q(b, L1, 1), { material: "{壞掉", materialType: "圖表" }); },  // 圖表 JSON 壞掉
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

// 第 15 條：圖表素材（SPEC §3.6.1 的五個範例都要合格）
const EX = [
  '{"k":"bar","title":"四年甲班最喜歡的運動","unit":"人","cat":"運動","labels":["籃球","躲避球","跑步","游泳"],"series":[{"name":"","vals":[8,12,4,6]}],"max":12,"step":2}',
  '{"k":"bar","title":"模範生選舉得票數","unit":"票","labels":["甲","乙","丙","丁","戊"],"series":[{"name":"","vals":[520,610,580,640,550]}],"min":500,"max":650,"step":10,"lab":5}',
  '{"k":"bar","title":"各社團男女生人數","unit":"人","cat":"社團","labels":["桌球","合唱","圍棋"],"series":[{"name":"男生","vals":[9,3,7]},{"name":"女生","vals":[5,10,4]}],"max":16,"step":2,"dir":"h","stack":true}',
  '{"k":"line","title":"某日 8 時到 16 時的氣溫","unit":"°C","cat":"時","labels":["8","10","12","14","16"],"series":[{"name":"","vals":[14,17,20,19,15]}],"min":10,"max":22,"step":2}',
  '{"k":"table","title":"位值表","head":["萬位","千位","百位","十位","個位"],"rows":[[5,0,3,0,6]]}',
];
test("第 15 條：SPEC 範例全部合格", () => { for (const t of EX) assert.deepEqual(chartProblems(t), [], t); });

test("第 15 條：每條限制都抓得到", () => {
  const bar = JSON.parse(EX[0]), line = JSON.parse(EX[3]);
  const bad = (mut, base = bar) => { const d = structuredClone(base); mut(d); return chartProblems(JSON.stringify(d)); };
  const cases = {
    "不是 JSON": () => chartProblems("{k:bar}"),
    "換行": () => chartProblems(EX[0].replace(",", ",\n")),
    "超過 1500 字元": () => chartProblems(EX[0].replace('"人"', `"${"人".repeat(1500)}"`)),
    "k 不對": () => bad((d) => { d.k = "pie"; }),
    "打錯欄位": () => bad((d) => { d.vlas = 1; }),
    "標題太長": () => bad((d) => { d.title = "長".repeat(25); }),
    "沒有單位": () => bad((d) => { d.unit = ""; }),
    "labels 太少": () => bad((d) => { d.labels = ["籃球"]; d.series[0].vals = [8]; }),
    "labels 重複": () => bad((d) => { d.labels[1] = "籃球"; }),
    "vals 個數不對": () => bad((d) => { d.series[0].vals.pop(); }),
    "兩位小數": () => bad((d) => { d.series[0].vals[0] = 8.25; }),
    "數值是字串": () => bad((d) => { d.series[0].vals[0] = "8"; }),
    "一組卻有 name": () => bad((d) => { d.series[0].name = "人數"; }),
    "兩組 name 重複": () => bad((d) => { d.series.push({ name: "", vals: [1, 2, 3, 4] }); }),
    "四組": () => bad((d) => { d.series = ["a", "b", "c", "d"].map((name) => ({ name, vals: [1, 2, 3, 4] })); }),
    "格數不是整數": () => bad((d) => { d.step = 5; }),
    "格數超過 20": () => bad((d) => { d.step = 0.5; }),
    "超過 max": () => bad((d) => { d.series[0].vals[1] = 14; }),
    "省略處不比最小值小": () => bad((d) => { d.min = 4; }),
    "兩個 null": () => bad((d) => { d.series[0].vals[0] = null; d.series[0].vals[1] = null; }),
    "折線不能 dir": () => bad((d) => { d.dir = "h"; }, line),
    "dir 不對": () => bad((d) => { d.dir = "x"; }),
    "堆疊只有一組": () => bad((d) => { d.stack = true; }),
    "堆疊相加超過 max": () => bad((d) => { d.max = 12; d.step = 2; }, JSON.parse(EX[2])),
    "堆疊有 null": () => bad((d) => { d.series[0].vals[0] = null; }, JSON.parse(EX[2])),
    "表格列不等長": () => bad((d) => { d.rows.push([1, 2]); }, JSON.parse(EX[4])),
    "表格 head 不等長": () => bad((d) => { d.head.pop(); }, JSON.parse(EX[4])),
  };
  for (const [name, run] of Object.entries(cases)) assert.ok(run().length > 0, `${name} 沒抓到`);
  assert.deepEqual(bad((d) => { d.series[0].vals[2] = null; }), [], "一個 null 是合格的");
});

test("第 15 條：接進 checkBundle（圖表單題合格、文章單題與壞圖被抓）", () => {
  const ok = fixture();
  Object.assign(q(ok, L1, 1), { material: EX[0], materialType: "圖表" });
  for (const x of q(ok, L2, 5) ? ok.questions.filter((x) => x.group) : []) x.materialType = "圖表", x.material = x.group.endsWith("G1") ? EX[0] : EX[3];
  assert.deepEqual(checkBundle(ok).errors, [], "圖表單題＋3 小題圖表題組應合格");
  const b1 = fixture(); Object.assign(q(b1, L1, 1), { material: "一段文章", materialType: "文章" });
  assert.ok(rulesHit(b1).has(15), "文章單題沒抓到");
  const b2 = fixture(); Object.assign(q(b2, L1, 1), { material: EX[0].replace('"max":12', '"max":10'), materialType: "圖表" });
  assert.ok(rulesHit(b2).has(15), "壞圖沒抓到");
  const b3 = fixture(); Object.assign(q(b3, L1, 1), { material: EX[0], materialType: "" });
  assert.ok(rulesHit(b3).has(15), "有素材沒類型沒抓到");
});

// P3 §13.4：每格可以多於 2 題（塔題也是闖關題）；塔題類欄
const extra = (b, level, slot, patch = {}) => {
  const root = b.questions.find((x) => x.level === level && x.slot === slot && !x.mother);
  const c = { ...JSON.parse(JSON.stringify(root)), id: "MA4-0" + (900 + b.questions.length), mother: root.id, ...patch };
  b.questions.push(c);
  return c;
};
test("§13.4：一格 3 題、5 題都合格，照樣可上線", () => {
  const b = fixture();
  extra(b, L1, 1); extra(b, L1, 2); extra(b, L1, 2); extra(b, L1, 2);
  extra(b, L2, 1); // 配合格多一題
  const r = checkBundle(b);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.publishable, { [L1]: true, [L2]: true });
});
test("§13.4 第 2 條：多出的題指向別題、知識點不同、題型不同、盲點不屬於該知識點都會被抓到", () => {
  const cases = [
    (b) => { const x = extra(b, L1, 1); x.mother = q(b, L1, 2).id; },
    (b) => { const x = extra(b, L1, 1); x.mother = ""; },
    (b) => { extra(b, L1, 1, { kp: `${L2}-K1` }); },
    (b) => { extra(b, L2, 1, { type: "選擇", span: 1, options: ["甲", "乙", "丙", "丁"], answer: "A" }); },
    (b) => { b.kps.push({ code: `${L1}-K2`, name: "重點三", subject: "數學", book: BOOK, level: L1, reviewCard: "", status: "可用" });
      b.blindspots.push({ code: `${L1}-B4`, name: "盲點4", kp: `${L1}-K2`, level: L1, fix: "a", ex: "b", chk: "c", status: "可用" });
      const x = extra(b, L1, 1); x.blindspots = [`${L1}-B1`, `${L1}-B2`, `${L1}-B4`]; x.optionBlindspots = `B=${L1}-B1\nC=${L1}-B2\nD=${L1}-B4`; },
  ];
  cases.forEach((breakIt, i) => { const b = fixture(); breakIt(b); assert.ok(rulesHit(b).has(2), `第 ${i + 1} 例`); });
  const ok = fixture();
  ok.blindspots.push({ code: `${L1}-B4`, name: "盲點4", kp: `${L1}-K1`, level: L1, fix: "a", ex: "b", chk: "c", status: "可用" });
  const x = extra(ok, L1, 1); x.blindspots = [`${L1}-B1`, `${L1}-B2`, `${L1}-B4`]; x.optionBlindspots = `B=${L1}-B1\nC=${L1}-B2\nD=${L1}-B4`;
  assert.ok(!rulesHit(ok).has(2), "新增同知識點的盲點可以");
});
test("第 16 條：塔題類只能五個、只有國語題能填", () => {
  const b = fixture(); q(b, L1, 1).tw = "字音";
  assert.ok(rulesHit(b).has(16), "數學題不能填");
  const c = fixture(); c.books[0].code = "c-x-t1";
  c.books[0].structure.islands[0].levels.forEach((l) => { l.code = l.code.replace("m-x-t1", "c-x-t1"); });
  const ren = (s) => String(s).replace(/m-x-t1/g, "c-x-t1");
  for (const t of ["kps", "blindspots", "stories", "questions"]) c[t] = c[t].map((r) => JSON.parse(ren(JSON.stringify(r))));
  c.questions[0].tw = "字音"; c.questions[2].tw = "情境";
  const r = checkBundle(c);
  assert.ok(!r.errors.some((e) => e.rule === 16), JSON.stringify(r.errors.filter((e) => e.rule === 16)));
  c.questions[0].tw = "字詞";
  assert.ok(rulesHit(c).has(16), "不在表內");
});
test("塔題池報告：國語每本報各層題池數（只警告）", () => {
  const c = fixture(); c.books[0].subject = "國語";
  const r = checkBundle(c);
  assert.deepEqual(r.towerPools, { [BOOK]: {} });
  assert.deepEqual(r.towerWarn, []);
});
