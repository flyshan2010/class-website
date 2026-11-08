// 執行：node --test scripts/yearbook.test.mjs
// 📰 校刊挑選核心（assets/js/yearbook-core.js）：規則、檢核、建議挑選、Word 產生。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { inflateRawSync } from "node:zlib";
const require = createRequire(import.meta.url);
const Y = require("../assets/js/yearbook-core.js");

const body = n => "　　" + "我".repeat(n);           // 字數 n（全形空白不算）
const W = (o) => ({ id: "x", seat: 1, name: "王小明", title: "題目", genre: "記敘", grade: "甲", date: "2026-10-01", sem: "上", text: body(350), ...o });

test("班級名稱解析", () => {
  assert.deepEqual(Y.parseClass("四年四班"), { grade: 4, cls: 4, code: "404" });
  assert.deepEqual(Y.parseClass("6年12班"), { grade: 6, cls: 12, code: "612" });
  assert.deepEqual(Y.parseClass("三年十一班"), { grade: 3, cls: 11, code: "311" });
  assert.equal(Y.parseClass("自然教室"), null);
});

test("115 學年截止日：上 2026-12-31、下 2027-05-31", () => {
  assert.equal(Y.dueOf("115", "上"), "2026-12-31");
  assert.equal(Y.dueOf("115", "下"), "2027-05-31");
});

test("字數：去空白含標點", () => {
  assert.equal(Y.count("　　我們，好。\n　　你"), 6);
});

test("單篇提示：字數邊界、新詩、辨識不清、名冊", () => {
  assert.ok(Y.issues(W({ text: body(300) }), 4, "上").every(i => !i.block));
  assert.ok(Y.issues(W({ text: body(500) }), 4, "上").every(i => !i.block));
  assert.ok(Y.issues(W({ text: body(299) }), 4, "上").some(i => i.block && /不足/.test(i.m)));
  assert.ok(Y.issues(W({ text: body(501) }), 4, "上").some(i => i.block && /超過/.test(i.m)));
  assert.ok(Y.issues(W({ genre: "詩歌", text: "短詩" }), 4, "上").every(i => !i.block));
  assert.ok(Y.issues(W({ text: body(350) + "[？疑似：跑]" }), 4, "上").some(i => i.block));
  assert.ok(Y.issues(W({ name: "" }), 4, "上").some(i => i.block));
  assert.ok(Y.issues(W({ theme: "遊記" }), 4, "上").some(i => i.block));     // 下學期主題放上學期
});

test("檢核：篇數、一人一件、主題、指導老師", () => {
  const ctx = { grade: 4, sem: "上", teacher: "林老師" };
  const a = W({ id: "a", seat: 1, theme: "校園生活" }), b = W({ id: "b", seat: 2, theme: "其他" });
  assert.ok(Y.checks([a, b], ctx).every(([c]) => c !== "bad"));
  assert.ok(Y.checks([a], ctx).some(([c, m]) => c === "bad" && /篇數/.test(m)));
  assert.ok(Y.checks([a, W({ id: "c", seat: 1, theme: "其他" })], ctx).some(([c, m]) => c === "bad" && /1 件/.test(m)));
  assert.ok(Y.checks([a, W({ id: "b", seat: 2 })], ctx).some(([c, m]) => c === "bad" && /主題/.test(m)));
  assert.ok(Y.checks([a, b], { ...ctx, teacher: " " }).some(([c, m]) => c === "bad" && /指導老師/.test(m)));
  assert.ok(Y.checks([a, b, W({ id: "d", seat: 3, theme: "其他" }), W({ id: "e", seat: 4, theme: "其他" }), W({ id: "f", seat: 5, theme: "其他" }), W({ id: "g", seat: 6, theme: "其他" })], ctx)
    .some(([c, m]) => c === "bad" && /篇數 6/.test(m)));
});

test("建議挑選：只挑合規、一人一件、等第優先、最多 5 篇", () => {
  const pool = [
    W({ id: "low", seat: 1, grade: "乙" }), W({ id: "top", seat: 1, grade: "甲上" }),
    W({ id: "short", seat: 2, grade: "優", text: body(100) }), W({ id: "poem", seat: 3, genre: "詩歌", grade: "優" }),
    W({ id: "blur", seat: 4, grade: "優", text: body(350) + "[？疑似：x]" }),
    ...[5, 6, 7, 8, 9].map(s => W({ id: "s" + s, seat: s, grade: "甲" })),
  ];
  const pick = Y.suggest(pool, 4, "上");
  assert.equal(pick.length, 5);
  assert.equal(pick[0], "top");
  assert.ok(!pick.includes("low") && !pick.includes("short") && !pick.includes("poem") && !pick.includes("blur"));
});

test("作者行與檔名", () => {
  assert.equal(Y.byline(W(), { grade: 4, cls: 4 }, "陳大頭"), "4 年 4 班 王小明/指導老師 陳大頭");
  assert.equal(Y.fileName("404", "上"), "404校刊投稿上.docx");
  assert.equal(Y.fileName("404", "下"), "404校刊投稿下.docx");
});

test("定稿拆題目與內文", () => {
  assert.deepEqual(Y.splitFinal("題目\n　　第一段\n　　第二段"), { title: "題目", text: "　　第一段\n　　第二段", order: 0, theme: "" });
  assert.deepEqual(Y.splitFinal("〔2・食安相關之議題〕\n題目\n　　內文"), { title: "題目", text: "　　內文", order: 2, theme: "食安相關之議題" });
});

// 讀 STORE 壓縮的 zip：回 {檔名: 內容}
function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset), out = {};
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true), size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), xl = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(u8.slice(p + 30, p + 30 + nl)), data = u8.slice(p + 30 + nl + xl, p + 30 + nl + xl + size);
    out[name] = new TextDecoder().decode(method ? inflateRawSync(data) : data);
    p += 30 + nl + xl + size;
  }
  return out;
}

test("Word：三個必要檔、標楷體 16 粗／14、換頁、特殊字元跳脫", () => {
  const ws = [W({ title: "A&B<C>" }), W({ name: "李小華", text: "　　第一段\n\n　　第二段" })];
  const z = unzip(Y.buildDocx(ws, { grade: 4, cls: 4 }, "林老師", true));
  assert.deepEqual(Object.keys(z).sort(), ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
  const d = z["word/document.xml"];
  assert.ok(d.includes("A&amp;B&lt;C&gt;"));
  assert.ok(d.includes('w:eastAsia="標楷體"'));
  assert.ok(/<w:b\/><w:bCs\/><w:sz w:val="32"\/>/.test(d));
  assert.ok(d.includes("4 年 4 班 李小華/指導老師 林老師"));
  assert.equal((d.match(/w:type="page"/g) || []).length, 1);
  const noBreak = unzip(Y.buildDocx(ws, { grade: 4, cls: 4 }, "林老師", false))["word/document.xml"];
  assert.equal((noBreak.match(/w:type="page"/g) || []).length, 0);
});
