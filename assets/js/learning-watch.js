/* 學習報告「需要關注」規則（BR 線，老師 2026-10-15 裁定）——全站唯一一份判斷，前端儀表板與日後 sync／報告都引用這支（U83）。
 *
 * 規則（每位學生 × 每個向度，看「這週」與前兩週的分數）：
 *   ① 本週低於 2 分 → 關注
 *   ② 連 2 週下滑（前前週 > 上週 > 本週）且累計降幅 ≥ 0.5 → 關注
 *   ③ 缺資料＝需人工（fail-closed，判不出不可當成正常）：
 *      本週沒分數、分數不在 1–5、或前兩週有缺（無法判斷趨勢）都標「需人工」。
 *      唯一例外：全班都還沒有前兩週（學期第 1、2 份報告）→ 只能看 ①，趨勢標「週次不足」，不算需人工。
 *
 * 分數是 0.5 一級；比較一律換成整數十分位（×10 再四捨五入），避免浮點誤差（例 3.5−3.0 不等於 0.5）。
 * 執行測試：node --test scripts/learning-watch.test.mjs
 */
(function (root) {
  "use strict";
  const DIMS = ["國語", "數學", "社會", "人際互動", "生活技能"];
  const LOW = 20;      // 低於 2 分（十分位）
  const DROP = 5;      // 累計降幅 ≥ 0.5（十分位）

  // 有效分數 → 十分位整數；空值、0、非數字、超出 1–5 一律回 null（＝缺資料）
  const tenth = v => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 5) return null;
    return Math.floor(n * 10 + 0.5);
  };
  const fmt = t => String(t / 10);

  /**
   * 判斷一個向度。
   * @param {Array<number|null>} series 依週次排序的分數（index 0 最早）
   * @param {number} w 要判斷的週次 index
   * @returns {{level:"watch"|"manual"|"ok", rule?:string, reason:string}}
   */
  function judgeDim(series, w) {
    const a = tenth(series[w]);
    if (a === null) {
      const raw = series[w];
      const bad = raw !== null && raw !== undefined && raw !== "" && Number(raw) !== 0;
      return { level: "manual", rule: "缺資料", reason: bad ? `分數異常（${raw}）` : "本週沒有分數" };
    }
    if (a < LOW) return { level: "watch", rule: "低於2分", reason: `本週 ${fmt(a)} 分` };
    if (w < 2) return { level: "ok", rule: "週次不足", reason: "前面不到兩週，只檢查是否低於 2 分" };
    const b = tenth(series[w - 1]), c = tenth(series[w - 2]);
    if (b === null || c === null) return { level: "manual", rule: "缺資料", reason: "前兩週有缺分數，無法判斷趨勢" };
    if (c > b && b > a && c - a >= DROP) {
      return { level: "watch", rule: "連2週下滑", reason: `連 2 週下滑 ${fmt(c)}→${fmt(b)}→${fmt(a)}` };
    }
    return { level: "ok", reason: "" };
  }

  /**
   * 全班判斷。
   * @param {Object} bySeat { [座號]: { [向度]: Array<number|null> } }，沒有報告的週次放 null
   * @param {number[]} seats 名冊在學座號（以名冊為準，沒有報告的座號也要列進來）
   * @param {number} w 週次 index
   * @returns {{watch:Array, manual:Array, okSeats:number[]}}
   *   watch / manual 每筆 { seat, dim, rule, reason }；整週沒報告的座號 dim＝"全部"（只列一筆）
   */
  function judgeClass(bySeat, seats, w) {
    const watch = [], manual = [], okSeats = [];
    for (const seat of seats) {
      const s = bySeat[seat];
      const hasAny = s && DIMS.some(d => tenth((s[d] || [])[w]) !== null);
      if (!hasAny) { manual.push({ seat, dim: "全部", rule: "缺資料", reason: "本週沒有報告分數" }); continue; }
      let flagged = false;
      for (const d of DIMS) {
        const r = judgeDim(s[d] || [], w);
        if (r.level === "watch") { watch.push({ seat, dim: d, rule: r.rule, reason: r.reason }); flagged = true; }
        else if (r.level === "manual") { manual.push({ seat, dim: d, rule: r.rule, reason: r.reason }); flagged = true; }
      }
      if (!flagged) okSeats.push(seat);
    }
    return { watch, manual, okSeats };
  }

  const api = { DIMS, judgeDim, judgeClass, tenth };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LearningWatch = api;
})(typeof window !== "undefined" ? window : globalThis);
