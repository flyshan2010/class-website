/**
 * 課堂量尺只讀演練（2026-09-25，SPEC_課堂量尺.md §6 第 3 步，U56）
 * 不連 Notion、不寫任何資料：把 SPEC §2（上課參與等第）與 §4（R01 行為判級）寫成純函式，
 * 再用「第 4 週資料驗不到的路徑」逐一出題，答案寫死在題目裡——規則一漂，這支就會 FAIL。
 * 驗的路徑：特優（+3 以上）、有負向降一級、小組扣分不算個人、A 案行為判級（含判不出→需人工）、
 *           ⑤ 好行為歸人際互動、協助類歸人際、全班表現良好算 +2、乙丙下修門檻覆蓋。
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
  const amt = text.match(/[+＋]\s*(\d+)\s*(點|幣|崑山幣|元)/);
  const bare = text.match(/[+＋]\s*(\d+)(?!\s*(點|幣|崑山幣|元|\d))/);
  const given = amt ? Number(amt[1]) / 5 : bare ? Number(bare[1]) : null;
  if (given !== null && given !== level) return { need: "需人工", why: "數字和行為對不上" };
  return { cat: "課堂表現", level, coin: level * 5 };
}

// ── R18 類別（SPEC §5）──
export const r18Category = (ruleN, kind) =>
  ruleN === 5 ? (kind === "good" ? "人際互動" : "課堂表現") : ruleN === 9 ? "課堂表現" : "其他";

// ── 上課參與等第（SPEC §2）──
// rec: { pn: "＋"|"－", level: 1-3|null, desc }
const isGroupMinus = r => r.desc.includes("小組扣分");
const isHelp = r => HELP.some(k => r.desc.includes(k));
export function participationGrade(recs) {
  const pos = recs.filter(r => r.pn === "＋" && !isHelp(r));
  const neg = recs.filter(r => r.pn === "－" && !isGroupMinus(r));
  let g = pos.some(r => (r.level ?? 1) >= 2) ? "特優" : pos.length ? "優" : "甲";
  if (neg.length) g = g === "特優" ? "優" : "甲"; // 降一級，最低到甲
  // 乙丙：v11 下修門檻（覆蓋上面結果）
  const n1 = neg.filter(r => (r.level ?? 1) === 1).length;
  const n2 = neg.filter(r => r.level === 2).length;
  const n3 = neg.filter(r => r.level === 3).length;
  if (n2 >= 3 || n3 >= 1) g = "丙";
  else if (n1 >= 5 || n2 >= 1) g = "乙";
  return g;
}

// ── 題目（答案寫死）──
const P = (desc, level = 1) => ({ pn: "＋", level, desc });
const N = (desc, level = 1) => ({ pn: "－", level, desc });
const cases = [
  ["特優：有 +3（程度2）", participationGrade([P("數學課帶動小組討論", 2)]), "特優"],
  ["特優：有 +4（程度3）", participationGrade([P("帶全班練習", 3)]), "特優"],
  ["優：只有 +2", participationGrade([P("國語課主動發表")]), "優"],
  ["優：tally 舉手回答（程度空白）", participationGrade([{ pn: "＋", level: null, desc: "在數學課舉手回答" }]), "優"],
  ["甲：沒有課堂紀錄", participationGrade([]), "甲"],
  ["降一級：特優＋1 筆負向→優", participationGrade([P("帶動討論", 2), N("干擾上課")]), "優"],
  ["降一級：優＋1 筆負向→甲", participationGrade([P("舉手發表"), N("干擾上課")]), "甲"],
  ["最低到甲：只有負向 1 筆→甲", participationGrade([N("干擾上課")]), "甲"],
  ["小組扣分不算個人負向", participationGrade([{ pn: "＋", level: null, desc: "在數學課小組加分" }, { pn: "－", level: null, desc: "在數學課小組扣分" }]), "優"],
  ["全班表現良好算 +2", participationGrade([P("全班數學課表現良好")]), "優"],
  ["協助發作業不算課堂正向", participationGrade([P("協助發作業訂正")]), "甲"],
  ["乙：程度1 負向 5 次", participationGrade(Array(5).fill(N("干擾上課"))), "乙"],
  ["乙：程度2 負向 1 次（覆蓋特優）", participationGrade([P("帶動討論", 2), N("提醒兩次仍吵", 2)]), "乙"],
  ["丙：程度3 負向", participationGrade([N("嚴重事件", 3)]), "丙"],
  ["R01：帶動小組討論→程度2", r01Classroom("座號5 數學課帶動小組討論").level, 2],
  ["R01：主動發表→程度1", r01Classroom("國語課主動發表").level, 1],
  ["R01：多級取最高→程度3", r01Classroom("上台講解讓全班都懂").level, 3],
  ["R01：主動畫重點→程度1", r01Classroom("社會課主動畫重點").level, 1],
  ["R01：判不出→需人工（不預設程度1）", r01Classroom("數學課表現很棒").need, "需人工"],
  ["R01：帶動討論 +2 一致→程度2", r01Classroom("帶動討論 +2").level, 2],
  ["R01：帶動討論 +3 不一致→需人工", r01Classroom("帶動討論 +3").need, "需人工"],
  ["R01：舉手發表 +10點 不一致→需人工", r01Classroom("舉手發表 +10點").need, "需人工"],
  ["R01：舉手發表 +5點 一致→程度1", r01Classroom("舉手發表 +5點").level, 1],
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
