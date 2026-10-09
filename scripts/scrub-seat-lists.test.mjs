// 執行：node --test scripts/scrub-seat-lists.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubSeatLists } from "./scrub-seat-lists.mjs";

test("整行都是座號 → 拿掉", () => {
  const r = scrubSeatLists("施打順序：高年級 ➡️ 低年級 ➡️ 中年級\n\n3。8。11。20。");
  assert.equal(r.text, "施打順序：高年級 ➡️ 低年級 ➡️ 中年級");
  assert.equal(r.dropped, 1);
});

test("有標題的名單行 → 整行拿掉（標題也不留）", () => {
  const r = scrubSeatLists("12:00放學\n\n受獎名單：2。6。14。18。21");
  assert.equal(r.text, "12:00放學");
  assert.equal(r.dropped, 1);
});

test("頓號、逗號、含空白的寫法也擋", () => {
  assert.equal(scrubSeatLists("未交：3、9、12").dropped, 1);
  assert.equal(scrubSeatLists("4, 5, 16, 22").dropped, 1);
});

test("只有兩個數字不算清單", () => {
  assert.equal(scrubSeatLists("座位 3、4 對調").dropped, 0);
});

test("節次、日期、時間、頁碼不誤擋", () => {
  for (const s of [
    "第1、2、3節上體育",
    "1、2、3 節調課",
    "10/9、10/12、10/13 放假",
    "集合 07:40、07:50、08:00",
    "3、4、5 年級參加",
    "課本 p.68、69、70 頁",
    "1.應隨身攜帶 IC健保卡。\n2.保持乾淨。\n3.自備藥品。",
    "調10/19（一）第五節課",
  ]) assert.equal(scrubSeatLists(s).dropped, 0, s);
});

test("空值與沒有數字的說明原樣回傳", () => {
  assert.deepEqual(scrubSeatLists(""), { text: "", dropped: 0 });
  assert.deepEqual(scrubSeatLists(undefined), { text: "", dropped: 0 });
  assert.equal(scrubSeatLists("要帶餐具").text, "要帶餐具");
});
