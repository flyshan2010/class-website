/**
 * 📝 期中評量分頁資料（DG 線，老師 2026-11-06 定案範本 ClassOS_v3.5_藍圖/期中考分頁_範本.html；資料流裁定 A）：
 *   期中考錯題表照平時卷流程寫紀錄庫評量列（評量名稱＝期中考），term-quiz 的 toQuiz 排除、這裡另組分頁。
 *   A 三科分數對照平時卷平均 → B 先複習（前端算）→ C 平時卷錯過的觀念期中考學會沒 → D 各科錯題分析（沿用 quiz-errors）。
 * 純函式、不讀檔、不連 Notion；只看自己，不放全班平均、不排名。
 */

export const MASTERED = 80; // 得分率 ≥ 80％＝學會了（與平時卷「要加強」同一條線）

/**
 * @param {Array} exams  該生該次定期評量各科：[{ subject, date, score|null, absent, item|null }]
 *                       item＝quiz-errors reportItem() 的結果（錯題分析對不到就 null，只顯示分數）
 * @param {Array} quizItems 該生期中階段平時卷的 reportItem() 結果（有 subject、date、name、kp）
 * @param {object} quizAvg  期中階段平時卷平均 { 國語: 81, ... }（summarize().subjects[s].avg）
 * @returns {null | { subjects: Array, growth: Array }}
 */
export function midtermData(exams, quizItems, quizAvg) {
  if (!exams?.length) return null;
  const subjects = exams.map((e) => ({
    subject: e.subject, date: e.date, score: e.absent ? null : e.score, absent: !!e.absent,
    quizAvg: quizAvg?.[e.subject] ?? null, item: e.absent ? null : e.item || null,
  }));
  // 平時卷錯過（< 80％）的知識點：同科同名，看期中考前最近一份考到它的平時卷
  const growth = [];
  for (const s of subjects) {
    if (!s.item) continue;
    const prior = quizItems.filter((q) => q.subject === s.subject && q.date < s.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    for (const k of s.item.kp) {
      const hit = prior.find((q) => q.kp.some((x) => x.name === k.name));
      if (!hit) continue;
      const quiz = hit.kp.find((x) => x.name === k.name).rate;
      if (quiz == null || quiz >= MASTERED || k.rate == null) continue;
      growth.push({ subject: s.subject, name: k.name, quiz, quizName: hit.name, mid: k.rate, ok: k.rate >= MASTERED });
    }
  }
  growth.sort((a, b) => (b.ok - a.ok) || ((b.mid - b.quiz) - (a.mid - a.quiz)));
  return { subjects, growth };
}
