/**
 * 📈 學習評量・整學期軌跡與 🎓 學期總結的評量部分（DI 線 v3.1，老師 2026-11-07 定案）。
 * 範本：ClassOS_v3.5_藍圖/學習軌跡_提案/範本_學習評量完整版_示意.html；裁定全文 PROPOSAL_學習軌跡.md。
 *   - 四格：①期中前平時卷平均 ②期中考 ③期末前平時卷平均 ④期末考；還沒考＝null（前端畫「—」）。
 *   - 整學期折線：橫軸固定 3 卷＋期中＋3 卷＋期末＝8 格；某段超過 3 份就加寬那一段（不丟資料）。
 *   - 學期總成績＝floor((期中＋期末)/2＋0.5) 換五等第（優 90↑／甲 80–89／乙 70–79／丙 60–69／丁 <60）；
 *     缺一科的考試分數＝不算（null，前端畫「—」），判不出不給預設值（U41）。
 *   - 錯過的觀念：期中＋期末兩次 growth 合併，同科同觀念只算一次、看最近那次考試（期末蓋過期中）。
 * 純函式、不讀檔、不連 Notion；只看自己，不放全班平均、不排名、不放級距。
 */
import { MAIN, roundHalfUp, summarize } from "./term-quiz.mjs";

export const SLOTS = 3; // 每段平時卷至少排 3 格
export const LEVELS = [[90, "優"], [80, "甲"], [70, "乙"], [60, "丙"], [0, "丁"]];
export const levelOf = (score) => (score == null ? null : LEVELS.find(([m]) => score >= m)[1]);

const scoreOf = (exam, subject) => {
  const s = exam?.subjects?.find((x) => x.subject === subject);
  return s && !s.absent && s.score != null ? s.score : null;
};

/**
 * @param {{ s1: Array, mid: object|null, s3: Array, fin: object|null }} seg
 *   s1／s3＝toQuiz() 的平時卷（已篩該段範圍）；mid／fin＝termExamData() 的結果
 * @returns {{ subjects: object, slots: {s1:number,s3:number}, state: object }}
 */
export function trailOf({ s1 = [], mid = null, s3 = [], fin = null }) {
  const sum1 = summarize(s1).subjects, sum3 = summarize(s3).subjects;
  const ok = (list, s) => list.filter((q) => q && !q.manual && !q.absent && q.subject === s)
    .sort((a, b) => a.date.localeCompare(b.date));
  const slots = {
    s1: Math.max(SLOTS, ...MAIN.map((s) => ok(s1, s).length)),
    s3: Math.max(SLOTS, ...MAIN.map((s) => ok(s3, s).length)),
  };
  const subjects = {};
  for (const s of MAIN) {
    const a = ok(s1, s), b = ok(s3, s);
    const m = scoreOf(mid, s), f = scoreOf(fin, s);
    subjects[s] = {
      cells: [sum1[s].avg, m, sum3[s].avg, f],
      n: [sum1[s].n, null, sum3[s].n, null],
      points: [
        ...a.map((q, i) => ({ slot: i, score: q.score, name: q.name, date: q.date })),
        ...(m != null ? [{ slot: slots.s1, score: m, name: "期中考", exam: true }] : []),
        ...b.map((q, i) => ({ slot: slots.s1 + 1 + i, score: q.score, name: q.name, date: q.date })),
        ...(f != null ? [{ slot: slots.s1 + slots.s3 + 1, score: f, name: "期末考", exam: true }] : []),
      ],
    };
  }
  const has = (list) => list.some((q) => q && !q.manual);
  const state = {
    s1: !has(s1) ? "lock" : mid ? "done" : "now",
    mid: mid ? "done" : "lock",
    s3: !has(s3) ? "lock" : fin ? "done" : "now",
    fin: fin ? "done" : "lock",
  };
  return { subjects, slots, state };
}

/**
 * 學期總結的評量部分（期末考登記後才有）。
 * @param {object} trail trailOf() 的結果
 * @param {object|null} mid termExamData()（期中考）
 * @param {object|null} fin termExamData()（期末考）
 * @returns {null | { lines: Array, grades: Array, tracked: Array, bySubject: object }}
 */
export function termSummary(trail, mid, fin) {
  if (!fin) return null;
  const lines = MAIN.map((s) => {
    const [a, , , f] = trail.subjects[s].cells;
    const d = a != null && f != null ? f - a : null;
    return { subject: s, cells: trail.subjects[s].cells, delta: d,
      verdict: d == null ? null : d >= 5 ? "up" : d <= -5 ? "down" : "flat" };
  });
  const grades = MAIN.map((s) => {
    const m = scoreOf(mid, s), f = scoreOf(fin, s);
    const total = m != null && f != null ? roundHalfUp((m + f) / 2) : null;
    return { subject: s, total, level: levelOf(total) };
  });
  const map = new Map();
  for (const g of [...(mid?.growth || []), ...(fin?.growth || [])]) map.set(`${g.subject}|${g.name}`, g);
  const tracked = [...map.values()].sort((a, b) =>
    MAIN.indexOf(a.subject) - MAIN.indexOf(b.subject) || (b.ok - a.ok) || (b.exam - a.exam));
  const bySubject = Object.fromEntries(MAIN.map((s) => {
    const t = tracked.filter((x) => x.subject === s);
    return [s, { n: t.length, ok: t.filter((x) => x.ok).length }];
  }));
  return { lines, grades, tracked, bySubject };
}
