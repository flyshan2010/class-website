/**
 * 行事曆說明欄的「座號清單」過濾（公開輸出護欄，U42：不該公開的在同步端就不寫進輸出）。
 *
 * 2026-10-10 加：老師在 Google 日曆說明欄隨手記了座號（流感施打名單、受獎名單），
 * 就這樣跟著同步進了公開的 data/calendar.json。這裡把「看起來像座號清單」的整行拿掉。
 *
 * 判定：同一行內有 3 個以上、用「。、，,．」隔開的 1～2 位數字，
 * 而且後面沒有接節／月／日／年級這類單位、前面也不是「第」。
 * 寧可多擋（班網少顯示一行備註），不可漏放；被擋的行數回傳給呼叫端寫進同步日誌。
 */

const SEP = "[。、，,．]";
const UNIT = "(?:節|堂|課|月|日|號|點|時|分|年|班|週|周|頁|題|組|樓|元|人|名|位|個|場|次|天)";
const SEAT_LIST = new RegExp(
  `(?<![第\\d/.\\-])(?:\\d{1,2}\\s*${SEP}\\s*){2,}\\d{1,2}(?!\\d)(?!\\s*${UNIT})(?![/:.\\-]\\d)`
);

/** @returns {{ text: string, dropped: number }} */
export function scrubSeatLists(notes) {
  const lines = String(notes ?? "").split("\n");
  const kept = lines.filter(line => !SEAT_LIST.test(line));
  return {
    text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    dropped: lines.length - kept.length,
  };
}
