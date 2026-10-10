// 執行：node --test scripts/pii-scan.test.mjs
// 測試資料全是虛構的姓名與查詢碼（公開 repo 不得出現真的）。
// CASES 與 Project/Claude/dotclaude/scripts/test_pii_gate.py 的 CASES 是同一張表，改規則兩邊一起改。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNeedles, isBinary, classify, scanFile, NEAR, LIST_SPAN } from "./pii-scan.mjs";

const ROWS = [
  { 座號: 1, 姓名: "測試甲", 查詢碼: "7391", 在學: true },
  { 座號: 2, 姓名: "假名乙丙", 查詢碼: "8264", 在學: true },
  { 座號: 3, 姓名: "樣本丁", 查詢碼: "5027", 在學: true },
  { 座號: 4, 姓名: "王戊", 查詢碼: "6158", 在學: true },
  { 座號: "", 姓名: "轉出己", 查詢碼: "", 在學: false },
];
const N = buildNeedles(ROWS);
const pad = n => "。".repeat(n);

// [說明, 文字, 要擋幾處, 弱命中幾處]
const CASES = [
  ["姓名出現就擋", "第一行\n恭喜假名乙丙得獎", 1, 0],
  ["轉出生的姓名也擋", "今天轉出己來訪", 1, 0],
  ["遮蔽後的姓名、只寫座號不算", "測○甲、座號 1、1 號", 0, 0],
  ["孤零零的同值數字＝弱命中", "總共 7391 元", 0, 1],
  ["JSON 值裡孤零零的同值數字＝弱命中", '{"amount":"7391"}', 0, 1],
  ["緊鄰英數字或連字號不算", "a7391 73910 17391 7391-05 2026-7391 c9674fb67391e", 0, 0],
  ["a：附近有「查詢碼」", "查詢碼 8264。", 1, 0],
  ["a：附近有「密碼」（在後面也算）", "7391 是他的密碼", 1, 0],
  ["a：字樣剛好在範圍內", "查詢碼" + pad(NEAR - 3) + "7391", 1, 0],
  ["a：字樣剛好超出範圍", "查詢碼" + pad(NEAR - 2) + "7391", 0, 1],
  ["b：同一位學生的座號（JSON 欄位）", '{"座號":1,"備註":"7391"}', 1, 0],
  ["b：別人的座號不算", '{"座號":2,"備註":"7391"}', 0, 1],
  ["b：N 號", "1 號 7391", 1, 0],
  ["b：11 號不是 1 號", "11 號 7391", 0, 1],
  ["b：seat 欄位、補零座號", '{"seat":"01","pin":"7391"}', 1, 0],
  ["b：兩個字的姓名（本身不擋）緊鄰自己的查詢碼", "王戊 6158", 1, 0],
  ["b：兩個字的姓名單獨出現不擋", "王戊今天值日", 0, 0],
  ["c：一小段內 3 個不同的查詢碼", "7391 8264 5027", 3, 0],
  ["c：只有 2 個不同的不算", "7391 8264 7391", 0, 3],
  ["c：剛好在一小段內", "7391" + pad(96) + "8264" + pad(96) + "5027", 3, 0],
  ["c：剛好超出一小段", "7391" + pad(96) + "8264" + pad(97) + "5027", 0, 3],
];
assert.equal(4 + 96 + 4 + 96, LIST_SPAN); // 上面兩列的間距是照 LIST_SPAN 算的

for (const [name, text, block, weak] of CASES) {
  test(name, () => {
    const r = classify(text, N);
    assert.deepEqual([r.block.length, r.weak], [block, weak]);
  });
}

test("每位學生產生姓名＋查詢碼；兩個字的姓名不當比對字串", () => {
  assert.equal(N.count, 8); // 姓名 4（王戊不算、轉出己算）＋查詢碼 4
});

test(".json 出現名為「查詢碼」的欄位就擋，不看值；其他副檔名不套", () => {
  const buf = Buffer.from('{"查詢碼" : ""}');
  assert.deepEqual(scanFile("data/x.json", buf, N), { block: ["data/x.json:1：出現名為「查詢碼」的欄位"], weak: 0 });
  assert.deepEqual(scanFile("docs/x.md", buf, N), { block: [], weak: 0 });
});

test("二進位檔（前 8000 位元組含 NUL）不掃內容，但檔名照比對", () => {
  const bin = Buffer.concat([Buffer.from([0xff, 0xd8, 0x00]), Buffer.from(" 查詢碼 7391 測試甲")]);
  assert.equal(isBinary(bin), true);
  assert.deepEqual(scanFile("data/uploads/a.jpg", bin, N), { block: [], weak: 0 });
  assert.deepEqual(scanFile("data/uploads/測試甲.jpg", bin, N).block, ["檔名含座號 1 的姓名"]);
  assert.deepEqual(scanFile("data/uploads/7391.jpg", bin, N), { block: [], weak: 1 });
});

test("命中的說明帶行號與原因，不含姓名與查詢碼；弱命中只有數量", () => {
  const r = scanFile("data/x.json", Buffer.from('{"a":"測試甲",\n"b":"查詢碼 8264",\n"c":"' + pad(NEAR) + '5027"}'), N);
  assert.deepEqual(r, {
    block: ["data/x.json:1：座號 1 的姓名", "data/x.json:2：座號 2 的查詢碼（附近有「查詢碼／密碼」字樣）"],
    weak: 1,
  });
  assert.ok(!/測試甲|8264|5027/.test(JSON.stringify(r)));
});

test("名冊不對就丟錯（fail-closed）", () => {
  assert.throws(() => buildNeedles([]), /沒有任何在學學生/);
  assert.throws(() => buildNeedles([{ 座號: 3, 姓名: "", 查詢碼: "1111", 在學: true }]), /座號 3 沒有姓名/);
  assert.throws(() => buildNeedles([{ 座號: 5, 姓名: "測試己", 查詢碼: "", 在學: true }]), /讀不到任何查詢碼/);
  assert.throws(() => buildNeedles([{ 座號: 4, 姓名: "測試戊", 查詢碼: "12-4", 在學: true }]), /座號 4 的查詢碼不是純英數字/);
});
