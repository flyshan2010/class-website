import test from "node:test";
import assert from "node:assert/strict";
import { settleInboxDecision } from "./settle-inbox.mjs";

// 數字取自四上第7週兩次真實 run（38861754925 入帳前、38885889719 入帳後）
const unpaid = { job: { total: 705, paidN: 0 }, clean: { total: 270, paidN: 0 }, lunch: { total: 114, paidN: 0 }, routine: { total: 134, paidN: 0 }, hw: { total: 130, paidN: 0 } };
const paid = { job: { total: 705, paidN: 27 }, clean: { total: 270, paidN: 27 }, lunch: { total: 114, paidN: 13 }, routine: { total: 134, paidN: 27 }, hw: { total: 0, paidN: 26 } };

test("入帳前（14:32 那輪）：照建", () => {
  const d = settleInboxDecision({ formula: unpaid, rewardN: 67, badN: 0, ledgerHits: 0 });
  assert.equal(d.create, true);
});

test("入帳後（18:14 那輪）：全部已入帳 → 不建", () => {
  const d = settleInboxDecision({ formula: paid, rewardN: 0, badN: 0, ledgerHits: 27 + 27 + 13 + 27 + 26 + 96 });
  assert.equal(d.create, false);
  assert.match(d.reason, /本週已入帳/);
});

test("薪水已入、② 還有待入帳（加扣剛好相抵成 0 也一樣）→ 照建", () => {
  const d = settleInboxDecision({ formula: paid, rewardN: 2, badN: 0, ledgerHits: 120 });
  assert.equal(d.create, true);
  assert.match(d.reason, /②/);
});

test("只入了一部分（④ 未入）→ 照建", () => {
  const d = settleInboxDecision({ formula: { ...paid, lunch: { total: 114, paidN: 0 } }, rewardN: 0, badN: 0, ledgerHits: 100 });
  assert.equal(d.create, true);
  assert.match(d.reason, /lunch/);
});

test("⑦ 有人新累計滿 3 次未寫回 → 照建", () => {
  const d = settleInboxDecision({ formula: paid, rewardN: 0, badN: 1, ledgerHits: 100 });
  assert.equal(d.create, true);
});

test("公式項金額 0 且未入帳不算待入帳；帳本也沒有列 → 照建（讓老師看到本週 0）", () => {
  const zero = Object.fromEntries(Object.keys(unpaid).map(k => [k, { total: 0, paidN: 0 }]));
  assert.equal(settleInboxDecision({ formula: zero, rewardN: 0, badN: 0, ledgerHits: 0 }).create, true);
});
