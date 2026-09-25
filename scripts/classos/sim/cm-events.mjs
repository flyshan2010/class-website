/**
 * R18 事件包入庫只讀演練（SPEC_R18事件包入庫腳本.md §5 第 1 步、§8 第 1 項）
 * 不連 Notion、不寫任何資料：用虛構事件包逐條出題，答案寫死在題目裡——規則一漂，這支就會 FAIL。
 * 涵蓋 §3 欄位對照表每一列、三道關卡、U+2212 減號、E01／E06／E07、類別判不出、同包重複 id。
 * ⚠️ PUBLIC repo：題目只用虛構事件與虛構頁面 id，不含任何學生資料。
 * 執行：node scripts/classos/sim/cm-events.mjs
 */
import { readFileSync } from "node:fs";
import {
  isR18, parsePacket, weekLabel, categoryOf, describe, coinNumber,
  planEvent, planPacket, execLog, taskStatus, toNotionProps, diffRow,
} from "../lib/cm-events.mjs";

// ── 虛構班規（結構同 data/class-rules.json；bad 的 coin 用 U+2212，level 為負數）──
const realRules = JSON.parse(readFileSync(new URL("../../../data/class-rules.json", import.meta.url), "utf8"));
const M = "−";
const rules = {
  cards: [
    { n: 3, good: [{ act: "認真打掃", coin: "+5", level: 1 }], bad: [{ act: "打掃玩鬧", coin: `${M}5`, level: -1 }] },
    { n: 4, good: [{ act: "作業準時交", coin: "+5", level: 1 }], bad: [{ act: "作業沒交", coin: `${M}5`, level: -1 }] },
    { n: 5, good: [{ act: "幫同學講解", coin: "+10", level: 2 }], bad: [{ act: "干擾課堂", coin: `${M}5`, level: -1 }, { act: "屢勸不聽", coin: `${M}10`, level: -2 }] },
    { n: 7, good: [], bad: [{ act: "午餐後沒潔牙，也沒有補刷", coin: `${M}5`, level: -1 }] },
    { n: 10, good: [], bad: [{ act: "重大違規", coin: `${M}200`, level: -9 }] },
  ],
};
const weeks = {
  學期: [
    { 週: [{ 起: "2026-08-31", 迄: "2026-09-06", 標籤: "四上第1週(8/31-9/4)" }, { 起: "2026-09-07", 迄: "2026-09-13", 標籤: "四上第2週(9/7-9/11)" }] },
    { 週: [{ 起: "2027-02-08", 迄: "2027-02-14", 標籤: "四下第1週(2/8-2/12)", 預排日: ["2027-01-21", "2027-01-22"] }] },
  ],
};
const roster = new Map([[1, "page-s1"], [2, "page-s2"], [5, "page-s5"]]);
const ctx = (ids = []) => ({ rules, weeks, roster, existingIds: new Set(ids) });
const ev = (o) => ({ tool: "board", date: "2026-09-08", seat: 1, id: `t-${Math.random()}`, ...o });
const R = (o) => ev({ src: "rule", ...o });
const T = (o) => ev({ src: "tally", ...o });
const row = (e, ids) => planEvent(e, ctx(ids)).row ?? {};
const pack = (body, head = "#CM-EVENTS v1 · 📋 摘要（⚠ 前次送出失敗 1 次：{不是資料}）") => `${head}\n${JSON.stringify(body)}`;

const cases = [
  // ── 命中與整包解析 ──
  ["命中：首行 #CM-EVENTS", isR18("#CM-EVENTS v1 · 摘要\n{}"), true],
  ["不命中：R01 一句話", isR18("座號5 數學課舉手 +1"), false],
  ["不命中：指紋不在首行", isR18("備註\n#CM-EVENTS v1"), false],
  ["E06：JSON 壞掉", planPacket("#CM-EVENTS v1\n{events:[", ctx()).fatal, "E06"],
  ["E06：缺 events", planPacket(pack({ tool: "x", date: "2026-09-08" }), ctx()).fatal, "E06"],
  ["E06 整包一筆都不寫", planPacket("#CM-EVENTS v1\n{bad", ctx()).results.length, 0],
  ["首行摘要含 { 不影響解析", parsePacket("#CM-EVENTS v1 · 摘要\n" + JSON.stringify({ date: "2026-09-08", events: [] })).ok, true],
  ["envelope 補回 tool／date", parsePacket(pack({ tool: "homework", date: "2026-09-09", events: [{ seat: 1 }] })).body?.events?.[0]?.date, "2026-09-09"],

  // ── 第 1 關：防重複 ──
  ["已入庫 id → 略過", planEvent(R({ id: "dup", rule_n: 4, kind: "bad", act_i: 0, coin: `${M}5`, level: -1 }), ctx(["dup"])).action, "skip"],
  ["同包重複 id → 第二筆略過", planPacket(pack({ tool: "b", date: "2026-09-08", events: [
    { seat: 1, id: "same", src: "tally", kind: "good", act: "打掃支援" },
    { seat: 1, id: "same", src: "tally", kind: "good", act: "打掃支援" }] }), ctx()).results.map((r) => r.action).join(","), "write,skip"],
  ["重送整包 → 全數略過", execLog(planPacket(pack({ tool: "b", date: "2026-09-08", events: [
    { seat: 1, id: "a", src: "tally", kind: "good", act: "打掃支援" }, { seat: 2, id: "b", src: "tally", kind: "good", act: "打掃支援" }] }), ctx(["a", "b"])).results),
    "已入庫 0 筆／略過 2 筆（已入庫）／失敗 0 筆"],

  // ── 第 2 關：金幣核對（字串比字串）──
  ["一致 → 寫入", planEvent(R({ rule_n: 4, kind: "bad", act_i: 0, coin: `${M}5`, level: -1 }), ctx()).action, "write"],
  ["幣值不符 → E07", planEvent(R({ rule_n: 4, kind: "bad", act_i: 0, coin: `${M}10`, level: -1 }), ctx()).code, "E07"],
  ["半形減號 ≠ U+2212（字串比字串）→ E07", planEvent(R({ rule_n: 4, kind: "bad", act_i: 0, coin: "-5", level: -1 }), ctx()).code, "E07"],
  ["程度不符 → E07", planEvent(R({ rule_n: 5, kind: "bad", act_i: 1, coin: `${M}10`, level: -1 }), ctx()).code, "E07"],
  ["班規查無 act_i → E07", planEvent(R({ rule_n: 4, kind: "bad", act_i: 9, coin: `${M}5`, level: -1 }), ctx()).code, "E07"],
  ["E07 只擋該筆，其餘照寫", planPacket(pack({ tool: "b", date: "2026-09-08", events: [
    { seat: 1, id: "x1", src: "rule", rule_n: 4, kind: "bad", act_i: 0, coin: `${M}99`, level: -1 },
    { seat: 2, id: "x2", src: "rule", rule_n: 4, kind: "bad", act_i: 0, coin: `${M}5`, level: -1 }] }), ctx()).results.map((r) => r.action).join(","), "fail,write"],

  // ── 寫入前轉換 ──
  ["U+2212 −5 → -5", row(R({ rule_n: 4, kind: "bad", act_i: 0, coin: `${M}5`, level: -1 })).金幣影響, -5],
  ["+10 → 10", row(R({ rule_n: 5, kind: "good", act_i: 0, coin: "+10", level: 2 })).金幣影響, 10],
  ["轉不成數字 → null（絕不寫 0）", coinNumber("五元"), null],
  ["空字串 → null", coinNumber(""), null],

  // ── 第 3 關：tally 不入帳 ──
  ["tally 金幣 0", row(T({ kind: "bad", act: "打掃未達標" })).金幣影響, 0],
  ["tally 程度空白", row(T({ kind: "bad", act: "打掃未達標" })).程度, null],
  ["tally 正負向照 kind：bad→－", row(T({ kind: "bad", act: "打掃未達標" })).正負向, "－"],
  ["neutral → 中性", row(T({ kind: "neutral", act: "打掃缺席", note: "請假" })).正負向, "中性"],
  ["good → ＋", row(T({ kind: "good", act: "打掃支援" })).正負向, "＋"],

  // ── 欄位對照：seat ──
  ["seat → 名冊頁面 id", row(R({ seat: 5, rule_n: 4, kind: "good", act_i: 0, coin: "+5", level: 1 })).學生, "page-s5"],
  ["名冊查無 → E01", planEvent(T({ seat: 27, kind: "good", act: "打掃支援" }), ctx()).code, "E01"],

  // ── 事件描述（週結撈取鍵，逐字）──
  ["rule：act＋（subj）", describe(R({ act: "干擾課堂", subj: "數學", period: "第3節" })), "干擾課堂（數學）"],
  ["rule：無 subj → act 原文（不補 period）", describe(R({ act: "午餐後沒潔牙，也沒有補刷", period: "午餐潔牙" })), "午餐後沒潔牙，也沒有補刷"],
  ["rule：不加圈號前綴", describe(R({ act: "作業沒交", rule_n: 4 })), "作業沒交"],
  ["tally 小組加分", describe(T({ act: "小組加分", subj: "數學" })), "在數學課小組加分"],
  ["tally 小組扣分", describe(T({ act: "小組扣分", subj: "國語" })), "在國語課小組扣分"],
  ["tally 舉手回答", describe(T({ act: "舉手回答", subj: "社會" })), "在社會課舉手回答"],
  ["tally 無 subj → act 原文", describe(T({ act: "打掃缺席", period: "環境晨掃" })), "打掃缺席"],

  // ── id／count／note／level ──
  ["事件id 原封", row(T({ id: "board-20260908-b1-s1-t", kind: "good", act: "打掃支援" })).事件id, "board-20260908-b1-s1-t"],
  ["count 缺省 1", row(T({ kind: "good", act: "打掃支援" })).次數, 1],
  ["count 照寫", row(T({ kind: "good", act: "小組加分", subj: "數學", count: 3 })).次數, 3],
  ["note 原文", row(T({ kind: "neutral", act: "午餐缺席", note: "免打掃券" })).備註, "免打掃券"],
  ["note 沒有 → 空", row(T({ kind: "good", act: "打掃支援" })).備註, ""],
  ["rule good level 2 → 程度 2", row(R({ rule_n: 5, kind: "good", act_i: 0, coin: "+10", level: 2 })).程度, 2],
  ["rule bad level −2 → 程度 2（取絕對值）", row(R({ rule_n: 5, kind: "bad", act_i: 1, coin: `${M}10`, level: -2 })).程度, 2],
  ["⑩ −200 level −9 → 程度空白", row(R({ rule_n: 10, kind: "bad", act_i: 0, coin: `${M}200`, level: -9 })).程度, null],
  ["⑩ −200 金幣照寫", row(R({ rule_n: 10, kind: "bad", act_i: 0, coin: `${M}200`, level: -9 })).金幣影響, -200],

  // ── date → 日期／學年／週次 ──
  ["日期照 date", row(T({ date: "2026-09-10", kind: "good", act: "打掃支援" })).日期, "2026-09-10"],
  ["學年由 date 算（9 月→115）", row(T({ date: "2026-09-10", kind: "good", act: "打掃支援" })).學年, "115"],
  ["學年由 date 算（7 月→114）", row(T({ date: "2026-07-20", kind: "good", act: "打掃支援" })).學年, "114"],
  ["週次＝標籤原字串", weekLabel("2026-09-10", weeks), "四上第2週(9/7-9/11)"],
  ["週次：週日仍在起迄內", weekLabel("2026-09-06", weeks), "四上第1週(8/31-9/4)"],
  ["週次：預排日歸下學期第 1 週", weekLabel("2027-01-21", weeks), "四下第1週(2/8-2/12)"],
  ["週次：假期 → 空", weekLabel("2026-12-31", weeks), ""],

  // ── 類別：班規 ──
  ["③ → 生活技能", categoryOf({ src: "rule", rule_n: 3, kind: "bad" }), "生活技能"],
  ["④ → 作業", categoryOf({ src: "rule", rule_n: 4, kind: "good" }), "作業"],
  ["⑤ good → 人際互動", categoryOf({ src: "rule", rule_n: 5, kind: "good" }), "人際互動"],
  ["⑤ bad → 課堂表現", categoryOf({ src: "rule", rule_n: 5, kind: "bad" }), "課堂表現"],
  ["⑨ → 課堂表現", categoryOf({ src: "rule", rule_n: 9, kind: "bad" }), "課堂表現"],
  ["② → 人際互動", categoryOf({ src: "rule", rule_n: 2, kind: "bad" }), "人際互動"],
  ["⑧ → 人際互動", categoryOf({ src: "rule", rule_n: 8, kind: "good" }), "人際互動"],
  ["① → 生活指導", categoryOf({ src: "rule", rule_n: 1, kind: "bad" }), "生活指導"],
  ["⑥ → 生活指導", categoryOf({ src: "rule", rule_n: 6, kind: "bad" }), "生活指導"],
  ["⑦ → 生活指導", categoryOf({ src: "rule", rule_n: 7, kind: "bad" }), "生活指導"],
  ["⑩ → 生活指導", categoryOf({ src: "rule", rule_n: 10, kind: "bad" }), "生活指導"],
  ["班規 ⑪ → 判不出", categoryOf({ src: "rule", rule_n: 11, kind: "bad" }), null],

  // ── 類別：tally ──
  ["打掃未達標 → 生活技能", categoryOf({ src: "tally", act: "打掃未達標" }), "生活技能"],
  ["午餐缺席 → 生活技能", categoryOf({ src: "tally", act: "午餐缺席" }), "生活技能"],
  ["作業完成 → 作業", categoryOf({ src: "tally", act: "作業完成" }), "作業"],
  ["常規未達成 → 生活指導", categoryOf({ src: "tally", act: "常規未達成" }), "生活指導"],
  ["小組加分 → 課堂表現", categoryOf({ src: "tally", act: "小組加分", subj: "數學" }), "課堂表現"],
  ["其餘有 subj → 課堂表現", categoryOf({ src: "tally", act: "舉手回答", subj: "數學" }), "課堂表現"],
  ["判不出 → 失敗需人工、不寫入", planEvent(T({ act: "神秘事件" }), ctx()).action, "fail"],
  ["判不出的錯誤碼", planEvent(T({ kind: "good", act: "神秘事件" }), ctx()).code, "需人工"],

  // ── 收件匣回填 ──
  ["執行紀錄格式（含失敗座號）", execLog([{ action: "write" }, { action: "skip" }, { action: "fail", seat: 5 }, { action: "fail", seat: 2 }]),
    "已入庫 1 筆／略過 1 筆（已入庫）／失敗 2 筆：座號2、5"],
  ["全數失敗 → 失敗", taskStatus([{ action: "fail" }, { action: "fail" }]), "失敗"],
  ["部分失敗 → 已完成", taskStatus([{ action: "fail" }, { action: "write" }]), "已完成"],
  ["全數略過 → 已完成", taskStatus([{ action: "skip" }]), "已完成"],

  // ── Notion 型別（§5a：number 欄一定是數字）──
  ["金幣影響送 number 型別", typeof toNotionProps(row(R({ rule_n: 4, kind: "bad", act_i: 0, coin: `${M}5`, level: -1 }))).金幣影響.number, "number"],
  ["程度空白送 null", toNotionProps(row(T({ kind: "good", act: "打掃支援" }))).程度.number, null],

  // ── 正式班規檔：每張卡的好／壞行為都判得出類別（班規新增第 11 條時這題會先紅）──
  ["data/class-rules.json 每張卡都有類別", realRules.cards.every((c) => categoryOf({ src: "rule", rule_n: c.n, kind: "good" }) && categoryOf({ src: "rule", rule_n: c.n, kind: "bad" })), true],

  // ── 對照（compare 模式）──
  ["對照：完全相同 → 0 差異", diffRow(row(T({ id: "c", kind: "good", act: "打掃支援" })), { ...row(T({ id: "c", kind: "good", act: "打掃支援" })) }).length, 0],
  ["對照：金幣不同 → 抓到", diffRow({ 金幣影響: -5 }, { 金幣影響: 0 }).includes("金幣影響"), true],
  ["對照：頁面 id 連字號不影響", diffRow({ 學生: "ab-cd" }, { 學生: "abcd" }).includes("學生"), false],
];

let fail = 0;
for (const [name, got, want] of cases) {
  if (got !== want) { fail++; console.log(`FAIL ${name}：得到 ${JSON.stringify(got)}，應為 ${JSON.stringify(want)}`); }
}
console.log(`總計 ${cases.length} 題／失敗 ${fail} 題`);
process.exitCode = fail ? 1 : 0;
