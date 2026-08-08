/**
 * 姓名去識別化（班網公開頁共用正本）
 *
 * 基本規則：保留姓與名末字，中間打○（陳柏佑 → 陳○佑）。
 *
 * 為什麼要 uniqueMaskNames：基本規則在同姓且名末字相同時會撞名
 * （陳柏佑／陳冠佑 都變「陳○佑」；吳語安／吳芮安 都變「吳○安」）。
 * 撞名的後果不是美觀問題——午餐值週表每週換人，學生看到「陳○佑」
 * 無法判斷是不是自己，工作就會沒人做或兩個人做。
 * 因此撞名時改遮末字、保留中間字（陳柏○／陳冠○），仍然不是完整姓名，
 * 也不需要動用座號（鐵則 10：班網公開頁不得出現姓名／座號）。
 */

/** 基本遮罩：陳柏佑 → 陳○佑；王小明 → 王○明；李四 → 李○ */
export function maskName(full) {
  const name = String(full || "").replace(/^\s*\d+\s*/, "").trim();
  if (name.length <= 1) return name || "○○○";
  return name[0] + "○".repeat(Math.max(1, name.length - 2)) + (name.length > 2 ? name[name.length - 1] : "");
}

/** 備援遮罩：遮末字、保留前面（陳柏佑 → 陳柏○） */
function maskTail(full) {
  const name = String(full || "").replace(/^\s*\d+\s*/, "").trim();
  if (name.length <= 1) return name || "○○○";
  return name.slice(0, -1) + "○";
}

/**
 * 一次算出整班的遮罩姓名，保證班內唯一。
 * @param {string[]} fullNames 全班完整姓名
 * @returns {Map<string,string>} 完整姓名 → 遮罩姓名
 * @throws 兩種遮罩都無法區分時（例如完全同名）拋錯，由老師決定怎麼標示
 */
export function uniqueMaskNames(fullNames) {
  const names = fullNames.map(n => String(n || "").trim());
  const byBase = new Map();
  for (const n of names) {
    const b = maskName(n);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(n);
  }

  const out = new Map();
  for (const [base, group] of byBase) {
    // 同一個人重複出現在名單裡不算撞名，只有不同姓名撞在一起才要換規則
    const distinct = [...new Set(group)];
    for (const n of distinct) out.set(n, distinct.length === 1 ? base : maskTail(n));
  }

  const used = new Map();
  for (const [full, masked] of out) {
    if (used.has(masked) && used.get(masked) !== full)
      throw new Error(`遮罩姓名撞名且無法自動區分：「${used.get(masked)}」與「${full}」都會變成「${masked}」，請老師指定顯示方式`);
    used.set(masked, full);
  }
  return out;
}
