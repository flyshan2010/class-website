/**
 * 週結試算要不要在收件匣建「待審」任務（老師 2026-10-16 裁定）。
 *
 * 起因：2026-10-16 weekly-settle 的 GitHub 排程延遲到 18:14 才跑，那時第 7 週已入帳，
 * 試算照樣建了第二筆待審（合計 1223、本次實際待入帳 0）——按下去不會多發錢（防重複擋著），
 * 但多一張要老師判斷的單子。雲端第 3 支 14:24 找不到試算也會自己觸發一次，延遲的排程每週都會再多一筆。
 *
 * 判斷只吃 f24 已經算好的「已入帳偵測」結果（paidOf、writtenBack、② 的紀錄id×學生id 防重複），
 * 這裡不重新判斷什麼叫已入帳（U83）。
 *
 * 略過＝「沒有任何一項還待入帳」而且「本週帳本確實已有入帳列」。只看 due===0 不夠：
 * ② 扣幣與加幣可能剛好相抵成 0，但那幾筆仍待入帳。
 */

/**
 * @param {object} a
 * @param {Record<string,{total:number, paidN:number}>} a.formula ①③④⑤⑥：本週公式金額與已入帳筆數
 * @param {number} a.rewardN ② 待入帳筆數
 * @param {number} a.badN ⑦ 待入帳人數（已寫回者 f24 已排除）
 * @param {number} a.ledgerHits 本週帳本已入帳列數（①③④⑤⑥ 命中筆數＋② 掛紀錄庫的列）
 * @returns {{create: boolean, reason: string}}
 */
export function settleInboxDecision({ formula, rewardN, badN, ledgerHits }) {
  const pendingFormula = Object.entries(formula)
    .filter(([, v]) => v.total !== 0 && !v.paidN).map(([k]) => k);
  const pending = pendingFormula.length > 0 || rewardN > 0 || badN > 0;
  if (pending) return { create: true, reason: `尚有待入帳項目（${[...pendingFormula, rewardN ? "②" : "", badN ? "⑦" : ""].filter(Boolean).join("、")}）` };
  if (ledgerHits > 0) return { create: false, reason: `本週已入帳（帳本 ${ledgerHits} 列），略過建立待審` };
  return { create: true, reason: "本週沒有待入帳、帳本也沒有入帳列（照建，讓老師知道本週為 0）" };
}
