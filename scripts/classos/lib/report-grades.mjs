/**
 * 學習報告四等第＋生活技能分數機器判（SPEC_學習報告評分標準v2 §0、§4，2026-09-28 定稿）。
 * 純函式、不讀檔、不連 Notion；participation-grade.mjs 讀 prep.json 後呼叫這裡。
 * 正本在班網 repo（2026-10-18 BX 線自 班級事務/.claude/workflows/ 搬來）：GitHub Actions 的學期日常換分（lib/term-daily-hw.mjs）
 * 也要用同一套週等第判法，Actions 只拿得到本 repo；舊位置留一行轉接檔，影子試跑腳本照舊 import。
 * 量尺一律整數（一項一分、每日相加），只有生活技能分數的 ×0.5 在最後用整數算四捨五入，沒有小數誤差。
 *
 * 紀錄格式（prep.json records 的一筆）：{ date, category, subject, polarity: "＋"|"－"|"中性", level: 1-3|null, desc, score? }
 * 請假日檢核台不產生任何紀錄（到校請假不送事件、作業請假不算未交、各站自動帶入請假），
 * 所以「沒有紀錄的日子」＝本分做到，正好等於 SPEC「請假算滿分」，不需要另外判斷請假。
 */

// ── 通則 ──
export const GRADES = ["特優", "優", "甲", "乙", "丙"];
const pnOf = p => (/[+＋正]/.test(p ?? "") ? "＋" : /[-－負]/.test(p ?? "") ? "－" : null);
const lvOf = v => (v === null || v === undefined || v === "" ? null : Number(v));
const has = (r, words) => words.some(w => (r.desc ?? "").includes(w));

/** 本週五個上課日（週一到週五）。放假日沒有紀錄＝本分，門檻不因放假變難。 */
export function weekDays(start) {
  const d0 = new Date(`${start}T00:00:00Z`);
  const dow = (d0.getUTCDay() + 6) % 7; // 週一＝0
  return Array.from({ length: 5 }, (_, i) => new Date(d0.getTime() + (i - dow) * 86400000).toISOString().slice(0, 10));
}

/** §0-4 降一級（程度 ≥2 的個人負向＝非輕微；最低到甲），再套 §0-5 乙／丙門檻（覆蓋）。
 *  程度 1 的負向是輕微，已經在每日量尺扣過，不再降級（SPEC 4-1 範例⑤：每天舉手＋一次講話＝9＝優）。 */
export function applyNegatives(grade, negLevels) {
  let g = grade;
  if (negLevels.some(l => l >= 2)) g = g === "特優" ? "優" : "甲";
  const n1 = negLevels.filter(l => l === 1).length;
  const n2 = negLevels.filter(l => l === 2).length;
  const n3 = negLevels.filter(l => l >= 3).length;
  if (n2 >= 3 || n3 >= 1) return "丙";
  if (n1 >= 5 || n2 >= 1) return "乙";
  return g;
}

/** 每日量尺：當天基準 base（本分）；有正向就取當天最高一級取代基準；負向每筆再扣。 */
function dailySum(days, recsOf, { base, posValue, negValue }) {
  let sum = 0;
  for (const day of days) {
    const rs = recsOf(day);
    const pos = rs.filter(r => r.pn === "＋").map(posValue);
    const top = pos.length ? Math.max(base, ...pos) : base;
    sum += top - rs.filter(r => r.pn === "－").reduce((a, r) => a + negValue(r), 0);
  }
  return sum;
}

function norm(recs) {
  return recs.map(r => ({ ...r, pn: pnOf(r.polarity), level: lvOf(r.level), desc: r.desc ?? "" }));
}
function byDay(recs, days) {
  const set = new Set(days);
  return { recsOf: day => recs.filter(r => r.date === day), outside: recs.filter(r => !set.has(r.date)) };
}

// ── 4-1 上課參與 ──
const TALLY = ["舉手回答", "小組加分", "小組扣分"]; // 檢核台計次，類別可能沒標課堂表現
const HELP = ["協助發作業", "協助老師"];          // 老師 09-25：幫忙歸人際互動
export function classroomRecords(recs) {
  return norm(recs).filter(r => (r.category === "課堂表現" || has(r, TALLY)) && !has(r, HELP) && r.pn)
    .filter(r => !(r.pn === "－" && r.desc.includes("小組扣分"))); // 小組扣分不算個人負向
}
export function participation(recs, days) {
  const rs = classroomRecords(recs);
  const { recsOf, outside } = byDay(rs, days);
  const score = dailySum(days, recsOf, { base: 1, posValue: r => 1 + (r.level ?? 1), negValue: r => r.level ?? 1 });
  const grade = score >= 10 ? "特優" : score >= 6 ? "優" : "甲";
  const negs = rs.filter(r => r.pn === "－").map(r => r.level ?? 1);
  return { score, grade: applyNegatives(grade, negs), outside: outside.length };
}

// ── 4-2 作業成績 ──
const SETTLE = /^第\s*\d+\s*週/;                       // 週結寫回列（第N週作業完成獎勵／第N週打掃未達標）：是入帳用的彙總，不是當天狀態
const HW_REWARD = /作業完成獎勵/;
const HW_RULE = ["作業沒交", "沒有訂正"];              // 班規④（乙丙只數這些）
export function homeworkRecords(recs) {
  return norm(recs).filter(r => r.category === "作業" && r.pn && !HW_REWARD.test(r.desc) && !SETTLE.test(r.desc)).map(r => {
    if (r.pn === "＋") {
      const v = r.desc.includes("甲上上") ? 3 : r.desc.includes("甲上") ? 2 : r.level ? 1 + r.level : 1; // 完成、甲＝本分 +1
      return { ...r, value: v };
    }
    return { ...r, value: r.level ?? 1, rule: has(r, HW_RULE) };           // 未交、要訂正、甲下＝每筆 −1
  });
}
export function homework(recs, days) {
  const rs = homeworkRecords(recs);
  const { recsOf, outside } = byDay(rs, days);
  const score = dailySum(days, recsOf, { base: 1, posValue: r => r.value, negValue: r => r.value });
  const grade = score >= 7 ? "特優" : score >= 6 ? "優" : "甲";
  const negs = rs.filter(r => r.pn === "－" && r.rule).map(r => r.level ?? 1);
  return { score, grade: applyNegatives(grade, negs), outside: outside.length };
}

// ── 4-4 生活常規等第＋生活技能分數（同一個週分數）──
const LIFE = ["生活指導", "生活技能"];
const LATE = ["上學遲到"];
const TEETH = ["常規未達成", "沒潔牙", "含氟漱口水沒做"];
const CLEAN_MISS = ["打掃未達標"];
const NOSHOW = "輪到的工作或幹部職務沒做完"; // 班規⑦：打掃或午餐無故
export function lifeRecords(recs) {
  return norm(recs).filter(r => LIFE.includes(r.category) && !SETTLE.test(r.desc));
}
/** 一天的生活量尺：本份分（準時／打掃達標／潔牙各 1）＋正向取最高＋班規負向。
 *  遲到、潔牙沒做、打掃未達標是本份沒做到（該項 0 分），不是負向，不進乙丙次數。
 *  無故不掃＝打掃本份 0＋班規⑦ −1（SPEC L）：當天有「打掃缺席」且有班規⑦ 無故那一筆才算。 */
export function lifeDay(rs) {
  const late = rs.some(r => has(r, LATE));
  const teeth = rs.some(r => has(r, TEETH));
  const noShowClean = rs.some(r => r.desc === "打掃缺席") && rs.some(r => r.pn === "－" && r.desc.includes(NOSHOW));
  const clean = rs.some(r => has(r, CLEAN_MISS)) || noShowClean;
  const duty = 3 - late - teeth - clean;
  const pos = rs.filter(r => r.pn === "＋").map(r => r.level ?? 1);
  const rule = rs.filter(r => r.pn === "－" && !has(r, [...LATE, ...TEETH, ...CLEAN_MISS]));
  return { duty, bonus: pos.length ? Math.max(...pos) : 0, ruleNeg: rule.map(r => r.level ?? 1) };
}
/** 生活技能分數＝3＋（週分數−15）×0.5，.5 進位，夾 1–5（做法 B）。整數算：(週分數−9) ÷ 2 無條件進位。 */
export function lifeSkillScore(week) {
  const v = Math.ceil((week - 9) / 2); // 3 + (w-15)/2 四捨五入 = ceil((w-9)/2)，w 為整數時等價（半數一律往上）
  return Math.min(5, Math.max(1, v));
}
export function life(recs, days) {
  const rs = lifeRecords(recs);
  const { recsOf, outside } = byDay(rs, days);
  let score = 0; const negs = [];
  for (const day of days) {
    const d = lifeDay(recsOf(day));
    score += d.duty + d.bonus - d.ruleNeg.reduce((a, b) => a + b, 0);
    negs.push(...d.ruleNeg);
  }
  outside.filter(r => r.pn === "－" && !has(r, [...LATE, ...TEETH, ...CLEAN_MISS])).forEach(r => negs.push(r.level ?? 1));
  const grade = score >= 20 ? "特優" : score >= 16 ? "優" : "甲";
  return { score, grade: applyNegatives(grade, negs), skill: lifeSkillScore(score), outside: outside.length };
}

// ── 4-3 內容評量 ──
/** 導師課每週節數（課表名稱→權重）。英語(彈性) 是英師的課，不列入。課表改了這裡跟著改。 */
export const CONTENT_WEIGHTS = { 國語: 5, 數學: 4, 社會: 3, 綜合: 2, 健康: 1, 崑山活力Go: 1 };
const subjectKey = s => String(s ?? "").replace(/[（(]彈性[)）]/, "").replace(/\s/g, "").replace(/^綜合活動$/, "綜合");
/** scores：[{ subject, score }]。回傳 { grade, avg }；有讀不懂的科目或分數 → grade＝"需人工"（fail-closed）。 */
export function contentGrade(scores) {
  const by = {};
  for (const { subject, score } of scores) {
    const k = subjectKey(subject);
    if (k === "英語" || k === "其他") continue; // 科任課（英語、自然…紀錄庫科目選「其他」）不列入導師課加權
    if (!(k in CONTENT_WEIGHTS) || !Number.isFinite(score)) return { grade: "需人工", why: `科目或分數判不出：${subject ?? "（空）"} ${score}` };
    (by[k] ??= []).push(score);
  }
  const ks = Object.keys(by);
  if (!ks.length) return { grade: "甲", avg: null };
  let num = 0, den = 0;
  for (const k of ks) {
    const mean = by[k].reduce((a, b) => a + b, 0) / by[k].length;
    num += mean * CONTENT_WEIGHTS[k]; den += CONTENT_WEIGHTS[k];
  }
  const avg = num / den;
  const grade = avg >= 90 ? "特優" : avg >= 80 ? "優" : avg >= 70 ? "甲" : avg >= 60 ? "乙" : "丙";
  return { grade, avg: Math.round(avg * 10) / 10 };
}
/** 紀錄庫「評量」類 → 分數：讀 score（＝紀錄庫「分數」欄，2026-10-17 起 class-log 一律寫這欄）；
 *  舊列沒有 score 才退回描述裡的「NN 分」。缺考（score 空且描述含「缺考」）不計入。讀不到分數 → 需人工。 */
export function contentFromRecords(recs) {
  const rs = norm(recs).filter(r => r.category === "評量")
    .filter(r => !((r.score === null || r.score === undefined || r.score === "") && r.desc.includes("缺考")));
  const scores = rs.map(r => {
    const m = (r.score === "" ? null : r.score) ?? (r.desc.match(/(\d{1,3}(?:\.\d+)?)\s*分/) || [])[1];
    return { subject: r.subject, score: m === undefined || m === null ? NaN : Number(m) };
  });
  return contentGrade(scores);
}

/** 一位學生本週全部機器判。 */
export function gradeStudent(recs, days) {
  const p = participation(recs, days), h = homework(recs, days), l = life(recs, days), c = contentFromRecords(recs);
  return {
    上課參與: p.grade, 作業成績: h.grade, 生活常規: l.grade, 內容評量: c.grade, 生活技能分數: l.skill,
    週分數: { 上課參與: p.score, 作業: h.score, 生活: l.score },
    ...(c.why ? { 需人工: c.why } : {}),
    週外紀錄: p.outside + h.outside + l.outside,
  };
}
