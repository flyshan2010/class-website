// 自學星圖闖關規則（規格正本：ClassOS_v3.5_藍圖/SPEC_自學星圖_P1資料模型.md §5.1–5.3）
// 全部是純函式；P2 前台與代理共用這一支，不各自重寫（U83）。

/**
 * §5.1 一格的燈。
 * @param {{first:boolean, hinted:boolean, retry?:boolean|null}} a
 *   first＝第一次是否答對；hinted＝第一次是否用過提示（1–3 層都算）；
 *   retry＝第一次答錯後再挑戰是否答對（沒再挑戰為 null）
 * @returns {{light:"gold"|"silver"|"dark", streak:"+1"|"keep"|"reset", card:null|"待複習"|"已克服"}}
 */
export function slotLight({ first, hinted, retry = null }) {
  if (first) return hinted
    ? { light: "silver", streak: "keep", card: null }
    : { light: "gold", streak: "+1", card: null };
  if (retry === true) return { light: "silver", streak: "keep", card: "已克服" }; // 再挑戰用不用提示都是銀燈
  return { light: "dark", streak: "reset", card: "待複習" };
}

/** 套用連對變化 */
export function nextStreak(streak, change) {
  return change === "+1" ? streak + 1 : change === "reset" ? 0 : streak;
}

/** §5.2 星等：由上往下，先符合先算 */
export function stars(gold, silver) {
  const lit = gold + silver;
  if (lit === 7 && gold >= 6) return 3;
  if (lit >= 5) return 2;
  if (lit >= 3) return 1;
  return 0;
}
export const allGold = (gold) => gold === 7; // 全對＝七盞都是金燈（≠3 星）
export const passed = (gold, silver) => stars(gold, silver) >= 1;

/**
 * 一回合結束後更新該關紀錄（存檔 lv：[最高星等, 曾經七盞全金, 挑戰次數]）
 * @returns {{record:[number,0|1,number], gained:number}} gained＝刷新紀錄多出來的星（加進本週星數）
 */
export function applyRound(record, gold, silver) {
  const [best, everGold, tries] = record ?? [0, 0, 0];
  const s = stars(gold, silver);
  const newBest = Math.max(best, s);
  return {
    record: [newBest, everGold || allGold(gold) ? 1 : 0, tries + 1],
    gained: newBest - best,
  };
}

/** 寶箱：一座島每一關「曾經七盞全金」都是 1 才開（不必同一次完成） */
export function chestOpen(islandLevelCodes, lv) {
  return islandLevelCodes.length > 0 && islandLevelCodes.every((c) => lv[c]?.[1] === 1);
}

/** §5.3 星數＝各關最高星等加總；完成關數＝最高星等 ≥1 的關數 */
export function totals(lv) {
  const recs = Object.values(lv ?? {});
  return {
    stars: recs.reduce((n, r) => n + r[0], 0),
    completed: recs.filter((r) => r[0] >= 1).length,
  };
}

/** 本週起算日（臺北時間週一），回傳 YYYY-MM-DD */
export function weekStart(date) {
  const tpe = new Date(new Date(date).getTime() + 8 * 3600e3); // 用 UTC 欄位讀臺北時間
  const dow = (tpe.getUTCDay() + 6) % 7; // 週一＝0
  tpe.setUTCDate(tpe.getUTCDate() - dow);
  return tpe.toISOString().slice(0, 10);
}

/** 換週就把本週星數歸零，再加這次多出來的星 */
export function addWeekly({ weekly, since }, gained, now) {
  const ws = weekStart(now);
  return since === ws ? { weekly: weekly + gained, since } : { weekly: gained, since: ws };
}

/**
 * 排行：同分並列同一名次（1、1、3）。keys 由大到小比；回傳依名次排序的 [{...row, rank}]
 * 進度榜：keys＝[完成關數, 星數]；星數榜：[星數]；本週榜：[本週星數]
 */
export function rank(rows, keys) {
  const cmp = (a, b) => { for (const k of keys) if (b[k] !== a[k]) return b[k] - a[k]; return 0; };
  const sorted = [...rows].sort(cmp);
  let r = 0;
  return sorted.map((row, i) => {
    if (i === 0 || cmp(sorted[i - 1], row) !== 0) r = i + 1;
    return { ...row, rank: r };
  });
}

/** 「再 N 顆星就追平前一名」：自己是第一名回 null */
export function starsToCatchUp(ranked, seat, key = "stars") {
  const me = ranked.find((x) => x.seat === seat);
  if (!me || me.rank === 1) return null;
  const prev = ranked.filter((x) => x.rank < me.rank).at(-1);
  return prev[key] - me[key];
}
