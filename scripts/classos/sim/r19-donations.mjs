/**
 * R19 集資捐款入帳只讀演練（規則本體 lib/r19-donations.mjs；共用累計 scripts/lib/class-goal.mjs）
 * 不連 Notion、不寫任何資料：答案寫死在題目裡——規則一漂，這支就會 FAIL。
 * ⚠️ PUBLIC repo：只用虛構座號、虛構頁面 id、虛構目標名，不含任何學生資料。
 * 執行：node scripts/classos/sim/r19-donations.mjs
 */
import { isDonation, parseDonation, planTask, execLog } from "../lib/r19-donations.mjs";
import { tallyGoal, backersNeededOf, inWindow } from "../../lib/class-goal.mjs";

let n = 0, fail = 0;
const eq = (name, got, want) => {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}：得到 ${g}，應為 ${w}`); }
};
const weeks = { 學期: [{ 週: [{ 起: "2026-10-12", 迄: "2026-10-18", 標籤: "四上第7週(10/12-10/16)" }] }] };
const roster = new Map([[19, "p19"], [23, "p23"], [25, "p25"]]);
const D = "2026-10-12";
const pay = (student, amount) => ({ student, amount, type: "薪水", reason: "第6週薪水", date: "2026-10-08" });
const gift = (student, amount, name = "目標甲", date = D) => ({ student, amount: -amount, type: "消費", reason: `集資-${name}`, date });
const goals = [
  { name: "目標甲", target: 100, limit: 1, open: true },
  { name: "目標乙", target: 500, limit: 2, open: false },
];
const ctx = (ledger, g = goals) => ({ roster, weeks, backersNeeded: 2, goals: g, ledger });
const plan = (text, ledger, g, date = D) => planTask({ text, date }, ctx(ledger, g));
const brief = (p) => [p.status, p.code ?? "", p.seat ?? "", p.amount ?? "", p.goal?.name ?? "", p.balance ?? ""];

// ── 路由（與代理、雲端手冊同一條規則）──
eq("路由：25捐50幣", isDonation("25捐50幣", 0), true);
eq("路由：座號25 捐 50 幣", isDonation("座號25 捐 50 幣給目標甲", 0), true);
eq("路由：捐款", isDonation("25號捐款30", 0), true);
eq("路由：集資", isDonation("座號19 集資 20 幣", 0), true);
eq("路由：全形數字", isDonation("２５捐５０幣", 0), true);
eq("路由：捐後面不是數字（表現紀錄）", isDonation("座號3 捐發票做公益 +1", 0), false);
eq("路由：記錄開頭歸 R01", isDonation("記錄：座號3 捐款50元給家扶 +1", 0), false);
eq("路由：有附件不收", isDonation("25捐50幣", 1), false);
eq("路由：R18 事件包不收", isDonation("#CM-EVENTS 捐50", 0), false);
eq("路由：買東西不收", isDonation("座號5 買 貼紙", 0), false);

// ── 解析 ──
eq("解析：最短寫法", parseDonation("25捐50幣"), { ok: true, seat: 25, amount: 50, target: "" });
eq("解析：完整寫法", parseDonation("座號 7 捐 50 幣給一節自由活動時間"), { ok: true, seat: 7, amount: 50, target: "一節自由活動時間" });
eq("解析：號＋捐款＋沒單位", parseDonation("25號捐款30"), { ok: true, seat: 25, amount: 30, target: "" });
eq("解析：目標帶引號與句號", parseDonation("座號19 捐 5 幣給「目標甲」。"), { ok: true, seat: 19, amount: 5, target: "目標甲" });
eq("解析：目標寫成事由樣式", parseDonation("19捐5幣 集資-目標甲"), { ok: true, seat: 19, amount: 5, target: "目標甲" });
eq("解析：全形", parseDonation("座號２５　捐５０幣"), { ok: true, seat: 25, amount: 50, target: "" });
eq("解析：兩個座號不收", parseDonation("19 23 各捐10幣").ok, false);
eq("解析：0 幣不收", parseDonation("19捐0幣").ok, false);
eq("解析：兩行不收", parseDonation("19捐5幣\n23捐5幣").ok, false);
eq("解析：座號在後面不收", parseDonation("捐50幣 座號25").ok, false);

// ── 規劃 ──
const L = [pay("p19", 100), pay("p23", 10), pay("p25", 366)];
eq("規劃：沒寫目標＋只有一個開放 → 入帳", brief(plan("25捐50幣", L)), ["write", "", 25, 50, "目標甲", 316]);
const w = plan("25捐50幣", L);
eq("規劃：帳列欄位", [w.props.事由.title[0].text.content, w.props.金額.number, w.props.類型.select.name, w.props.週次.rich_text[0].text.content,
  w.props.學年.select.name, w.props.學生.relation[0].id, w.props.日期.date.start],
  ["集資-目標甲", -50, "消費", "四上第7週(10/12-10/16)", "115", "p25", D]);
eq("規劃：執行紀錄", execLog(w), "座號25 捐 50 幣給〈目標甲〉已入帳，餘額 316；本輪累計 50／100 幣、1／2 人");
eq("規劃：指定目標", brief(plan("座號19 捐 5 幣給目標甲", L)), ["write", "", 19, 5, "目標甲", 95]);
eq("規劃：非在學", brief(plan("座號7 捐 5 幣", L)).slice(0, 2), ["fail", "E01"]);
eq("規劃：目標名差一字", brief(plan("19捐5幣給目標丙", L)).slice(0, 2), ["fail", "E71"]);
eq("規劃：目標未開放", brief(plan("19捐5幣給目標乙", L)).slice(0, 2), ["fail", "E72"]);
eq("規劃：沒寫目標＋兩個開放 → 要老師寫明", brief(plan("19捐5幣", L, goals.map((g) => ({ ...g, open: true })))).slice(0, 2), ["fail", "E71"]);
eq("規劃：沒寫目標＋沒有開放", brief(plan("19捐5幣", L, [])).slice(0, 2), ["fail", "E71"]);
eq("規劃：餘額不足", [plan("座號23 捐 50 幣", L).code, plan("座號23 捐 50 幣", L).why], ["E74", "座號23餘額不足（現有 10 幣，需 50 幣），沒有入帳"]);
eq("規劃：餘額剛好夠", brief(plan("座號23 捐 10 幣", L)), ["write", "", 23, 10, "目標甲", 0]);
eq("規劃：同日同額已有帳 → 待審（重送不重扣）", plan("25捐50幣", [...L, gift("p25", 50)]).status, "review");
eq("規劃：同日不同額 → 照入", plan("25捐20幣", [...L, gift("p25", 50)]).status, "write");
eq("規劃：前一天同額 → 照入", plan("25捐50幣", [...L, gift("p25", 50, "目標甲", "2026-10-11")]).status, "write");
eq("規劃：別的目標同額 → 照入", plan("25捐50幣", [...L, gift("p25", 50, "目標乙")]).status, "write");
eq("規劃：假期 → 待審", plan("25捐50幣", L, goals, "2026-07-20").status, "review");
// 已達成次數上限：兩人湊滿 100 幣且人數到 2 → 第 1 次達成，limit 1 → 不再收
const done = [...L, gift("p19", 60, "目標甲", "2026-10-09"), gift("p25", 40, "目標甲", "2026-10-09")];
eq("規劃：次數已滿不再收", brief(plan("座號23 捐 5 幣", done)).slice(0, 2), ["fail", "E73"]);
// 錢到了人數沒到 → 還沒達成，繼續收
eq("規劃：錢夠人不夠仍可捐", plan("座號23 捐 5 幣", [...L, gift("p25", 100, "目標甲", "2026-10-09")]).status, "write");
const hit = plan("座號19 捐 50 幣", [...L, gift("p25", 50, "目標甲", "2026-10-09")]);
eq("規劃：這一筆剛好達成", execLog(hit), "座號19 捐 50 幣給〈目標甲〉已入帳，餘額 50；🎉 已達成第 1 次");

// ── 共用累計（與班網進度條同一支）──
const T = (txs, o) => tallyGoal(txs, { target: 100, limit: 2, backersNeeded: 2, ...o });
eq("累計：空", T([]), { raised: 0, backers: 0, roundsDone: 0, closed: false, lastDate: "" });
eq("累計：同一人三次只算一人", [T([{ amount: -10, student: "a", date: "1" }, { amount: -10, student: "a", date: "2" }, { amount: -10, student: "a", date: "3" }]).backers], [1]);
eq("累計：達成後歸零進下一輪", T([{ amount: -60, student: "a", date: "1" }, { amount: -40, student: "b", date: "2" }, { amount: -5, student: "a", date: "3" }]),
  { raised: 5, backers: 1, roundsDone: 1, closed: false, lastDate: "3" });
eq("門檻：27 人 → 20 人", backersNeededOf(27), 20);
eq("開放期間：迄日當天仍開放", [inWindow("", "", D), inWindow("2026-11-09", "", D), inWindow("", D, D), inWindow("", "2026-10-11", D)], [true, false, true, false]);

console.log(`R19 規則測試 ${n} 題／失敗 ${fail} 題`);
process.exit(fail ? 1 : 0);
