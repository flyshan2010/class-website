import test from "node:test";
import assert from "node:assert/strict";
import { oncePerDay, isCapped, pairKey, pairsOfPage } from "./once-per-day.mjs";

const row = (logId, stuId, over = {}) => ({
  logId, stuId, date: "2026-10-05", subject: "國語",
  cat: "課堂表現", sign: "＋", level: 1, coin: 5, created: `2026-10-05T01:00:${logId.slice(-2)}Z`, eid: logId, ...over,
});

test("同生同日同科兩筆：留最早的，另一筆列重複未入帳", () => {
  const { skip, groups } = oncePerDay([row("L02", "s3"), row("L01", "s3")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].keep.logId, "L01");
  assert.deepEqual([...skip], ["L02|s3"]);
});

test("三筆也只留一筆", () => {
  const { skip } = oncePerDay([row("L01", "s3"), row("L02", "s3"), row("L03", "s3")]);
  assert.deepEqual([...skip].sort(), ["L02|s3", "L03|s3"]);
});

test("不同學生、不同科、不同日都不算重複", () => {
  const { skip, groups } = oncePerDay([
    row("L01", "s3"), row("L02", "s4"),
    row("L03", "s3", { subject: "數學" }), row("L04", "s3", { date: "2026-10-07" }),
  ]);
  assert.equal(groups.length, 0);
  assert.equal(skip.size, 0);
});

test("不在範圍的列不占名額：程度 2、負向、別的類別、作廢列（中性＋金幣 0）", () => {
  const out = oncePerDay([
    row("L01", "s3"),
    row("L02", "s3", { level: 2, coin: 10 }),
    row("L03", "s3", { sign: "－", coin: -5 }),
    row("L04", "s3", { cat: "生活指導" }),
    row("L05", "s3", { sign: "中性", coin: 0 }),
    row("L06", "s3", { coin: 0 }),
    row("L07", "s3", { level: null }),
  ]);
  assert.equal(out.groups.length, 0);
  assert.equal(isCapped(row("L05", "s3", { sign: "中性", coin: 0 })), false);
});

test("其中一筆已入帳：名額算它的，沒入帳的那筆不再入（即使它比較早）", () => {
  const { skip, groups } = oncePerDay([row("L01", "s3"), row("L02", "s3")], new Set(["L02|s3"]));
  assert.equal(groups[0].keep.logId, "L02");
  assert.deepEqual([...skip], ["L01|s3"]);
  assert.equal(groups[0].overpaid.length, 0);
});

test("兩筆都已入帳：不 skip（沒東西可擋），列 overpaid 給人工補扣", () => {
  const { skip, groups } = oncePerDay([row("L01", "s3"), row("L02", "s3")], new Set(["L01|s3", "L02|s3"]));
  assert.equal(skip.size, 0);
  assert.deepEqual(groups[0].overpaid.map(pairKey), ["L02|s3"]);
});

test("科目空白或日期不對：不猜、不去重，列 manual", () => {
  const { skip, groups, manual } = oncePerDay([
    row("L01", "s3", { subject: "" }), row("L02", "s3", { subject: "" }), row("L03", "s4", { date: "" }),
  ]);
  assert.equal(groups.length, 0);
  assert.equal(skip.size, 0);
  assert.equal(manual.length, 3);
});

test("輸入順序不影響結果", () => {
  const a = [row("L01", "s3"), row("L02", "s3"), row("L03", "s4"), row("L04", "s4")];
  const k = rows => [...oncePerDay(rows).skip].sort();
  assert.deepEqual(k(a), k([...a].reverse()));
});

test("建立時間相同時用事件 id、再用頁 id 排，結果固定", () => {
  const same = { created: "2026-10-05T01:00:00Z" };
  const { groups } = oncePerDay([row("L09", "s3", { ...same, eid: "R01-20261005-20" }), row("L10", "s3", { ...same, eid: "R01-20261005-18" })]);
  assert.equal(groups[0].keep.eid, "R01-20261005-18");
});

test("一列掛多人：逐人展開，各自判", () => {
  const page = (id, stus, created) => ({
    id, created_time: created,
    properties: {
      "日期": { date: { start: "2026-10-05" } }, "科目": { select: { name: "國語" } },
      "類別": { select: { name: "課堂表現" } }, "正負向": { select: { name: "＋" } },
      "程度": { number: 1 }, "金幣影響": { number: 5 },
      "事件id": { rich_text: [{ plain_text: id }] }, "學生": { relation: stus.map(s => ({ id: s })) },
    },
  });
  const pairs = [page("G1", ["s3", "s4"], "2026-10-05T01:00:00Z"), page("P2", ["s3"], "2026-10-05T02:00:00Z")].flatMap(pairsOfPage);
  assert.equal(pairs.length, 3);
  const { skip } = oncePerDay(pairs);
  assert.deepEqual([...skip], ["P2|s3"]);
});
