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

test("下學期：全學年作文、排除上學期入選題目；同級時未入選優先、不跨級", () => {
  const es = [
    W({ id: "u1", seat: 1, title: "下課時間", sem: "上", mark: "115上", grade: "甲上" }),
    W({ id: "u2", seat: 2, title: "下課時間", sem: "上", grade: "優" }),           // 同題目沒入選 → 也排除
    W({ id: "u3", seat: 3, title: "我的家人", sem: "上", grade: "甲" }),            // 上學期沒入選的題目 → 可挑
    W({ id: "d1", seat: 1, title: "遊記", sem: "下", grade: "甲上", theme: "遊記" }),
    W({ id: "d4", seat: 4, title: "遊記", sem: "下", grade: "甲" }),
  ];
  assert.deepEqual(Y.poolOf(es, "下", "115下").map(e => e.id), ["u3", "d1", "d4"]);
  assert.deepEqual(Y.poolOf(es, "上", "115上").map(e => e.id), ["u1", "u2", "u3"]);
  const h = Y.history(es, "115下");
  assert.ok(h.seats.has(1) && !h.seats.has(2));
  // 同級：未入選的甲上（座號7）排在入選過的甲上（座號1）前面
  const a = W({ id: "a", seat: 1, grade: "甲上" }), b = W({ id: "b", seat: 4, grade: "甲" });
  const a2 = W({ id: "a2", seat: 7, grade: "甲上", date: "2026-01-01" });
  assert.deepEqual(Y.suggest([a, a2], 4, "下", h.seats), ["a2", "a"]);
  // 不跨級：未入選的甲（座號4）仍排在入選過的甲上（座號1）之後
  assert.deepEqual(Y.suggest([b, a], 4, "下", h.seats), ["a", "b"]);
  // 入選過的「優」不會被未入選的甲上擠下
  const top = W({ id: "top", seat: 1, grade: "優" }), c = W({ id: "c", seat: 5, grade: "甲上" });
  assert.deepEqual(Y.suggest([c, top], 4, "下", h.seats), ["top", "c"]);
  // 上學期沒有得獎紀錄 → 照等第
  assert.deepEqual(Y.suggest([b, a], 4, "上"), ["a", "b"]);
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

test("微修：改動比例、辨識標記不算改動、程式把關", () => {
  const base = "　　今天我們去公園玩，天氣很好，我很開心。\n　　我們在草地上[？疑似：跑]步，還一起玩捉迷藏，最後坐在樹下吃媽媽準備的點心，大家都說這是最棒的一天。";
  assert.equal(Y.editRatio(base, base), 0);
  assert.equal(Y.editRatio(base, base.replace("[？疑似：跑]", "跑")), 0);          // 定疑似字不算
  const one = base.replace("很好", "晴朗");                                          // 2 字替換
  assert.equal(Y.lev(Y.plainOf(base), Y.plainOf(one)), 2);
  assert.ok(Y.polishGate(base, one).every(g => g.ok));
  const many = base.replace("今天我們去公園玩", "昨天大家到河濱散步");
  assert.ok(Y.editRatio(base, many) > Y.POLISH_MAX);
  assert.equal(Y.polishGate(base, many)[0].ok, false);
  assert.ok(Y.polishGate(base, base.replace("\n", "")).some(g => !g.ok && /段落/.test(g.m)));
  assert.ok(Y.polishGate(base, "").some(g => !g.ok));
  assert.equal(Y.pct(0.0315), "3.2%"); assert.equal(Y.pct(0.0325), "3.3%");          // 四捨五入不用銀行家捨入
});

test("主題依題目自動判斷：題目優先、沒命中填其他、1–2 年級沒其他留空", () => {
  assert.equal(Y.guessTheme({ title: "下課時間", text: "大家衝去合作社買飲料" }, 4, "上"), "校園生活");
  assert.equal(Y.guessTheme({ title: "我最喜歡的一堂課", text: "" }, 4, "上"), "校園生活");
  assert.equal(Y.guessTheme({ title: "營養午餐", text: "同學排隊打菜" }, 4, "上"), "食安相關之議題");
  assert.equal(Y.guessTheme({ title: "我的夢想", text: "" }, 4, "上"), "其他");
  assert.equal(Y.guessTheme({ title: "墾丁三天兩夜", text: "這次旅行很開心" }, 4, "下"), "遊記");
  assert.equal(Y.guessTheme({ title: "我的夢想", text: "" }, 2, "上"), "");
});

test("微修：Notion 欄位三態格式來回", () => {
  const b = "　　第一段。\n　　第二段。", r = "　　第一段！\n　　第二段。";
  assert.deepEqual(Y.parsePolish(Y.polishPending(b, "2026-11-08 15:30")), { state: "pending", at: "2026-11-08 15:30", base: b });
  const d = Y.parsePolish(Y.polishDone(b, r, "2026-11-08 15:40"));
  assert.equal(d.state, "done"); assert.equal(d.base, b); assert.equal(d.revised, r); assert.equal(d.at, "2026-11-08 15:40");
  assert.match(Y.polishDone(b, r, "x"), /^〔微修・x・改動 \d+\.\d%〕\n/);
  const m = Y.parsePolish(Y.polishManual(b, "改到 7.2% 仍超過"));
  assert.equal(m.state, "manual"); assert.equal(m.reason, "改到 7.2% 仍超過"); assert.equal(m.base, b);
  assert.equal(Y.parsePolish("").state, "");
  assert.equal(Y.parsePolish("〔微修・x・改動 1%〕\n壞掉").state, "manual");
});

test("微修：紅綠差異拼回兩邊原文", () => {
  const a = "我很開心的去學校", b = "我很開心地去學校。";
  const ops = Y.diff(a, b);
  assert.equal(ops.filter(o => o.t !== "+").map(o => o.s).join(""), a);
  assert.equal(ops.filter(o => o.t !== "-").map(o => o.s).join(""), b);
  assert.deepEqual(ops.filter(o => o.t !== "=").map(o => o.t + o.s), ["-的", "+地", "+。"]);
});
