/**
 * f35｜R18 課堂事件包入庫（class-manager「收班送出」→ 📝 班經與學習紀錄庫）
 * ───────────────────────────────────────────────────────────────
 * 規格：ClassOS_v3.5_藍圖/SPEC_R18事件包入庫腳本.md；規則本體在 lib/cm-events.mjs（純函式＋sim 測試）。
 *
 * MODE（環境變數，預設 dry-run）：
 *   dry-run  讀「待處理」的 R18 任務，算出每件會寫幾筆，不寫任何東西
 *   execute  認領 → 寫紀錄庫 → 逐筆回讀 → 回填收件匣（切換前不得對正式庫用，§5 第 4 步才開）
 *   compare  對照期：讀最近 7 天 routine 已處理完的 R18 任務，逐欄比對程式應寫值與紀錄庫實際值；
 *            **只有差異時**在收件匣建／刷新一筆「待審：R18 對照差異」（明細在 Notion，不進 log）
 * SANDBOX=1：建一個一次性的 R18 沙盒，跑 execute（含重送同一包）＋compare，驗完整頁刪除。
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀：只印數字與任務短 id。
 *    不印座號、事件id（內含座號）、姓名、事件描述、備註（SPEC §6）。
 */
import { readFileSync } from "node:fs";
import { api, DS } from "./lib/notion.mjs";
import * as cm from "./lib/cm-events.mjs";
import { buildR18Sandbox, teardownSandbox } from "./lib/sandbox.mjs";
import { academicYearValue } from "./lib/academic-year.mjs";

const MODE = (process.env.MODE ?? "dry-run").trim();
const SANDBOX = process.env.SANDBOX === "1";
if (!["dry-run", "execute", "compare"].includes(MODE)) { console.error(`未知 MODE：${MODE}`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rt = (s) => (s ? [{ type: "text", text: { content: String(s).slice(0, 2000) } }] : []);
const titleOf = (p) => (p.properties?.任務原文?.title ?? []).map((t) => t.plain_text).join("");
// 任務短 id 取尾 8 碼：Notion id 開頭是時間序，同一分鐘建的任務前 8 碼會相同
const tid = (id) => String(id).replace(/-/g, "").slice(-8);
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

// ── Notion 呼叫：節流＋429／5xx 重試 3 次（SPEC §7；lib/notion.mjs 只有節流）──
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

// ── 讀取來源：班規、週次（repo checkout，與班網同一份）＋名冊（每次執行查一次）──
function loadRepoData() {
  const root = new URL("../../data/", import.meta.url);
  return {
    rules: JSON.parse(readFileSync(new URL("class-rules.json", root), "utf8")),
    weeks: JSON.parse(readFileSync(new URL("weeks.json", root), "utf8")),
  };
}
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

// 紀錄庫依日期快取（一包＝一天，一次撈回；compare 跨任務共用）
function logByDate(ds) {
  const cache = new Map();
  return async (date) => {
    if (!cache.has(date)) {
      const rows = await queryAll(ds, { filter: { property: "日期", date: { equals: date } } });
      const byId = new Map();
      for (const p of rows) {
        const v = cm.fromNotionPage(p);
        if (!v.事件id) continue;
        byId.set(v.事件id, [...(byId.get(v.事件id) ?? []), v]);
      }
      cache.set(date, byId);
    }
    return cache.get(date);
  };
}

// ───────────────────────── dry-run／execute ─────────────────────────
async function runPending({ ds, execute }) {
  const tasks = (await queryAll(ds.inbox, { filter: { property: "狀態", select: { equals: "待處理" } } }))
    .filter((p) => cm.isR18(titleOf(p)));
  const tot = { tasks: tasks.length, write: 0, skip: 0, fail: 0, fatal: 0, retry: 0 };
  if (!tasks.length) return tot;

  let data, roster, setupErr = null;
  try { data = loadRepoData(); roster = await loadRoster(ds.roster); } catch (e) { setupErr = e; }
  if (setupErr instanceof Transient) throw setupErr; // 名冊暫時讀不到＝下一輪再來，任務不動
  const logOf = logByDate(ds.log);
  const fill = (id, props) => must("PATCH", `/pages/${id}`, { properties: props });
  const done = (status, log, err) => ({
    任務類型: { select: { name: "記錄" } }, 路由ID: { rich_text: rt("R18") },
    狀態: { select: { name: status } }, 執行紀錄: { rich_text: rt(log) },
    錯誤訊息: { rich_text: rt(err) }, 完成時間: { date: { start: new Date().toISOString() } },
  });

  for (const t of tasks) {
    const tag = `任務 ${tid(t.id)}`;
    try {
      if (execute) await fill(t.id, { 狀態: { select: { name: "處理中" } } }); // 認領
      if (setupErr) {
        tot.fatal++;
        if (execute) await fill(t.id, done("失敗", "班規／週次／名冊讀取失敗，一筆都沒寫", `${setupErr.message}`));
        console.log(`${tag}：整件失敗（讀取來源）`);
        continue;
      }
      const p = cm.parsePacket(titleOf(t));
      if (!p.ok) {
        tot.fatal++;
        if (execute) await fill(t.id, done("失敗", "事件包格式不符，一筆都沒寫", "E06 事件包格式不符，請重送"));
        console.log(`${tag}：E06 整件失敗`);
        continue;
      }
      const existing = await logOf(p.body.date);
      const plan = cm.planPacket(titleOf(t), { ...data, roster, existingIds: new Set(existing.keys()) });
      const results = plan.results;

      if (execute) {
        for (const r of results) {
          if (r.action !== "write") continue;
          const w = await call("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds.log }, properties: cm.toNotionProps(r.row) });
          if (!w.ok) {
            if (w.status === 429 || w.status >= 500) throw new Transient(`寫入 HTTP ${w.status}`);
            Object.assign(r, { action: "fail", code: "寫入被拒", why: `HTTP ${w.status}` });
            continue;
          }
          // 逐筆回讀：事件id／學年／金幣影響（不符＝記失敗，不自動刪列，交老師判斷）
          const back = cm.fromNotionPage(await must("GET", `/pages/${w.json.id}`));
          const bad = ["事件id", "學年", "金幣影響"].filter((k) => back[k] !== r.row[k]);
          if (bad.length) Object.assign(r, { action: "fail", code: "回讀不符", why: `${bad.join("、")}（列已寫入，請人工確認）` });
          existing.set(r.row.事件id, [back]);
        }
        await fill(t.id, done(cm.taskStatus(results), cm.execLog(results), cm.failDetail(results)));
      }
      const c = (a) => results.filter((r) => r.action === a).length;
      tot.write += c("write"); tot.skip += c("skip"); tot.fail += c("fail");
      console.log(`${tag}：入庫 ${c("write")}／略過 ${c("skip")}／失敗 ${c("fail")}`);
    } catch (e) {
      if (!(e instanceof Transient)) {
        // 非暫時性錯誤：標失敗讓老師看得到，不留「處理中」殭屍，繼續下一件
        tot.fatal++;
        if (execute) await call("PATCH", `/pages/${t.id}`, { properties: done("失敗", "程式錯誤，需人工", e.message) });
        console.log(`${tag}：程式錯誤，已標失敗`);
        continue;
      }
      // Notion 暫時性錯誤：退回待處理留待下一輪，不標失敗（已寫的列下一輪會被防重複略過）
      tot.retry++;
      if (execute) await call("PATCH", `/pages/${t.id}`, { properties: { 狀態: { select: { name: "待處理" } } } });
      console.log(`${tag}：Notion 暫時性錯誤，退回待處理`);
    }
  }
  return tot;
}

// ───────────────────────── compare ─────────────────────────
// from／to（yyyy-mm-dd，依事件包日期）：指定區間回溯驗收，例如第 3 週；沒給＝最近 days 天
async function runCompare({ ds, notify, days = 7, from = "", to = "" }) {
  const since = from ? `${from}T00:00:00+08:00` : new Date(Date.now() - days * 864e5).toISOString();
  const tasks = (await queryAll(ds.inbox, {
    filter: { and: [
      { or: [{ property: "狀態", select: { equals: "已完成" } }, { property: "狀態", select: { equals: "失敗" } }] },
      { timestamp: "created_time", created_time: { on_or_after: since } },
    ] },
  })).filter((p) => cm.isR18(titleOf(p)))
    .sort((a, b) => a.created_time.localeCompare(b.created_time));

  const data = loadRepoData();
  const roster = await loadRoster(ds.roster);
  const logOf = logByDate(ds.log);
  const seen = new Set(); // 跨任務：同一 id 第二次出現（重送）＝略過
  const diffs = [];
  const groups = new Map(); // 差異樣態 → 座號清單
  const tot = { tasks: tasks.length, inRange: 0, events: 0, diff: 0, subjFilled: 0, matched: 0, failed: 0, skipped: 0 };

  for (const t of tasks) {
    const p = cm.parsePacket(titleOf(t));
    const status = t.properties?.狀態?.select?.name;
    if (!p.ok) {
      if (status !== "失敗") diffs.push(`任務 ${tid(t.id)}：程式判 E06，routine 狀態＝${status}`);
      continue;
    }
    if ((from && p.body.date < from) || (to && p.body.date > to)) continue;
    tot.inRange++;
    const actual = await logOf(p.body.date);
    for (const ev of p.body.events) {
      tot.events++;
      const r = cm.planEvent(ev, { ...data, roster, existingIds: seen });
      if (r.action === "skip") { tot.skipped++; continue; }
      seen.add(ev.id);
      const rows = actual.get(ev.id) ?? [];
      const who = `座號${ev.seat}（${ev.id}）`;
      if (rows.some((x) => x.科目)) tot.subjFilled++;
      if (r.action === "fail") {
        tot.failed++;
        if (rows.length) diffs.push(`${who}：程式判失敗 ${r.code} ${r.why}，但紀錄庫有 ${rows.length} 列`);
        continue;
      }
      if (!rows.length) { diffs.push(`${who}：應入庫但紀錄庫沒有`); continue; }
      if (rows.length > 1) diffs.push(`${who}：重複入庫 ${rows.length} 列`);
      const f = cm.diffRow(r.row, rows[0]);
      if (!f.length && rows.length === 1) tot.matched++;
      // 同一種差異歸成一組（執行紀錄 2000 字上限，逐筆列會被截斷）；學生不同另列兩邊頁面 id 供查
      for (const k of f) {
        const key = k === "學生" ? `學生對應不同頁（程式 ${String(r.row.學生).replace(/-/g, "").slice(-6)}／routine ${String(rows[0].學生).slice(-6)}）`
          : `${k}：程式「${r.row[k] ?? ""}」／routine「${rows[0][k] ?? ""}」`;
        groups.set(key, [...(groups.get(key) ?? []), ev.seat]);
      }
    }
  }
  for (const [k, seats] of groups) diffs.push(`×${seats.length} ${k}（座號${[...new Set(seats)].sort((x, y) => x - y).join("、")}）`);
  tot.diff = [...groups.values()].reduce((n, v) => n + v.length, 0) + diffs.length - groups.size;

  if (diffs.length && notify) {
    const title = from ? `待審：R18 對照差異（回溯 ${from}～${to || today()}）` : `待審：R18 對照差異（${today()}）`;
    const body = `【R18 並行對照】${from ? `事件日期 ${from}～${to || today()}` : `最近 ${days} 天`} ${tot.inRange} 件／${tot.events} 筆事件，差異 ${diffs.length} 項。\n`
      + `（參考）routine 有填「科目」的事件：${tot.subjFilled} 筆（規格未定義此欄，切換前要決定）\n\n`
      + diffs.join("\n")
      + `\n\n判讀：先查是程式錯還是 Sonnet 錯；Sonnet 錯的另開更正列（動錢照 U63）。規格 SPEC_R18事件包入庫腳本.md §5。`;
    const prev = (await queryAll(ds.inbox, { filter: { property: "狀態", select: { equals: "待審" } } }))
      .find((x) => titleOf(x) === title);
    const props = { 執行紀錄: { rich_text: rt(body) } };
    if (prev) await must("PATCH", `/pages/${prev.id}`, { properties: props });
    else await must("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds.inbox }, properties: {
      ...props, 任務原文: { title: rt(title) }, 狀態: { select: { name: "待審" } }, 路由ID: { rich_text: rt("R18對照") },
      學年: { select: { name: academicYearValue(new Date()) } },
    } });
  }
  return tot;
}

// ───────────────────────── 沙盒演練（§5 第 2 步）─────────────────────────
async function runSandbox() {
  const { rules } = loadRepoData();
  const act = (n, kind, i) => { const a = cm.findRuleAct(rules, n, kind, i); return { act: a.act, coin: a.coin, level: a.level }; };
  const date = "2026-09-08";
  const body = {
    tool: "board", date, batch: "20260908-b1", part: 1, parts: 1,
    events: [
      { id: "sb-1", seat: 1, src: "rule", rule_n: 5, kind: "good", act_i: 0, subj: "數學", period: "第2節", ...act(5, "good", 0) },
      { id: "sb-2", seat: 2, src: "rule", rule_n: 4, kind: "bad", act_i: 0, note: "國習 P12", ...act(4, "bad", 0) },
      { id: "sb-3", seat: 1, src: "tally", kind: "good", act: "小組加分", subj: "數學", note: "第一組", count: 3 },
      { id: "sb-4", seat: 2, src: "tally", kind: "neutral", act: "打掃缺席", note: "請假" },
      { id: "sb-5", seat: 3, src: "tally", kind: "good", act: "打掃支援" },                               // 非在學 → E01
      { id: "sb-6", seat: 1, src: "rule", rule_n: 4, kind: "bad", act_i: 0, act: "x", coin: "−99", level: -1 }, // 幣值不符 → E07
    ],
  };
  const text = `#CM-EVENTS v1 · 🧪 沙盒演練 · 6 筆\n${JSON.stringify(body)}`;

  console.log("🧪 建立 R18 沙盒…");
  const sb = await buildR18Sandbox();
  const ds = { roster: sb.ds.roster, inbox: sb.ds.inbox, log: sb.ds.log };
  const checks = [];
  const ok = (name, got, want) => checks.push([name, got, want]);
  try {
    const newTask = (t) => must("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds.inbox },
      properties: { 任務原文: { title: rt(t) }, 狀態: { select: { name: "待處理" } } } });
    const a = await newTask(text);
    const r1 = await runPending({ ds, execute: true });
    ok("第一次：入庫", r1.write, 4); ok("第一次：失敗（E01＋E07）", r1.fail, 2); ok("第一次：略過", r1.skip, 0);

    const b = await newTask(text);         // 重送同一包
    const bad = await newTask("#CM-EVENTS v1 · 壞掉\n{events:[");
    const r2 = await runPending({ ds, execute: true });
    ok("重送：入庫", r2.write, 0); ok("重送：略過", r2.skip, 4); ok("E06 整件失敗", r2.fatal, 1);

    const rows = await queryAll(ds.log);
    ok("紀錄庫總列數", rows.length, 4);
    const byId = Object.fromEntries(rows.map((p) => [cm.fromNotionPage(p).事件id, cm.fromNotionPage(p)]));
    ok("rule good：金幣 +10", byId["sb-1"]?.金幣影響, Number(String(act(5, "good", 0).coin).replace("+", "")));
    ok("rule good：類別人際互動", byId["sb-1"]?.類別, "人際互動");
    ok("rule good：事件描述補科目", byId["sb-1"]?.事件描述, `${act(5, "good", 0).act}（數學）`);
    ok("rule bad：U+2212 轉成 -5", byId["sb-2"]?.金幣影響, -5);
    ok("rule bad：程度 1", byId["sb-2"]?.程度, 1);
    ok("rule bad：週次", byId["sb-2"]?.週次, "四上第2週(9/7-9/11)");
    ok("rule bad：學年", byId["sb-2"]?.學年, "115");
    ok("tally：金幣 0", byId["sb-3"]?.金幣影響, 0);
    ok("tally：程度空白", byId["sb-3"]?.程度, null);
    ok("tally：次數 3", byId["sb-3"]?.次數, 3);
    ok("tally：事件描述", byId["sb-3"]?.事件描述, "在數學課小組加分");
    ok("neutral：中性＋備註", `${byId["sb-4"]?.正負向}/${byId["sb-4"]?.備註}`, "中性/請假");

    const st = async (id) => (await must("GET", `/pages/${id}`)).properties;
    const pa = await st(a.id), pb = await st(b.id), pc = await st(bad.id);
    const log = (p) => (p.執行紀錄?.rich_text ?? []).map((x) => x.plain_text).join("");
    ok("任務 A 狀態", pa.狀態?.select?.name, "已完成");
    ok("任務 A 執行紀錄", log(pa), "已入庫 4 筆／略過 0 筆（已入庫）／失敗 2 筆：座號1、3");
    ok("任務 A 路由ID", (pa.路由ID?.rich_text ?? []).map((x) => x.plain_text).join(""), "R18");
    ok("任務 B 執行紀錄", log(pb), "已入庫 0 筆／略過 4 筆（已入庫）／失敗 2 筆：座號1、3");
    ok("E06 任務狀態", pc.狀態?.select?.name, "失敗");

    const c = await runCompare({ ds, notify: false });
    ok("compare：程式對自己寫的列 0 差異", c.diff, 0);
  } finally {
    const d = await teardownSandbox(sb.pageId);
    console.log(`🧹 沙盒整頁刪除 HTTP ${d.status}`);
  }
  let fail = 0;
  for (const [name, got, want] of checks) {
    if (got !== want) { fail++; console.log(`FAIL ${name}：得到 ${JSON.stringify(got)}，應為 ${JSON.stringify(want)}`); }
  }
  console.log(`沙盒驗收 ${checks.length} 項／失敗 ${fail} 項`);
  return fail;
}

// ───────────────────────── 進入點 ─────────────────────────
const PROD = { roster: DS.roster, inbox: DS.inbox, log: DS.log };
console.log(`f35｜模式 ${MODE}${SANDBOX ? "（沙盒）" : ""}｜${today()}`);

if (SANDBOX) {
  process.exitCode = (await runSandbox()) ? 1 : 0;
} else if (MODE === "compare") {
  const t = await runCompare({ ds: PROD, notify: true, from: (process.env.FROM ?? "").trim(), to: (process.env.TO ?? "").trim() });
  console.log(`對照：任務 ${t.inRange} 件／事件 ${t.events} 筆（逐欄相符 ${t.matched}／程式判失敗 ${t.failed}／重送略過 ${t.skipped}；routine 有填科目 ${t.subjFilled}）／差異 ${t.diff} 項${t.diff ? "（明細已寫入收件匣待審）" : ""}`);
} else {
  const t = await runPending({ ds: PROD, execute: MODE === "execute" });
  console.log(`任務 ${t.tasks} 件／入庫 ${t.write} 筆／略過 ${t.skip} 筆／失敗 ${t.fail} 筆／整件失敗 ${t.fatal} 件／退回重試 ${t.retry} 件${MODE === "dry-run" ? "（dry-run，未寫入）" : ""}`);
}
