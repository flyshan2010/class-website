/**
 * R19 集資捐款入帳規則本體（純函式，不連 Notion）
 * ───────────────────────────────────────────────────────────────
 * 教師專區一句話任務「座號25 捐 50 幣」「25捐50幣給一節自由活動時間」→ 🏦 班級銀行帳本一筆消費。
 * 規格：ClassOS_v3.5_藍圖/SPEC_班級經濟機制.md §2-6；手動版正本 .claude/skills/class-bank/SKILL.md 功能二之二。
 * 測試：scripts/classos/sim/r19-donations.mjs（改規則先改測試）。
 *
 * 判不出就不入帳（fail-closed）：座號、金額、目標任一不明確 → 失敗並請老師改寫；
 * 可能是重送（同人同目標同日同額已有帳）或假期 → 待審，一筆都不寫。
 */
import { weekLabel } from "./cm-events.mjs";
import { academicYearValue } from "./academic-year.mjs";
import { goalPrefix, tallyGoal } from "../../lib/class-goal.mjs";

const norm = (s) => String(s ?? "").normalize("NFKC").trim();
const KEY = /(?:捐款?|集資)\s*\d/;
// 「座號25 捐 50 幣給○○」「25號捐50」「25 集資 30幣 ○○」
const SENTENCE = /^(?:座號\s*)?(\d{1,2})\s*號?\s*(?:捐款?|集資)\s*(\d{1,5})\s*(?:崑山幣|幣|元|點)?\s*(?:給|到|至|進)?\s*(.*)$/;
const HINT = "請寫成「座號25 捐 50 幣」（一次一位、一筆；要指定目標就接「給○○」）";

/**
 * 路由判斷：沒有附件、不是 R18 事件包、不是「記錄」開頭，且「捐／捐款／集資」後面直接接數字。
 * ⚠️ 與 Apps Script 代理 submit_task 的 r19 觸發條件、雲端排程手冊 R19 那一列是同一條規則，三處要一起改。
 */
export function isDonation(text, fileCount) {
  const t = norm(text);
  if (fileCount > 0 || t.startsWith("#CM-EVENTS") || /^記[錄録]/.test(t)) return false;
  return KEY.test(t);
}

/** 解析一句話 → { ok, seat, amount, target } 或 { ok:false, code, why }。 */
export function parseDonation(text) {
  const t = norm(text);
  if (/\n/.test(t)) return { ok: false, code: "E03", why: `一次只能記一筆捐款。${HINT}` };
  const m = t.match(SENTENCE);
  if (!m) return { ok: false, code: "E03", why: `看不出是誰捐多少。${HINT}` };
  const amount = Number(m[2]);
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, code: "E03", why: "捐款金額要是 1 以上的整數" };
  const target = m[3].replace(/^集資[-－・]\s*/, "").replace(/^[「『"'\s]+|[」』"'\s。.!！]+$/g, "");
  return { ok: true, seat: Number(m[1]), amount, target };
}

/**
 * 整件規劃（不寫任何東西）。
 * task＝{ text, date:"YYYY-MM-DD" }
 * ctx＝{ roster:Map<seat,pageId>, weeks, backersNeeded,
 *        goals:[{ name, target, limit, open }]（商店 ⑥ 層且上架的列；open＝在開放期間內）,
 *        ledger:[{ student, amount, type, reason, date }]（帳本全部帳列） }
 * 回傳 { status:"write"|"review"|"fail", code?, why?, seat?, amount?, goal?, balance?, after?, props? }
 */
export function planTask(task, ctx) {
  const p = parseDonation(task.text);
  if (!p.ok) return { status: "fail", code: p.code, why: p.why };
  const { seat, amount } = p;
  const student = ctx.roster.get(seat);
  if (!student) return { status: "fail", code: "E01", why: `座號${seat}不在名冊或已不在學` };

  const openGoals = ctx.goals.filter((g) => g.open);
  const names = openGoals.map((g) => `「${g.name}」`).join("、") || "（目前沒有開放中的集資目標）";
  let goal;
  if (p.target) {
    goal = ctx.goals.find((g) => g.name === p.target);
    if (!goal) return { status: "fail", code: "E71", why: `找不到集資目標「${p.target}」（名稱要一字不差）。開放中：${names}` };
    if (!goal.open) return { status: "fail", code: "E72", why: `「${goal.name}」目前不在開放期間。開放中：${names}` };
  } else {
    if (openGoals.length !== 1) return { status: "fail", code: "E71", why: `請寫明捐給哪個目標（座號${seat} 捐 ${amount} 幣給○○）。開放中：${names}` };
    goal = openGoals[0];
  }

  const prefix = goalPrefix(goal.name);
  const mine = (rows) => rows
    .filter((r) => r.type === "消費" && String(r.reason ?? "").trim().startsWith(prefix))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const tallyOf = (rows) => tallyGoal(mine(rows), { target: goal.target, limit: goal.limit, backersNeeded: ctx.backersNeeded });
  if (tallyOf(ctx.ledger).closed) return { status: "fail", code: "E73", why: `「${goal.name}」本學期可達成的次數已滿，不再收捐款` };

  const week = weekLabel(task.date, ctx.weeks);
  if (!week) return { status: "review", why: `${task.date} 不在任何上課週內（假期），沒有入帳；請在 Claude Code 對話指定週次入帳` };

  const balance = ctx.ledger.filter((r) => r.student === student).reduce((s, r) => s + (Math.round(Number(r.amount)) || 0), 0);
  if (balance < amount) return { status: "fail", code: "E74", why: `座號${seat}餘額不足（現有 ${balance} 幣，需 ${amount} 幣），沒有入帳` };

  const dup = ctx.ledger.some((r) => r.student === student && r.type === "消費" && r.date === task.date
    && Math.round(Number(r.amount)) === -amount && String(r.reason ?? "").trim().startsWith(prefix));
  if (dup) return { status: "review", why: `座號${seat}今天已有一筆同額（${amount} 幣）的「${goal.name}」捐款，可能是重送，沒有入帳；確定要再捐一次請在 Claude Code 對話說` };

  const row = { student, amount: -amount, type: "消費", reason: prefix, date: task.date };
  return {
    status: "write", seat, amount, goal, week, year: academicYearValue(task.date), row, backersNeeded: ctx.backersNeeded,
    balance: balance - amount, after: tallyOf([...ctx.ledger, row]),
    props: {
      事由: { title: [{ text: { content: prefix } }] },
      日期: { date: { start: task.date } },
      週次: { rich_text: [{ text: { content: week } }] },
      學生: { relation: [{ id: student }] },
      類型: { select: { name: "消費" } },
      金額: { number: -amount },
      學年: { select: { name: academicYearValue(task.date) } },
    },
  };
}

/** 收件匣執行紀錄（≤100 字，只稱座號）。 */
export function execLog(plan) {
  if (plan.status !== "write") return plan.why;
  const a = plan.after, g = plan.goal;
  const prog = a.roundsDone > 0 && a.raised === 0 && a.backers === 0
    ? `🎉 已達成第 ${a.roundsDone} 次`
    : `本輪累計 ${a.raised}／${g.target} 幣、${a.backers}／${plan.backersNeeded ?? "?"} 人`;
  return `座號${plan.seat} 捐 ${plan.amount} 幣給〈${g.name}〉已入帳，餘額 ${plan.balance}；${prog}`.slice(0, 100);
}
