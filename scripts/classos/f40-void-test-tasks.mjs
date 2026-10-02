/**
 * f40｜10/02 深夜試跑的 5 個收件匣任務標【待刪】（一次性，2026-10-03）
 * ───────────────────────────────────────────────────────────────
 * 背景：老師 10/02 23:55 試跑作業科目，送出 5 包（R18 run 37030407562，任務短碼見下）。
 *   33 筆中 27 筆與 10/02 13:09 正式入庫的事件 id 相同 → 被去重、沒新增任何東西，**那 27 筆是真實紀錄，保留**；
 *   新增的 3 列已由 f39 作廢。老師 2026-10-03 裁定（選 A）：只清測試痕跡＝這 5 個任務單＋f39 那 3 列。
 * 做法（RULE_Notion操作限制 §1：DB 列不搬，標題加【待刪】，老師手動刪）：任務原文前加「【待刪】」。
 *   狀態本來就是「已完成」，R18 只撈「待處理」，不會被重跑。必須正好找到 5 個且都是已完成，否則一筆都不寫。
 *
 * MODE=dry-run（預設）／execute。⚠️ PUBLIC repo：只印任務短碼。
 */
import { queryAll, api, isExecute, DS } from "./lib/notion.mjs";

const EXECUTE = isExecute();
const SHORT = ["631bc87a", "745c1195", "48b25cf8", "75dc97d5", "98a38b82"];
const PREFIX = "【待刪】";
const sid = (id) => id.replace(/-/g, "").slice(0, 8);
const title = (p) => (p.properties?.任務原文?.title ?? []).map((t) => t.plain_text).join("");
const status = (p) => p.properties?.狀態?.select?.name ?? "";

console.log(`f40｜模式 ${EXECUTE ? "⚠️ EXECUTE" : "🔍 DRY-RUN"}`);
const tasks = (await queryAll(DS.inbox, { filter: { timestamp: "created_time", created_time: { on_or_after: "2026-10-02T15:50:00Z" } } }))
  .filter((p) => SHORT.includes(sid(p.id)));
for (const p of tasks) console.log(`任務 ${sid(p.id)}：狀態 ${status(p)}｜${title(p).startsWith(PREFIX) ? "已帶【待刪】" : "#CM-EVENTS " + (title(p).includes("#CM-EVENTS") ? "✓" : "✗")}`);
if (tasks.length !== SHORT.length || tasks.some((p) => status(p) !== "已完成" || !title(p).includes("#CM-EVENTS") || title(p).startsWith(PREFIX))) {
  console.log(`❌ 找到 ${tasks.length}／${SHORT.length} 個或狀態不符——一筆都不寫，請人工確認`); process.exit(1);
}
if (!EXECUTE) { console.log("🔍 DRY-RUN：條件吻合，未寫入。"); process.exit(0); }

let ok = 0;
for (const p of tasks) {
  const t = title(p);
  const w = await api("PATCH", `/pages/${p.id}`, { properties: { 任務原文: { title: [{ type: "text", text: { content: PREFIX + t } }] } } });
  const back = w.ok ? (await api("GET", `/pages/${p.id}`)).json : null;   // 回讀：整段原文要原封保留
  const good = back && title(back) === PREFIX + t;
  console.log(`${good ? "✅" : "❌"} 任務 ${sid(p.id)}${good ? "（回讀相符）" : `（HTTP ${w.status}）`}`);
  if (good) ok++;
}
console.log(`完成 ${ok}／${tasks.length} 個`);
process.exitCode = ok === tasks.length ? 0 : 1;
