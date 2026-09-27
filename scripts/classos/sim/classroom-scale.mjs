/**
 * 課堂量尺只讀演練（2026-09-25，SPEC_課堂量尺.md §6 第 3 步，U56）
 * 不連 Notion、不寫任何資料：把 SPEC §2（上課參與等第）與 §4（R01 行為判級）寫成純函式，
 * 再用「第 4 週資料驗不到的路徑」逐一出題，答案寫死在題目裡——規則一漂，這支就會 FAIL。
 * 驗的路徑：A 案行為判級（含判不出→需人工）、⑤ 好行為歸人際互動、協助類歸人際。
 * ⚠️ 上課參與等第（SPEC §2）2026-09-28 改 v2「每週課堂量尺分數」，判法與測試已移到
 *    班級事務/.claude/workflows/report-grades.mjs（＋report-grades.test.mjs），本檔不再保留舊判法，免得兩套規則並存。
 * ⚠️ PUBLIC repo：題目只用虛構事件，不含任何學生資料。
 * 執行：node scripts/classos/sim/classroom-scale.mjs
 */

// ── R01 判級（SPEC §4 定稿關鍵詞，老師 2026-09-25 過目）──
const KW = [
  [3, ["帶全班", "帶大家練習", "讓全班都懂"]],
  [2, ["帶動討論", "帶動小組", "帶小組", "講解給同學", "教會組員", "上台講解"]],
  [1, ["舉手", "發表", "主動回答", "上台做題", "上台寫", "上台回答", "提出想法", "主動畫重點", "表現良好", "認真配合"]],
];
const HELP = ["協助發作業", "協助老師"]; // 老師 09-25：幫忙歸人際互動

/** 課堂正向句 → { cat, level } 或 { need: "需人工", why } */
export function r01Classroom(text) {
  if (HELP.some(k => text.includes(k))) return { cat: "人際互動" };
  const hit = KW.find(([, ws]) => ws.some(w => text.includes(w)));
  if (!hit) return { need: "需人工", why: "判不出量尺級數" };
  const level = hit[0];
  // 老師 09-25 裁定：課堂正向只看行為，句中數字／金額一律不採用（執行紀錄註明）
  const ignoredNumber = /[+＋]\s*\d/.test(text);
  return { cat: "課堂表現", level, coin: level * 5, ignoredNumber };
}

// ── R18 類別（SPEC §5）──
export const r18Category = (ruleN, kind) =>
  ruleN === 5 ? (kind === "good" ? "人際互動" : "課堂表現") : ruleN === 9 ? "課堂表現" : "其他";

// ── 題目（答案寫死）──
const P = (desc, level = 1) => ({ pn: "＋", level, desc });
const N = (desc, level = 1) => ({ pn: "－", level, desc });
const cases = [
  ["R01：帶動小組討論→程度2", r01Classroom("座號5 數學課帶動小組討論").level, 2],
  ["R01：主動發表→程度1", r01Classroom("國語課主動發表").level, 1],
  ["R01：多級取最高→程度3", r01Classroom("上台講解讓全班都懂").level, 3],
  ["R01：主動畫重點→程度1", r01Classroom("社會課主動畫重點").level, 1],
  ["R01：判不出→需人工（不預設程度1）", r01Classroom("數學課表現很棒").need, "需人工"],
  ["R01：帶動討論 +3 →不看數字，程度2", r01Classroom("帶動討論 +3").level, 2],
  ["R01：舉手發表 +10點 →不看金額，+5", r01Classroom("舉手發表 +10點").coin, 5],
  ["R01：句中有數字→註明未採用", r01Classroom("舉手發表 +2").ignoredNumber, true],
  ["R01：無數字→不註明", r01Classroom("舉手發表").ignoredNumber, false],
  ["R01：協助發作業→人際互動", r01Classroom("協助發作業訂正").cat, "人際互動"],
  ["R18：⑤ good→人際互動", r18Category(5, "good"), "人際互動"],
  ["R18：⑤ bad→課堂表現", r18Category(5, "bad"), "課堂表現"],
  ["R18：⑨ bad→課堂表現", r18Category(9, "bad"), "課堂表現"],
];

let fail = 0;
for (const [name, got, want] of cases) {
  if (got !== want) { fail++; console.log(`FAIL ${name}：得到 ${got}，應為 ${want}`); }
}
console.log(`總計 ${cases.length} 題／失敗 ${fail} 題`);
process.exitCode = fail ? 1 : 0;
