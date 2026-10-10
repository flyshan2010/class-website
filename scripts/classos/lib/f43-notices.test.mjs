import test from "node:test";
import assert from "node:assert/strict";
import { chunks, toNotices } from "./f43-notices.mjs";

test("切段後接回＝原文（含中文與 %）", () => {
  const text = JSON.stringify({ a: "缺交%未訂正".repeat(700) });
  const cs = chunks(text);
  assert.equal(cs.join(""), text);
  assert.ok(cs.length > 1 && cs.length <= 9);
});

test("再長也不超過 9 段", () => {
  assert.equal(chunks("x".repeat(50000)).length, 9);
});

test("notice 行：標題帶 i/N，% 與換行有跳脫", () => {
  const ls = toNotices("50%\n");
  assert.deepEqual(ls, ["::notice title=F43JSON 1/1::50%25%0A"]);
});

test("空字串也回一段", () => {
  assert.deepEqual(toNotices(""), ["::notice title=F43JSON 1/1::"]);
});
