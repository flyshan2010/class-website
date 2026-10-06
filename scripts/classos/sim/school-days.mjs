/**
 * sim/school-days｜上課日／工作日／收尾日判定的自測（純本機、零寫入、不需 token）
 * 用法：node scripts/classos/sim/school-days.mjs      全過 exit 0，有一題不過 exit 1
 * 題目＝115 上真實行事曆的邊界（放假週、定期評量、校外活動、學期末），外加合成資料的判不出情形。
 */
import { readFile } from "node:fs/promises";
import { weekInfo, weekRange, schoolDays, workDays } from "../lib/school-days.mjs";

const plan = JSON.parse(await readFile(new URL("../../../data/daily-plan.json", import.meta.url), "utf8"));
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : `｜得到 ${JSON.stringify(got)}，應為 ${JSON.stringify(want)}`}`);
};
const closing = d => weekInfo(plan, d).closingDay;
const isC = d => weekInfo(plan, d).isClosingDay;

eq("週界線：週四 → 週一～週日", weekRange("2026-10-08"), { from: "2026-10-05", to: "2026-10-11" });
eq("週界線：週日歸同一週", weekRange("2026-10-11"), { from: "2026-10-05", to: "2026-10-11" });

// 第6週：10/8 戶外教學、10/9 國慶調整放假
eq("W06 收尾日＝10/8（校外活動日也算上課日）", closing("2026-10-07"), "2026-10-08");
eq("W06 10/8 是收尾日", isC("2026-10-08"), true);
eq("W06 10/7 不是", isC("2026-10-07"), false);
eq("W06 10/9（放假的週五）不是", isC("2026-10-09"), false);
eq("W06 工作日＝一二三（扣掉戶外教學）", weekInfo(plan, "2026-10-08").workDays, ["2026-10-05", "2026-10-06", "2026-10-07"]);
eq("W06 上課日 4 天", weekInfo(plan, "2026-10-08").schoolDays.length, 4);

// 一般週
eq("W07 收尾日＝週五 10/16", closing("2026-10-14"), "2026-10-16");
eq("W07 工作日 5 天", weekInfo(plan, "2026-10-16").workDays.length, 5);

// 已過去的放假週（回歸基準）
eq("W04 收尾日＝9/24（9/25 放假）", closing("2026-09-22"), "2026-09-24");
eq("W05 工作日 4 天（9/28 放假）", weekInfo(plan, "2026-10-02").workDays.length, 4);
eq("W05 收尾日仍是週五 10/2", closing("2026-09-29"), "2026-10-02");

// 定期評量日：資料標 holiday:true，但學生到校 → 算上課日
eq("W10 收尾日＝11/6（評量第二天，不是 11/4）", closing("2026-11-04"), "2026-11-06");
eq("W10 11/4 不是收尾日", isC("2026-11-04"), false);
eq("W10 上課日 5 天", weekInfo(plan, "2026-11-06").schoolDays.length, 5);
eq("W20 期末評量週仍 5 天、收尾 1/15", [weekInfo(plan, "2027-01-15").schoolDays.length, closing("2027-01-12")], [5, "2027-01-15"]);

// 其餘非週五收尾的週
eq("W09 光復節補假：工作日 4 天、收尾週五", [weekInfo(plan, "2026-10-30").workDays.length, closing("2026-10-27")], [4, "2026-10-30"]);
eq("W17 收尾日＝12/24", closing("2026-12-21"), "2026-12-24");
eq("W18 收尾日＝12/31", closing("2026-12-28"), "2026-12-31");
eq("W21 不帶學期界線會被預排日 1/21、1/22 往後推（對照組）", closing("2027-01-18"), "2027-01-22");
eq("W21 休業式 1/20 算上課日、不算工作日", [weekInfo(plan, "2027-01-20", { to: "2027-01-20" }).schoolDays.length, weekInfo(plan, "2027-01-20", { to: "2027-01-20" }).workDays.length], [3, 2]);
eq("W21 帶學期週 迄=1/20 → 收尾日 1/20", weekInfo(plan, "2027-01-18", { from: "2027-01-18", to: "2027-01-20" }).closingDay, "2027-01-20");

// 判不出：資料沒有那一週
eq("資料外的週 known=false", weekInfo(plan, "2027-03-03").known, false);
eq("資料外的週不是收尾日", weekInfo(plan, "2027-03-03").isClosingDay, false);

// 合成：整週放假
const syn = { days: [{ date: "2030-01-07", holiday: true, note: "春節" }] };
eq("整週放假：known 但沒有收尾日", [weekInfo(syn, "2030-01-07").known, weekInfo(syn, "2030-01-07").closingDay], [true, null]);
eq("區間函式：schoolDays／workDays", [schoolDays(plan, "2026-10-05", "2026-10-11").length, workDays(plan, "2026-10-05", "2026-10-11").length], [4, 3]);

console.log(fail ? `\n❌ ${fail} 題不過` : "\n✅ 全部通過");
process.exit(fail ? 1 : 0);
