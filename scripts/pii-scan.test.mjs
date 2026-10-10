// 執行：node --test scripts/pii-scan.test.mjs
// 測試資料全是虛構的姓名與查詢碼（公開 repo 不得出現真的）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNeedles, isBinary, scanText, scanFile } from "./pii-scan.mjs";

const ROWS = [
  { 座號: 1, 姓名: "測試甲", 查詢碼: "7391", 在學: true },
  { 座號: 2, 姓名: "假名乙丙", 查詢碼: "8264", 在學: true },
  { 座號: "", 姓名: "轉出丁", 查詢碼: "", 在學: false },
];
const N = buildNeedles(ROWS);

test("每位在學學生產生姓名＋查詢碼；轉出生的姓名也比對", () => {
  assert.equal(N.length, 5);
  assert.deepEqual(scanText("今天轉出丁來訪", N), [{ line: 1, seat: "？", kind: "姓名" }]);
});

test("姓名出現就算，回報行號與座號", () => {
  assert.deepEqual(scanText("第一行\n恭喜假名乙丙得獎", N), [{ line: 2, seat: "2", kind: "姓名" }]);
});

test("遮蔽後的姓名、只寫座號不算", () => {
  assert.deepEqual(scanText("測○甲、座號 1、1 號", N), []);
});

test("查詢碼獨立出現才算", () => {
  assert.equal(scanText('{"code":"7391"}', N).length, 1);
  assert.equal(scanText("查詢碼 8264。", N).length, 1);
});

test("查詢碼緊鄰英數字或連字號不算（雜湊、日期、UUID 片段）", () => {
  for (const s of ["a7391", "73910", "17391", "7391-05", "2026-7391", "c9674fb67391e"]) {
    assert.deepEqual(scanText(s, N), [], s);
  }
});

test("二進位檔（前 8000 位元組含 NUL）不掃內容，但檔名照比對", () => {
  const bin = Buffer.concat([Buffer.from([0xff, 0xd8, 0x00]), Buffer.from(" 7391 測試甲")]);
  assert.equal(isBinary(bin), true);
  assert.deepEqual(scanFile("data/uploads/a.jpg", bin, N), []);
  assert.deepEqual(scanFile("data/uploads/測試甲.jpg", bin, N), ["檔名含座號 1 的姓名"]);
});

test("文字檔命中的說明不含姓名與查詢碼", () => {
  const out = scanFile("data/x.json", Buffer.from('{"a":"測試甲","b":"8264"}'), N);
  assert.deepEqual(out, ["data/x.json:1：座號 1 的姓名", "data/x.json:1：座號 2 的查詢碼"]);
  assert.ok(!/測試甲|8264/.test(out.join("")));
});

test("名冊不對就丟錯（fail-closed）", () => {
  assert.throws(() => buildNeedles([]), /沒有任何在學學生/);
  assert.throws(() => buildNeedles([{ 座號: 3, 姓名: "", 查詢碼: "1111", 在學: true }]), /座號 3 沒有姓名/);
  assert.throws(() => buildNeedles([{ 座號: 5, 姓名: "測試己", 查詢碼: "", 在學: true }]), /讀不到任何查詢碼/);
  assert.throws(() => buildNeedles([{ 座號: 4, 姓名: "測試戊", 查詢碼: "12-4", 在學: true }]), /座號 4 的查詢碼不是純英數字/);
});
