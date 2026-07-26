/**
 * Phase F｜學年規則稽核（靜態，不寫入任何資料）
 *
 * 檢查 9 支 skill 的 SKILL.md 與 RUNBOOK 是否把「學年」規則寫得夠明確，
 * 讓執行期的 Sonnet 照表操課不會漏填或算錯。
 *
 * 四項檢查：
 *   A 欄位清單有「學年」且標明必填
 *   B 明確指出「取哪個日期／哪個欄位」算學年（不是含糊帶過）
 *   C 有防「用今天算」的警語（補登／暑假補產情境）
 *   D RUNBOOK 檢核清單有「回讀確認有值」
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/flyshan/Library/CloudStorage/GoogleDrive-flyshan2010@gmail.com/我的雲端硬碟/Project/班級事務/.claude/skills";

const SKILLS = [
  "class-log", "class-grades", "class-bank", "class-counsel",
  "class-portfolio", "class-report", "class-term-report", "class-weekly", "lesson-flow",
];

// B 項：每支 skill 各自的「日期來源」關鍵詞（至少命中一個才算明確）
const SOURCE_HINTS = {
  "class-log":         ["「日期」欄"],
  "class-grades":      ["「學期」欄"],
  "class-bank":        ["「日期」欄"],
  "class-counsel":     ["「開始日期」"],
  "class-portfolio":   ["「日期」欄"],
  "class-report":      ["`期間` 開頭", "期間」開頭"],
  "class-term-report": ["學期名稱的數字"],
  "class-weekly":      ["`週次` 開頭", "週次」開頭"],
  "lesson-flow":       ["「日期」欄"],
};

// C 項：防「用今天算」的警語關鍵詞
const GUARD_HINTS = ["不是今天", "非今天", "不是執行當天", "不是備課當天", "不可用執行當天", "與匯入當天無關", "不是週結當天"];

const read = p => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

let allPass = true;
const rows = [];

for (const s of SKILLS) {
  const dir = join(ROOT, s);
  const skill = read(join(dir, "SKILL.md"));
  const rbName = readdirSync(dir).find(f => f.startsWith("RUNBOOK"));
  const runbook = rbName ? read(join(dir, rbName)) : "";
  const both = skill + "\n" + runbook;

  const A = /學年/.test(skill) && /必填/.test(skill);
  const B = (SOURCE_HINTS[s] ?? []).some(h => both.includes(h));
  const C = GUARD_HINTS.some(h => both.includes(h));
  const D = /學年/.test(runbook) && /回讀/.test(runbook);

  const pass = A && B && C && D;
  if (!pass) allPass = false;
  rows.push({ s, A, B, C, D, pass });
}

const m = b => (b ? "✅" : "❌");
console.log("skill               A欄位必填  B日期來源  C防用今天  D回讀驗證   結果");
console.log("─".repeat(74));
for (const r of rows) {
  console.log(`${r.s.padEnd(20)}${m(r.A).padEnd(11)}${m(r.B).padEnd(11)}${m(r.C).padEnd(11)}${m(r.D).padEnd(11)}${r.pass ? "PASS" : "FAIL"}`);
}
console.log("─".repeat(74));
console.log(`${rows.filter(r => r.pass).length}/${rows.length} 支通過`);
process.exit(allPass ? 0 : 1);
