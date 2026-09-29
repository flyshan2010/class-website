/**
 * f37｜R13 作品入庫（教師專區「座號N 作品 ○○」＋照片 → 🎨 學生作品集）
 * ───────────────────────────────────────────────────────────────
 * 規格：ClassOS_v3.5_藍圖/SPEC_R13作品入庫腳本.md；規則本體在 lib/r13-works.mjs（純函式＋sim 測試）。
 *
 * MODE（環境變數，預設 dry-run）：
 *   dry-run  讀「待處理」的 R13 任務，算出每件會建幾列、照片怎麼分，不寫任何東西
 *   execute  認領 → 建作品集列 → 逐列回讀 → 回填收件匣（照片對不到＝待審，一列都不寫）
 * SANDBOX=1：建一次性的 R13 沙盒，跑 execute（含重送、舊版附件名、非在學），驗完整頁刪除。
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀：只印數字與任務短 id，不印座號、作品名、檔名、網址。
 */
import { readFileSync } from "node:fs";
import { api, DS } from "./lib/notion.mjs";
import * as r13 from "./lib/r13-works.mjs";
import { buildR13Sandbox, teardownSandbox } from "./lib/sandbox.mjs";

const MODE = (process.env.MODE ?? "dry-run").trim();
const SANDBOX = process.env.SANDBOX === "1";
if (!["dry-run", "execute"].includes(MODE)) { console.error(`未知 MODE：${MODE}`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rt = (s) => (s ? [{ type: "text", text: { content: String(s).slice(0, 2000) } }] : []);
const plain = (arr) => (arr ?? []).map((t) => t.plain_text).join("");
const titleOf = (p) => plain(p.properties?.任務原文?.title);
const tid = (id) => String(id).replace(/-/g, "").slice(-8);
const taipeiDate = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

// ── Notion 呼叫：節流＋429／5xx 重試 3 次（同 f35）──
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
/** 收件匣「附件」→ [{ name, url, external }]（Notion 直接上傳的檔 external=false，程式不搬） */
const filesOf = (p) => (p.properties?.附件?.files ?? []).map((f) => ({
  name: f.name ?? "", url: f.external?.url ?? f.file?.url ?? "", external: f.type === "external",
}));
/** 作品集該日已有的列 → Set<"座號|作品|日期">（防重複鍵，重送不重建） */
async function existingKeys(ds, date) {
  const rows = await queryAll(ds, { filter: { property: "日期", date: { equals: date } } });
  return new Set(rows.map((p) => `${p.properties?.座號?.number}|${plain(p.properties?.作品?.title)}|${date}`));
}

// ───────────────────────── dry-run／execute ─────────────────────────
async function runPending({ ds, execute }) {
  const tasks = (await queryAll(ds.inbox, { filter: { property: "狀態", select: { equals: "待處理" } } }))
    .filter((p) => r13.isR13(titleOf(p), filesOf(p).length));
  const tot = { tasks: tasks.length, rows: 0, skip: 0, review: 0, fail: 0, retry: 0 };
  if (!tasks.length) return tot;

  let weeks, roster, setupErr = null;
  try { weeks = loadWeeks(); roster = await loadRoster(ds.roster); } catch (e) { setupErr = e; }
  if (setupErr instanceof Transient) throw setupErr; // 名冊暫時讀不到＝下一輪再來，任務不動
  const fill = (id, props) => must("PATCH", `/pages/${id}`, { properties: props });
  const done = (status, log, err, link) => ({
    任務類型: { select: { name: "作品" } }, 路由ID: { rich_text: rt("R13") },
    狀態: { select: { name: status } }, 執行紀錄: { rich_text: rt(log) }, 錯誤訊息: { rich_text: rt(err) },
    ...(link ? { 產出連結: { url: link } } : {}),
    ...(status === "已完成" ? { 完成時間: { date: { start: new Date().toISOString() } } } : {}),
  });

  for (const t of tasks) {
    const tag = `任務 ${tid(t.id)}`;
    try {
      if (execute) await fill(t.id, { 狀態: { select: { name: "處理中" } } }); // 認領
      if (setupErr) {
        tot.fail++;
        if (execute) await fill(t.id, done("失敗", "週次／名冊讀取失敗，一列都沒寫", setupErr.message));
        console.log(`${tag}：整件失敗（讀取來源）`);
        continue;
      }
      const date = taipeiDate(t.created_time);
      const plan = r13.planTask({ text: titleOf(t), files: filesOf(t), date },
        { roster, weeks, existing: await existingKeys(ds.portfolio, date) });

      if (plan.status === "fail") {
        tot.fail++;
        if (execute) await fill(t.id, done("失敗", "一列都沒寫", `${plan.code} ${plan.why}`));
        console.log(`${tag}：${plan.code} 失敗`);
        continue;
      }
      if (plan.status === "review") {
        tot.review++;
        if (execute) await fill(t.id, done("待審", `一列都沒寫：${plan.why}`.slice(0, 100), ""));
        console.log(`${tag}：照片對應不確定 → 待審`);
        continue;
      }

      let first = "", bad = [];
      if (execute) {
        for (const r of plan.rows) {
          if (r.action !== "write") continue;
          const w = await must("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds.portfolio }, properties: r.props });
          if (!first) first = w.url;
          // 逐列回讀：座號／學年／照片張數／學生 relation
          const b = (await must("GET", `/pages/${w.id}`)).properties;
          const ok = b.座號?.number === r.seat && b.學年?.select?.name === plan.year
            && (b.照片?.files ?? []).length === r.photos && (b.學生?.relation ?? []).length === 1;
          if (!ok) bad.push(r.seat);
        }
        if (bad.length) await fill(t.id, done("失敗", r13.execLog(plan), `回讀不符：座號${bad.join("、")}（列已寫入，請人工確認）`, first));
        else await fill(t.id, done("已完成", r13.execLog(plan), "", first));
      }
      const w = plan.rows.filter((r) => r.action === "write").length;
      const s = plan.rows.length - w;
      tot.rows += w; tot.skip += s; if (bad.length) tot.fail++;
      console.log(`${tag}：建 ${w} 列／略過 ${s} 列（已入庫）${bad.length ? `／回讀不符 ${bad.length} 列` : ""}`);
    } catch (e) {
      if (!(e instanceof Transient)) {
        tot.fail++;
        if (execute) await call("PATCH", `/pages/${t.id}`, { properties: done("失敗", "程式錯誤，需人工", e.message) });
        console.log(`${tag}：程式錯誤，已標失敗`);
        continue;
      }
      // Notion 暫時性錯誤：退回待處理留待下一輪（已建的列下一輪會被防重複鍵略過）
      tot.retry++;
      if (execute) await call("PATCH", `/pages/${t.id}`, { properties: { 狀態: { select: { name: "待處理" } } } });
      console.log(`${tag}：Notion 暫時性錯誤，退回待處理`);
    }
  }
  return tot;
}

// ───────────────────────── 沙盒演練 ─────────────────────────
async function runSandbox() {
  console.log("🧪 建立 R13 沙盒…");
  const sb = await buildR13Sandbox();
  const ds = sb.ds;
  const checks = [];
  const ok = (name, got, want) => checks.push([name, got, want]);
  const file = (name) => ({ name, type: "external", external: { url: `https://example.com/sandbox/${encodeURIComponent(name)}` } });
  const newTask = (text, files) => must("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds.inbox },
    properties: { 任務原文: { title: rt(text) }, 狀態: { select: { name: "待處理" } }, ...(files ? { 附件: { files } } : {}) } });
  try {
    const A = await newTask("19 23 教師節繪畫比賽作品", [file("20260929-140437_23教師節繪畫比賽.jpg"), file("20260929-140428_19教師節繪畫比賽.jpg")]);
    const B = await newTask("座號19和23的合作海報", [file("20260929-150000_合照.jpg")]);
    const C = await newTask("19 23 書法作品", [file("附件1"), file("附件2")]);
    const D = await newTask("座號7 作品 水彩", [file("20260929-150100_7水彩.jpg")]);
    const E = await newTask("座號19 數學小考 +1");                     // 沒附件：不是 R13，不可動
    const r1 = await runPending({ ds, execute: true });
    ok("第一輪：R13 任務數", r1.tasks, 4);
    ok("第一輪：建列", r1.rows, 4);
    ok("第一輪：待審", r1.review, 1);
    ok("第一輪：失敗（非在學）", r1.fail, 1);

    const A2 = await newTask("19 23 教師節繪畫比賽作品", [file("20260929-160000_19教師節繪畫比賽.jpg"), file("20260929-160001_23教師節繪畫比賽.jpg")]);
    const r2 = await runPending({ ds, execute: true });
    ok("重送：建列", r2.rows, 0);
    ok("重送：略過", r2.skip, 2);

    const rows = (await queryAll(ds.portfolio)).map((p) => ({
      seat: p.properties.座號?.number, name: plain(p.properties.作品?.title), type: p.properties.類型?.select?.name,
      photos: (p.properties.照片?.files ?? []).map((f) => f.name), pub: p.properties.發布?.checkbox,
      year: p.properties.學年?.select?.name, rel: (p.properties.學生?.relation ?? []).length,
    }));
    ok("作品集總列數", rows.length, 4);
    const pick = (seat, name) => rows.find((r) => r.seat === seat && r.name === name) ?? {};
    ok("A 座號19 照片＝自己那張", pick(19, "教師節繪畫比賽作品").photos, ["20260929-140428_19教師節繪畫比賽.jpg"]);
    ok("A 座號23 照片＝自己那張", pick(23, "教師節繪畫比賽作品").photos, ["20260929-140437_23教師節繪畫比賽.jpg"]);
    ok("A 類型美勞", pick(19, "教師節繪畫比賽作品").type, "美勞");
    ok("A 發布勾", pick(19, "教師節繪畫比賽作品").pub, true);
    ok("A 學年", pick(23, "教師節繪畫比賽作品").year, "115");
    ok("A 學生 relation", pick(23, "教師節繪畫比賽作品").rel, 1);
    ok("B 合作作品兩人共用一張", [pick(19, "合作海報").photos, pick(23, "合作海報").photos],
      [["20260929-150000_合照.jpg"], ["20260929-150000_合照.jpg"]]);

    const st = async (id) => (await must("GET", `/pages/${id}`)).properties;
    const [pa, pb, pc, pd, pe, pa2] = await Promise.all([A, B, C, D, E, A2].map((x) => st(x.id)));
    ok("A 狀態", pa.狀態?.select?.name, "已完成");
    ok("A 路由ID", plain(pa.路由ID?.rich_text), "R13");
    ok("A 產出連結有值", Boolean(pa.產出連結?.url), true);
    ok("B 狀態", pb.狀態?.select?.name, "已完成");
    ok("C 舊版附件名 → 待審", pc.狀態?.select?.name, "待審");
    ok("D 非在學 → 失敗", pd.狀態?.select?.name, "失敗");
    ok("D 錯誤訊息", plain(pd.錯誤訊息?.rich_text), "E01 座號7不在名冊或已不在學");
    ok("E 非 R13 沒被動", pe.狀態?.select?.name, "待處理");
    ok("A2 重送 → 已完成", pa2.狀態?.select?.name, "已完成");
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

// ───────────────────────── 進入點 ─────────────────────────
const PROD = { roster: DS.roster, inbox: DS.inbox, portfolio: DS.portfolio };
console.log(`f37｜模式 ${MODE}${SANDBOX ? "（沙盒）" : ""}｜${taipeiDate(new Date().toISOString())}`);

if (SANDBOX) {
  process.exitCode = (await runSandbox()) ? 1 : 0;
} else {
  const t = await runPending({ ds: PROD, execute: MODE === "execute" });
  console.log(`R13 任務 ${t.tasks} 件／建列 ${t.rows}／略過 ${t.skip}／待審 ${t.review} 件／失敗 ${t.fail} 件／退回重試 ${t.retry} 件${MODE === "dry-run" ? "（dry-run，未寫入）" : ""}`);
}
