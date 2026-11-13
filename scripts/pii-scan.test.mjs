// 執行：node --test scripts/pii-scan.test.mjs
// 測試資料全是虛構的姓名與查詢碼（公開 repo 不得出現真的）。
// CASES 與 Project/Claude/dotclaude/scripts/test_pii_gate.py 的 CASES 是同一張表，改規則兩邊一起改。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNeedles, isBinary, classify, scanFile, variants, idValid, mobileKey, NEAR, LIST_SPAN } from "./pii-scan.mjs";

const ROWS = [
  { 座號: 1, 姓名: "測試甲", 查詢碼: "7391", 在學: true },
  { 座號: 2, 姓名: "假名乙丙", 查詢碼: "8264", 在學: true },
  { 座號: 3, 姓名: "樣本丁", 查詢碼: "5027", 在學: true },
  { 座號: 4, 姓名: "王戊", 查詢碼: "6158", 在學: true },
  { 座號: "", 姓名: "轉出己", 查詢碼: "", 在學: false },
];
const N = buildNeedles(ROWS);
const pad = n => "。".repeat(n);

// 手機、證號的測試值一律拆開寫：本檔自己也要過本機的推送前關卡（公認範例值 0912-345-678、A123456789 不擋，可以直接寫）
const MOB = "09" + "87654321";
const ID_GOOD = "B" + "123456780"; // 檢查碼正確的虛構字號

// [說明, 文字, 要擋幾處, 弱命中幾處]
const CASES = [
  ["姓名出現就擋", "第一行\n恭喜假名乙丙得獎", 1, 0],
  ["轉出生的姓名也擋", "今天轉出己來訪", 1, 0],
  ["遮蔽後的姓名、只寫座號不算", "測○甲、座號 1、1 號", 0, 0],
  ["孤零零的同值數字＝弱命中", "總共 7391 元", 0, 1],
  ["JSON 值裡孤零零的同值數字＝弱命中", '{"amount":"7391"}', 0, 1],
  ["緊鄰英數字或連字號不算", "a7391 73910 17391 2026-7391 7391-2026 c9674fb67391e", 0, 0],
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
  ["連字號：自己的座號-查詢碼", "01-7391", 1, 0],
  ["連字號：三人名單", "01-7391\n02-8264\n03-5027", 3, 0],
  ["連字號：別人的座號、不成名單＝弱命中", "12-7391", 0, 1],
  ["連字號：別人的座號但成名單", "11-7391 12-8264 13-5027", 3, 0],
  ["連字號：反過來寫，自己的座號", "7391-01", 1, 0],
  ["連字號：反過來寫，別人的座號＝弱命中", "7391-05", 0, 1],
  ["連字號：反過來寫的三人名單", "7391-11、8264-12、5027-13", 3, 0],
  ["連字號：前面不是半形英數字（暱稱、全形數字）＝弱命中", "小甲-7391 １-8264", 0, 2],
  ["連字號：暱稱-查詢碼三人名單", "小甲-7391\n小乙-8264\n小丁-5027", 3, 0],
  ["連字號：查詢碼-暱稱三人名單", "7391-小甲、8264-小乙、5027-小丁", 3, 0],
  ["連字號：行首行尾的連字號＝弱命中", "-7391\n8264-", 0, 2],
  ["連字號：另一邊是英文字母或 3 位以上數字不算", "A1-7391 7391-1a abc-8264 8264-abc 001-5027 5027-001", 0, 0],
  ["連字號：日期、UUID、雜湊片段、查詢碼相連不算",
    "2026-10-7391 7391-10-05 10-05-7391 3f2a7391-8264-5027-6158-7391aaaa8264 abc-7391 7391-8264", 0, 0],
  ["手機：加連字號", "家長電話 09" + "87-654-321", 1, 0],
  ["手機：連寫、空白分隔、+886 開頭", MOB + "／09" + "87 654 321／+886" + "-987-654-321", 3, 0],
  ["手機：公認範例號碼不擋", "0912-345-678、0900123456", 0, 0],
  ["手機：緊鄰英數字或連字號、位數不對不算", "a" + MOB + " " + MOB + "0 x-" + MOB + " 0987-654-32", 0, 0],
  ["身分證字號格式（檢查碼正確）就擋", "身分證 " + ID_GOOD, 1, 0],
  ["身分證：檢查碼不對、公認範例、緊鄰英數字不算", "B123456781 A123456789 X" + ID_GOOD + " " + ID_GOOD + "9", 0, 0],
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
  assert.deepEqual(scanFile("data/x.json", buf, N), { block: ["data/x.json:1：出現名為「查詢碼」的欄位"], weak: 0, format: 0 });
  assert.deepEqual(scanFile("docs/x.md", buf, N), { block: [], weak: 0, format: 0 });
});

test("二進位檔（前 8000 位元組含 NUL）不掃內容，但檔名照比對", () => {
  const bin = Buffer.concat([Buffer.from([0xff, 0xd8, 0x00]), Buffer.from(" 查詢碼 7391 測試甲")]);
  assert.equal(isBinary(bin), true);
  assert.deepEqual(scanFile("data/uploads/a.jpg", bin, N), { block: [], weak: 0, format: 0 });
  assert.deepEqual(scanFile("data/uploads/測試甲.jpg", bin, N).block, ["檔名含座號 1 的姓名"]);
  assert.deepEqual(scanFile("data/uploads/7391.jpg", bin, N), { block: [], weak: 1, format: 0 });
});

test("命中的說明帶行號與原因，不含姓名與查詢碼；弱命中只有數量", () => {
  const r = scanFile("data/x.json", Buffer.from('{"a":"測試甲",\n"b":"查詢碼 8264",\n"c":"' + pad(NEAR) + '5027"}'), N);
  assert.deepEqual(r, {
    block: ["data/x.json:1：座號 1 的姓名", "data/x.json:2：座號 2 的查詢碼（附近有「查詢碼／密碼」字樣）"],
    weak: 1,
    format: 0,
  });
  assert.ok(!/測試甲|8264|5027/.test(JSON.stringify(r)));
});

test("名冊不對就丟錯（fail-closed）", () => {
  assert.throws(() => buildNeedles([]), /沒有任何在學學生/);
  assert.throws(() => buildNeedles([{ 座號: 3, 姓名: "", 查詢碼: "1111", 在學: true }]), /座號 3 沒有姓名/);
  assert.throws(() => buildNeedles([{ 座號: 5, 姓名: "測試己", 查詢碼: "", 在學: true }]), /座號 5 沒有查詢碼/);
  // 姓名數、查詢碼數各自對在學人數把關：一位在學生缺任一項就不放行（兩個字的姓名算有姓名）
  const ok = { 座號: 1, 姓名: "測試甲", 查詢碼: "7391", 在學: true };
  assert.throws(() => buildNeedles([ok, { 座號: 2, 姓名: "假名乙丙", 查詢碼: "", 在學: true }]), /座號 2 沒有查詢碼/);
  assert.throws(() => buildNeedles([ok, { 座號: 2, 姓名: "", 查詢碼: "8264", 在學: true }]), /座號 2 沒有姓名/);
  assert.throws(() => buildNeedles([ok, { 座號: 2, 名字: "假名乙丙", 查詢碼: "8264", 在學: true }]), /座號 2 沒有姓名/);
  assert.equal(buildNeedles([ok, { 座號: 4, 姓名: "王戊", 查詢碼: "6158", 在學: true }]).count, 3);
  assert.equal(buildNeedles([ok, { 座號: "", 姓名: "轉出己", 查詢碼: "", 在學: false }]).count, 3); // 已轉出的不把關（姓名照樣比對）
  assert.throws(() => buildNeedles([{ 座號: 4, 姓名: "測試戊", 查詢碼: "12-4", 在學: true }]), /座號 4 的查詢碼不是純英數字/);
});

test("姓名寫成 JSON 跳脫、網址編碼、HTML 實體也要掃得到", () => {
  const name = "測試甲";
  const esc = [...name].map(c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  const forms = {
    "JSON 跳脫": `{"n":"${esc}"}`,
    "JSON 跳脫（大寫）": `{"n":"${esc.toUpperCase().replaceAll("\\U", "\\u")}"}`,
    "網址編碼": `[連結](https://example.com/${encodeURIComponent(name)})`,
    "網址編碼（小寫）": encodeURIComponent(name).toLowerCase(),
    "HTML 十進位實體": `<p>${[...name].map(c => `&#${c.charCodeAt(0)};`).join("")}</p>`,
    "HTML 十六進位實體": [...name].map(c => `&#x${c.charCodeAt(0).toString(16).toUpperCase()};`).join(""),
  };
  for (const [label, text] of Object.entries(forms)) {
    assert.ok(!text.includes(name), label);
    assert.deepEqual(scanFile("data/x.md", Buffer.from(text), N), { block: ["data/x.md:1：座號 1 的姓名"], weak: 0, format: 0 }, label);
  }
  assert.deepEqual(variants("今天教室很熱 100% 完成"), ["今天教室很熱 100% 完成"]);
  // 一段網址編碼裡夾了壞位元組，前面的姓名照樣解得出來
  assert.equal(scanFile("data/x.md", Buffer.from(encodeURIComponent(name) + "%FF"), N).block.length, 1);
  // 編碼寫的欄位名也算
  assert.deepEqual(scanFile("data/x.json", Buffer.from('{"\\u67e5\\u8a62\\u78bc":""}'), N).block, ["data/x.json:1：出現名為「查詢碼」的欄位"]);
  // 反解後的各份是同一批數字，弱命中不重複加
  assert.equal(scanFile("data/x.md", Buffer.from("總共 7391 元 %E5%85%83"), N).weak, 1);
});

test("手機號碼、身分證字號：只通報不擋（只給數量）；檢查碼與正規化", () => {
  assert.deepEqual(scanFile("data/x.md", Buffer.from("電話 " + MOB + "\n字號 " + ID_GOOD), N),
    { block: [], weak: 0, format: 2 });
  // 同一檔同時有姓名：姓名照擋，格式另外計數；檔名裡的也算
  assert.deepEqual(scanFile("data/" + MOB + ".md", Buffer.from("測試甲 " + MOB), N),
    { block: ["data/" + MOB + ".md:1：座號 1 的姓名"], weak: 0, format: 2 });
  // 編碼寫法反解後是同一個號碼，不重複計數
  assert.equal(scanFile("data/x.md", Buffer.from("電話 " + MOB + " %E5%85%83"), N).format, 1);
  assert.equal(idValid("A123456789"), true);
  assert.equal(idValid(ID_GOOD), true);
  assert.equal(idValid("B123456781"), false);
  assert.equal(mobileKey("+886" + "-987 654-321"), MOB);
});
