/**
 * f47｜R19 集資捐款入帳（教師專區一句話任務「座號25 捐 50 幣」→ 🏦 班級銀行帳本一筆消費）
 * ───────────────────────────────────────────────────────────────
 * 2026-10-12 老師裁定：集資捐款由一句話任務直接入帳。規則本體在 lib/r19-donations.mjs（純函式＋sim 測試），
 * 輪數累計與班網進度條共用 scripts/lib/class-goal.mjs。規格：ClassOS_v3.5_藍圖/SPEC_班級經濟機制.md §2-6。
 *
 * MODE（環境變數，預設 dry-run）：
 *   dry-run  讀「待處理」的捐款任務，算出每件會怎麼處理，不寫任何東西
 *   execute  認領 → 建帳本列 → 回讀 → 回填收件匣（判不出、餘額不足＝失敗；疑似重送、假期＝待審；都不寫帳）
 * SANDBOX=1：建一次性沙盒跑 execute（含餘額不足、非在學、未開放、重送），驗完整頁刪除。
 * TASK_STATUS：只給 dry-run 用，改撈別的狀態（例：`失敗`）來演練既有任務；execute 一律只撈「待處理」。
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀：只印數字與任務短 id，不印座號、金額、餘額。
 */
import { readFileSync, appendFileSync } from "node:fs";
import { api, DS } from "./lib/notion.mjs";
import * as r19 from "./lib/r19-donations.mjs";
import { GOAL_TIER, backersNeededOf, inWindow } from "../lib/class-goal.mjs";
import { buildR19Sandbox, teardownSandbox } from "./lib/sandbox.mjs";

const MODE = (process.env.MODE ?? "dry-run").trim();
const SANDBOX = process.env.SANDBOX === "1";
if (!["dry-run", "execute"].includes(MODE)) { console.error(`未知 MODE：${MODE}`); process.exit(1); }
const TASK_STATUS = MODE === "dry-run" && !SANDBOX ? (process.env.TASK_STATUS || "待處理").trim() : "待處理";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rt = (s) => (s ? [{ type: "text", text: { content: String(s).slice(0, 2000) } }] : []);
const plain = (arr) => (arr ?? []).map((t) => t.plain_text).join("");
const titleOf = (p) => plain(p.properties?.任務原文?.title);
const tid = (id) => String(id).replace(/-/g, "").slice(-8);
const taipeiDate = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

// ── Notion 呼叫：節流＋429／5xx 重試 3 次（同 f35／f37）──
class Transient extends Error {}
async function call(method, path, body) {
  let r;
  for (let i = 0; i <= 3; i++) {
    r = await api(method, path, body);
    await sleep(350);
    if (r.ok || (r.status !== 429 && r.status < 500)) return r;
    if (i < 3) await sleep(1000 * 2 ** i);
  }
  return r;
}
async function must(method, path, body) {
  const r = await call(method, path, body);
  if (r.ok) return r.json;
  const E = r.status === 429 || r.status >= 500 ? Transient : Error;
  throw new E(`Notion ${method} → HTTP ${r.status} ${r.json?.code ?? ""}`);
}
async function queryAll(ds, body = {}) {
  const out = [];
  let cursor;
  do {
    const j = await must("POST", `/data_sources/${ds}/query`, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

const loadWeeks = () => JSON.parse(readFileSync(new URL("../../data/weeks.json", import.meta.url), "utf8"));
async function loadRoster(ds) {
  const map = new Map();
  for (const p of await queryAll(ds, { filter: { property: "在學", checkbox: { equals: true } } })) {
    const seat = p.properties?.座號?.number;
    if (seat == null) continue;
    if (map.has(seat)) throw new Error("名冊有重複座號（在學），需人工");
    map.set(seat, p.id);
  }
  if (!map.size) throw new Error("名冊讀不到任何在學學生");
  return map;
}
/** 商店 ⑥ 層且上架的列 → [{ name, target, limit, open }]（與 sync-notion.mjs syncClassGoal 同一組欄位與判定） */
async function loadGoals(ds, today) {
  return (await queryAll(ds, { filter: { property: "上架", checkbox: { equals: true } } }))
    .filter((p) => String(p.properties?.層級?.select?.name ?? "").trim() === GOAL_TIER)
    .map((p) => {
      const w = p.properties?.開放期間?.date;
      return {
        name: plain(p.properties?.品項?.title).trim(),
        target: Math.round(Number(p.properties?.價格?.number) || 0),
        limit: Math.max(1, Math.round(Number(p.properties?.庫存?.number) || 1)),
        open: inWindow((w?.start || "").slice(0, 10), (w?.end || "").slice(0, 10), today),
      };
    })
    .filter((g) => g.name);
}
/** 帳本全部帳列 → [{ student, amount, type, reason, date }]（沒有學生或金額的列不算） */
async function loadLedger(ds) {
  return (await queryAll(ds)).map((p) => ({
    student: p.properties?.學生?.relation?.[0]?.id ?? "",
    amount: p.properties?.金額?.number,
    type: p.properties?.類型?.select?.name ?? "",
    reason: plain(p.properties?.事由?.title),
    date: (p.properties?.日期?.date?.start ?? "").slice(0, 10),
  })).filter((r) => r.student && r.amount != null);
}

// ───────────────────────── dry-run／execute ─────────────────────────
async function runPending({ ds, execute }) {
  const tasks = (await queryAll(ds.inbox, { filter: { property: "狀態", select: { equals: TASK_STATUS } } }))
    .filter((p) => r19.isDonation(titleOf(p), (p.properties?.附件?.files ?? []).length))
    .sort((a, b) => String(a.created_time).localeCompare(String(b.created_time)));
  const tot = { tasks: tasks.length, rows: 0, review: 0, fail: 0, retry: 0 };
  if (!tasks.length) return tot;

  const today = taipeiDate(new Date().toISOString());
  let ctx, setupErr = null;
  try {
    const roster = await loadRoster(ds.roster);
    ctx = { roster, weeks: loadWeeks(), backersNeeded: backersNeededOf(roster.size),
      goals: await loadGoals(ds.store, today), ledger: await loadLedger(ds.bank) };
  } catch (e) { setupErr = e; }
  if (setupErr instanceof Transient) throw setupErr; // 暫時讀不到＝下一輪再來，任務不動
  const fill = (id, props) => must("PATCH", `/pages/${id}`, { properties: props });
  const done = (status, log, err, link) => ({
    任務類型: { select: { name: "記帳" } }, 路由ID: { rich_text: rt("R19") },
    狀態: { select: { name: status } }, 執行紀錄: { rich_text: rt(log) }, 錯誤訊息: { rich_text: rt(err) },
    ...(link ? { 產出連結: { url: link } } : {}),
    ...(status === "已完成" ? { 完成時間: { date: { start: new Date().toISOString() } } } : {}),
  });

  for (const t of tasks) {
    const tag = `任務 ${tid(t.id)}`;
    let wrote = false;
    try {
      if (execute) await fill(t.id, { 狀態: { select: { name: "處理中" } } }); // 認領
      if (setupErr) {
        tot.fail++;
        if (execute) await fill(t.id, done("失敗", "名冊／商店／帳本讀取失敗，沒有入帳", setupErr.message));
        console.log(`${tag}：整件失敗（讀取來源）`);
        continue;
      }
      const plan = r19.planTask({ text: titleOf(t), date: taipeiDate(t.created_time) }, ctx);
      if (plan.status === "fail") {
        tot.fail++;
        if (execute) await fill(t.id, done("失敗", "沒有入帳", `${plan.code} ${plan.why}`));
        console.log(`${tag}：${plan.code} 失敗（未入帳）`);
        continue;
      }
      if (plan.status === "review") {
        tot.review++;
        if (execute) await fill(t.id, done("待審", plan.why.slice(0, 100), ""));
        console.log(`${tag}：待審（未入帳）`);
        continue;
      }
      tot.rows++;
      if (!execute) { ctx.ledger.push(plan.row); console.log(`${tag}：將入帳 1 筆`); continue; }

      const w = await must("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds.bank }, properties: plan.props });
      wrote = true;
      ctx.ledger.push(plan.row); // 同一輪後面的任務要看得到這一筆（餘額、重送、達成次數）
      const b = (await must("GET", `/pages/${w.id}`)).properties;
      const ok = b.金額?.number === -plan.amount && b.類型?.select?.name === "消費" && b.學年?.select?.name === plan.year
        && plain(b.事由?.title) === plan.props.事由.title[0].text.content && plain(b.週次?.rich_text) === plan.week
        && b.日期?.date?.start === plan.props.日期.date.start
        && (b.學生?.relation ?? []).length === 1 && b.學生.relation[0].id === plan.props.學生.relation[0].id;
      if (ok) await fill(t.id, done("已完成", r19.execLog(plan), "", w.url));
      else { tot.fail++; await fill(t.id, done("失敗", r19.execLog(plan), "回讀不符（帳列已寫入，請人工確認）", w.url)); }
      console.log(`${tag}：已入帳 1 筆${ok ? "" : "／回讀不符"}`);
    } catch (e) {
      // 帳已寫入之後才出錯：不可退回待處理（下一輪會被「同日同額」擋成待審，但狀態要說清楚）
      if (wrote || !(e instanceof Transient)) {
        tot.fail++;
        if (execute) await call("PATCH", `/pages/${t.id}`, { properties: done("失敗",
          wrote ? "帳列已寫入，但後續回讀或回填失敗，請人工確認帳本" : "程式錯誤，沒有入帳，需人工", e.message) });
        console.log(`${tag}：程式錯誤，已標失敗${wrote ? "（帳列已寫入）" : ""}`);
        continue;
      }
      tot.retry++;
      if (execute) await call("PATCH", `/pages/${t.id}`, { properties: { 狀態: { select: { name: "待處理" } } } });
      console.log(`${tag}：Notion 暫時性錯誤，退回待處理`);
    }
  }
  return tot;
}

// ───────────────────────── 沙盒演練 ─────────────────────────
async function runSandbox() {
  console.log("🧪 建立 R19 沙盒…");
  const sb = await buildR19Sandbox();
  const ds = sb.ds;
  const checks = [];
  const ok = (name, got, want) => checks.push([name, got, want]);
  const newTask = (text, files) => must("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds.inbox },
    properties: { 任務原文: { title: rt(text) }, 狀態: { select: { name: "待處理" } }, ...(files ? { 附件: { files } } : {}) } });
  try {
    const A = await newTask("19捐50幣");                              // 沒寫目標、只有一個開放 → 入帳
    const B = await newTask("座號23 捐 50 幣給沙盒目標甲");           // 餘額 10 → 失敗
    const C = await newTask("座號7 捐 5 幣");                         // 非在學 → 失敗
    const D = await newTask("19 捐 10 幣給沙盒目標乙");               // 未到開放期間 → 失敗
    const E = await newTask("座號19 數學小考 +1");                    // 不是捐款：不可動
    const r1 = await runPending({ ds, execute: true });
    ok("第一輪：捐款任務數", r1.tasks, 4);
    ok("第一輪：入帳", r1.rows, 1);
    ok("第一輪：失敗", r1.fail, 3);

    const A2 = await newTask("19捐50幣");                             // 重送：同日同額 → 待審，不重扣
    const G = await newTask("座號19 捐 60 幣");                       // 入帳後餘額只剩 50 → 失敗
    const F = await newTask("座號23 捐 10 幣");                       // 餘額剛好 → 入帳
    // ⚠️ 同一輪的任務彼此不可互相影響結果：Notion 建立時間只到分鐘，同分鐘的處理順序不保證。
    const r2 = await runPending({ ds, execute: true });
    ok("第二輪：入帳", r2.rows, 1);
    ok("第二輪：待審（重送）", r2.review, 1);
    ok("第二輪：失敗（餘額已被第一輪扣過）", r2.fail, 1);

    const rows = (await queryAll(ds.bank)).map((p) => ({
      reason: plain(p.properties.事由?.title), amount: p.properties.金額?.number, type: p.properties.類型?.select?.name,
      year: p.properties.學年?.select?.name, rel: (p.properties.學生?.relation ?? []).length, week: plain(p.properties.週次?.rich_text),
    }));
    const gifts = rows.filter((r) => r.type === "消費").sort((a, b) => a.amount - b.amount);
    ok("帳本總列數（2 筆種子＋2 筆捐款）", rows.length, 4);
    ok("捐款列金額", gifts.map((r) => r.amount), [-50, -10]);
    ok("捐款列事由", [...new Set(gifts.map((r) => r.reason))], ["集資-沙盒目標甲"]);
    ok("捐款列學年", [...new Set(gifts.map((r) => r.year))], [r19AcademicYear()]);
    ok("捐款列學生 relation", gifts.map((r) => r.rel), [1, 1]);
    ok("捐款列週次有值", gifts.every((r) => r.week), true);

    const st = async (id) => (await must("GET", `/pages/${id}`)).properties;
    const [pa, pb, pc, pd, pe, pf, pa2, pg] = await Promise.all([A, B, C, D, E, F, A2, G].map((x) => st(x.id)));
    ok("A 狀態", pa.狀態?.select?.name, "已完成");
    ok("A 路由ID", plain(pa.路由ID?.rich_text), "R19");
    ok("A 產出連結有值", Boolean(pa.產出連結?.url), true);
    ok("A 執行紀錄", plain(pa.執行紀錄?.rich_text), "座號19 捐 50 幣給〈沙盒目標甲〉已入帳，餘額 50；本輪累計 50／500 幣、1／1 人");
    ok("B 餘額不足 → 失敗", [pb.狀態?.select?.name, plain(pb.錯誤訊息?.rich_text)], ["失敗", "E74 座號23餘額不足（現有 10 幣，需 50 幣），沒有入帳"]);
    ok("C 非在學 → 失敗", [pc.狀態?.select?.name, plain(pc.錯誤訊息?.rich_text)], ["失敗", "E01 座號7不在名冊或已不在學"]);
    ok("D 未開放 → 失敗", [pd.狀態?.select?.name, plain(pd.錯誤訊息?.rich_text).slice(0, 3)], ["失敗", "E72"]);
    ok("E 非捐款沒被動", pe.狀態?.select?.name, "待處理");
    ok("F 餘額剛好 → 已完成", pf.狀態?.select?.name, "已完成");
    ok("A2 重送 → 待審", pa2.狀態?.select?.name, "待審");
    ok("G 第二輪餘額不足", [pg.狀態?.select?.name, plain(pg.錯誤訊息?.rich_text)], ["失敗", "E74 座號19餘額不足（現有 50 幣，需 60 幣），沒有入帳"]);
  } finally {
    const d = await teardownSandbox(sb.pageId);
    console.log(`🧹 沙盒整頁刪除 HTTP ${d.status}`);
  }
  let fail = 0;
  for (const [name, got, want] of checks) {
    if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log(`FAIL ${name}：得到 ${JSON.stringify(got)}，應為 ${JSON.stringify(want)}`); }
  }
  console.log(`沙盒驗收 ${checks.length} 項／失敗 ${fail} 項`);
  return fail;
}
function r19AcademicYear() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return String(d.getUTCFullYear() - 1911 - (d.getUTCMonth() + 1 < 8 ? 1 : 0));
}

// ───────────────────────── 進入點 ─────────────────────────
const PROD = { roster: DS.roster, inbox: DS.inbox, bank: DS.bank, store: DS.store };
console.log(`f47｜模式 ${MODE}${SANDBOX ? "（沙盒）" : ""}${TASK_STATUS !== "待處理" ? `｜撈「${TASK_STATUS}」` : ""}｜${taipeiDate(new Date().toISOString())}`);

if (SANDBOX) {
  process.exitCode = (await runSandbox()) ? 1 : 0;
} else {
  const t = await runPending({ ds: PROD, execute: MODE === "execute" });
  console.log(`捐款任務 ${t.tasks} 件／入帳 ${t.rows} 筆／待審 ${t.review} 件／失敗 ${t.fail} 件／退回重試 ${t.retry} 件${MODE === "dry-run" ? "（dry-run，未寫入）" : ""}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `wrote=${MODE === "execute" ? t.rows : 0}\n`);
}
