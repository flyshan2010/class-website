// 執行：node --test scripts/essay-analysis.test.mjs
// 作文說明單「作文分析」彙整（scripts/lib/essay-analysis.mjs）；全部用假資料，不含真實學生內容。
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeEssays, topicMatches, parseScores } from "./lib/essay-analysis.mjs";

const card = (l, t, s, c, cr) => [`版面字體｜${l}｜字工整`, `文字標點｜${t}｜訂正錯字`, `段落結構｜${s}｜四段清楚`, `主旨切題｜${c}｜切題`, `創意真情｜${cr}｜很真`].join("\n");
const R = o => ({ 報告類型: "作文批改", 作文_題目: "失敗的滋味", 期間: "2026-11-12", 發布: false,
  作文_總評等第: "甲", 作文_成績單: card("甲", "甲", "甲", "甲", "甲"), 作文_升級站: "全文約 320 字，四段。",
  作文_開場: "目標\n\n開場\n\n「這句很好。」——讚", 作文_抓漏: "", 作文_原文: "", ...o });

test("題目比對：去標點、○ 當萬用字", () => {
  assert.ok(topicMatches("保護海洋，我的行動", "保護海洋 我的行動"));
  assert.ok(topicMatches("對○○的特別回憶", "對奶奶的特別回憶"));
  assert.ok(!topicMatches("對○○的特別回憶", "一次溫暖的幫助"));
  assert.ok(!topicMatches("失敗的滋味", "失敗的滋味續集"));
});

test("成績單解析：五項關鍵字對應", () => {
  assert.deepEqual(parseScores(card("甲", "甲下", "甲上", "優", "乙上")), { 版面: 6, 文字標點: 5, 段落結構: 7, 主旨切題: 8, 創意真情: 4 });
});

test("沒有相符批改列 → null（前端顯示尚未批改）", () => {
  assert.equal(analyzeEssays({ topic: "保護海洋，我的行動", rows: [R({ 座號: 1 })], seats: [1], tiers: null }), null);
});

test("彙整：分布、中位數、最弱分項、分層驗證、錯字、需人工、缺交", () => {
  const rows = [
    R({ 座號: 1, 作文_總評等第: "甲上", 作文_成績單: card("甲", "甲下", "甲上", "甲上", "甲上"), 作文_抓漏: "「例用時間」要寫成「利用」，「藍球」要寫成「籃球」。" }),
    R({ 座號: 2, 作文_總評等第: "甲下", 作文_成績單: card("甲", "乙上", "甲下", "甲", "甲"), 作文_升級站: "約 230 字", 作文_原文: "我[？疑似：玩]球", 作文_抓漏: "「藍球」要寫成「籃球」" }),
    R({ 座號: 3, 作文_總評等第: "甲", 作文_成績單: card("甲", "甲", "甲", "甲下", "甲").replace("切題", "有點偏題") }),
    R({ 座號: 3, 期間: "2026-11-01", 作文_總評等第: "乙" }), // 舊列不算
    R({ 座號: 9, 作文_總評等第: "優" }),                      // 不在名冊
    R({ 座號: 1, 作文_題目: "下課時間", 作文_總評等第: "乙" }), // 別題
  ];
  const tiers = { 挑戰版: [[1, "技巧"]], 進階版: [[2, "組織"]], 基礎版: [[3, "審題"], [4, "選材"]] };
  const a = analyzeEssays({ topic: "失敗的滋味", rows, seats: [1, 2, 3, 4], tiers });
  assert.equal(a.done, 3); assert.equal(a.roster, 4); assert.deepEqual(a.missing, [4]);
  assert.equal(a.dist["甲上"], 1); assert.equal(a.dist["甲"], 1); assert.equal(a.dist["甲下"], 1); assert.equal(a.dist["乙"], 0);
  assert.equal(a.median, "甲");
  assert.deepEqual(a.weakest, { dim: "文字標點", step: "技巧", avg: 5 });
  assert.deepEqual(a.bytier, { 挑戰版: { n: 1, avg: 7 }, 進階版: { n: 1, avg: 5 }, 基礎版: { n: 1, avg: 6 } });
  assert.deepEqual(a.typos[0], ["籃球", 2]);
  const r2 = a.rows.find(x => x.seat === 2), r3 = a.rows.find(x => x.seat === 3);
  assert.deepEqual(r2.flags, ["辨識不清", "字數不到250"]); assert.equal(r2.weak, "技巧");
  assert.deepEqual(r3.flags, ["偏題"]); assert.equal(r3.weak, "審題");
  assert.equal(a.rows.find(x => x.seat === 1).weak, "技巧");
  assert.deepEqual(a.wc, { avg: 290, min: 230, under250: 1, under300: 1 });
  assert.equal(a.shine.length, 3); assert.equal(a.shine[0].seat, 1);
  assert.ok(!JSON.stringify(a).includes("姓名"));
});

test("最弱步驟同分依 審題→選材→組織→技巧→檢查", () => {
  const a = analyzeEssays({ topic: "失敗的滋味", rows: [R({ 座號: 1 })], seats: [1], tiers: null });
  assert.equal(a.rows[0].weak, "審題");
});

test("「沒有偏題」不算偏題；等第缺漏要標", () => {
  const a = analyzeEssays({ topic: "失敗的滋味", rows: [R({ 座號: 1, 作文_總評等第: "", 作文_成績單: card("甲", "甲", "甲", "甲", "甲").replace("切題", "沒有偏題") })], seats: [1], tiers: null });
  assert.deepEqual(a.rows[0].flags, ["等第缺漏"]);
});
