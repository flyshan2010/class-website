// 收尾閘門 closingVerdict 單元測試（模擬三關第 1 關：假 daily-plan，2026-10-23 CH 線）。
// 跑法：node --test scripts/classos/lib/school-days.test.mjs
// 合成週＝2030-01-07（一）～01-13（日），學期週同界線；真行事曆的回歸題在 sim/school-days.mjs。
import test from "node:test";
import assert from "node:assert/strict";
import { closingVerdict, weekInfo } from "./school-days.mjs";

const WEEKS = { 學期: [{ 週: [{ 起: "2030-01-07", 迄: "2030-01-13", 標籤: "合成第1週(1/7-1/11)" }] }] };
const MON_FRI = ["2030-01-07", "2030-01-08", "2030-01-09", "2030-01-10", "2030-01-11"];
const SAT = "2030-01-12", SUN = "2030-01-13";

// off＝停課日（holiday:true）；extra＝額外的列（例：週六上課日）
const plan = (off = [], extra = []) => ({
  days: [...MON_FRI.map(date => ({ date, holiday: off.includes(date), note: off.includes(date) ? "颱風假" : "" })), ...extra],
});
const v = (p, d) => closingVerdict(p, WEEKS, d);
const verdicts = p => Object.fromEntries([...MON_FRI, SAT, SUN].map(d => [d.slice(8), v(p, d).verdict]));

test("一般週：只有週五 YES，其餘 NO", () => {
  assert.deepEqual(verdicts(plan()), { "07": "NO", "08": "NO", "09": "NO", "10": "NO", "11": "YES", "12": "NO", "13": "NO" });
});

test("週五停課：週四收尾、週五補跑（10/23 颱風假情形）", () => {
  const p = plan(["2030-01-11"]);
  assert.equal(v(p, "2030-01-10").verdict, "YES");
  const f = v(p, "2030-01-11");
  assert.equal(f.verdict, "CATCHUP");
  assert.match(f.line, /^CLOSING-DAY: YES｜補跑｜2030-01-11 已過本週收尾日 2030-01-10/);
  assert.match(f.line, /工作日 4 天/);
});

test("週四五連停：週三收尾、週四週五都補跑", () => {
  const p = plan(["2030-01-10", "2030-01-11"]);
  assert.deepEqual(verdicts(p), { "07": "NO", "08": "NO", "09": "YES", "10": "CATCHUP", "11": "CATCHUP", "12": "NO", "13": "NO" });
});

test("週三停：收尾日仍是週五，週三週四不補跑", () => {
  const p = plan(["2030-01-09"]);
  assert.deepEqual(verdicts(p), { "07": "NO", "08": "NO", "09": "NO", "10": "NO", "11": "YES", "12": "NO", "13": "NO" });
});

test("整週停：沒有收尾日，全部 NO", () => {
  const p = plan(MON_FRI);
  for (const d of [...MON_FRI, SAT, SUN]) assert.equal(v(p, d).verdict, "NO", d);
  assert.match(v(p, "2030-01-11").line, /這一週沒有上課日/);
});

test("已收尾又停（週五跑完才改放假）：週五變補跑，由下游防重跑", () => {
  // 週五早上照常 YES 跑完收尾，老師之後才把週五勾放假、重新同步 → 同一天再判一次
  const before = v(plan(), "2030-01-11");
  const after = v(plan(["2030-01-11"]), "2030-01-11");
  assert.equal(before.verdict, "YES");
  assert.equal(after.verdict, "CATCHUP");
  assert.match(after.line, /已收尾即停/);
});

test("週六上課日不當收尾日：週五收、週六不補跑", () => {
  const p = plan([], [{ date: SAT, holiday: false, note: "運動會" }]);
  assert.equal(weekInfo(p, "2030-01-11").closingDay, "2030-01-11");
  assert.equal(v(p, "2030-01-11").verdict, "YES");
  assert.equal(v(p, SAT).verdict, "NO");
  assert.match(v(p, "2030-01-11").line, /本週上課日 1\/7、1\/8、1\/9、1\/10、1\/11、1\/12/);
});

test("週末不補跑（雲端每月 20 日觸發可能落在週末）", () => {
  const p = plan(["2030-01-11"]);
  assert.equal(v(p, SAT).verdict, "NO");
  assert.equal(v(p, SUN).verdict, "NO");
});

test("判不出：學期週內但每日課程進度沒資料 → UNKNOWN", () => {
  const r = v({ days: [] }, "2030-01-09");
  assert.equal(r.verdict, "UNKNOWN");
  assert.match(r.line, /^CLOSING-DAY: UNKNOWN｜/);
});

test("學期區間外 → NO", () => {
  assert.match(v(plan(), "2030-02-01").line, /^CLOSING-DAY: NO｜2030-02-01 不在任何上課週內/);
});

test("每一行開頭都是三支原文比對的三種之一", () => {
  for (const off of [[], ["2030-01-11"], MON_FRI]) {
    for (const d of [...MON_FRI, SAT, SUN]) assert.match(v(plan(off), d).line, /^CLOSING-DAY: (YES|NO|UNKNOWN)｜/);
  }
});
