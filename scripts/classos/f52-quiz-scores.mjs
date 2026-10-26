/**
 * f52｜R20 錯題表成績上傳入庫（班網 quiz.html「⬆️ 上傳到紀錄庫」→ 收件匣 #QUIZ-SCORES → 📝 班經與學習紀錄庫平時考）
 * ───────────────────────────────────────────────────────────────
 * 2026-10-26 老師裁定：錯題表輸入後一鍵上傳。規則本體在 lib/quiz-scores.mjs（純函式＋測試）。
 * 跑在 sync.yml「同步 Notion 資料」之前（錯題表按上傳會順便觸發同步），所以寫完當輪報告就有錯題分析。
 *
 * MODE（環境變數，預設 dry-run）：
 *   dry-run  讀「待處理」的上傳任務，算出每批會怎麼處理，不寫任何東西
 *   execute  認領 → 建列／補錯題 → 回讀 → 回填收件匣（全部相符＝已完成；分數不同、沒寫的人、回讀不符＝待審；格式壞或分段沒到齊逾時＝失敗）
 * TASK_STATUS：只給 dry-run 用，改撈別的狀態來演練既有任務。
 * 不覆蓋分數（老師 2026-10-26 裁定：分數不同保留紀錄庫，列給老師看）；同一份卷重傳只補有變的錯題碼。
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀：只印數字與任務短 id，不印座號、分數、錯題。
 */
import { readFileSync, appendFileSync } from "node:fs";
import { api, DS } from "./lib/notion.mjs";
import * as qs from "./lib/quiz-scores.mjs";
import { weekLabel } from "./lib/cm-events.mjs";

const DS_QUIZ = "51c1c08f-78b4-4352-85f6-e45fb7361c2a"; // 📝 平時卷（與 sync-notion.mjs quizExams 同一個）
const MODE = (process.env.MODE ?? "dry-run").trim();
if (!["dry-run", "execute"].includes(MODE)) { console.error(`未知 MODE：${MODE}`); process.exit(1); }
const EXECUTE = MODE === "execute";
const TASK_STATUS = EXECUTE ? "待處理" : (process.env.TASK_STATUS || "待處理").trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rt = (s) => (s ? [{ type: "text", text: { content: String(s).slice(0, 2000) } }] : []);
const plain = (arr) => (arr ?? []).map((t) => t.plain_text).join("");
const tid = (id) => String(id).replace(/-/g, "").slice(-8);

// ── Notion 呼叫：節流＋429／5xx 重試 3 次（同 f47）──
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
async function loadRoster() {
  const map = new Map();
  for (const p of await queryAll(DS.roster, { filter: { property: "在學", checkbox: { equals: true } } })) {
    const seat = p.properties?.座號?.number;
    if (seat == null) continue;
    if (map.has(seat)) throw new Error("名冊有重複座號（在學），需人工");
    map.set(seat, p.id);
  }
  if (!map.size) throw new Error("名冊讀不到任何在學學生");
  return map;
}
/** 📝平時卷 卷id → { subject, name, date, year, week }；缺名稱或考試日＝丟錯（不猜）。 */
async function loadMeta(examId, weeks) {
  const hit = await queryAll(DS_QUIZ, { filter: { property: "卷id", title: { equals: examId } } });
  if (hit.length !== 1) throw new Error(`📝平時卷找到 ${hit.length} 列「${examId}」`);
  const p = hit[0].properties;
  const meta = {
    subject: p.科目?.select?.name ?? "", name: plain(p.名稱?.rich_text).trim(),
    date: (p.考試日?.date?.start ?? "").slice(0, 10), year: p.學年?.select?.name ?? "",
  };
  if (!meta.subject || !meta.name || !meta.date || !meta.year) throw new Error(`📝平時卷「${examId}」的科目／名稱／考試日／學年有空白`);
  meta.week = weekLabel(meta.date, weeks);
  if (!meta.week) throw new Error(`考試日 ${meta.date} 對不到週次`);
  return meta;
}
async function loadExisting(meta) {
  const rows = await queryAll(DS.log, { filter: { and: [
    { property: "類別", select: { equals: "評量" } }, { property: "學年", select: { equals: meta.year } },
    { property: "科目", select: { equals: meta.subject } }, { property: "評量名稱", rich_text: { equals: meta.name } },
  ] } });
  return rows.map((p) => ({ id: p.id, student: p.properties?.學生?.relation?.[0]?.id ?? "", score: p.properties?.分數?.number ?? null, errors: plain(p.properties?.錯題?.rich_text) }));
}
const toProps = (r) => ({
  事件描述: { title: rt(r.事件描述) }, 學生: { relation: [{ id: r.學生 }] }, 類別: { select: { name: r.類別 } },
  科目: { select: { name: r.科目 } }, 正負向: { select: { name: r.正負向 } }, 分數: { number: r.分數 },
  評量名稱: { rich_text: rt(r.評量名稱) }, 日期: { date: { start: r.日期 } }, 學年: { select: { name: r.學年 } },
  週次: { rich_text: rt(r.週次) }, 錯題: { rich_text: rt(r.錯題) },
});

async function main() {
  console.log(`f52｜模式 ${MODE}${TASK_STATUS !== "待處理" ? `｜撈「${TASK_STATUS}」` : ""}`);
  const tasks = (await queryAll(DS.inbox, { filter: { property: "狀態", select: { equals: TASK_STATUS } } }))
    .map((p) => ({ id: p.id, text: plain(p.properties?.任務原文?.title), created: p.created_time }))
    .filter((t) => qs.isR20(t.text));
  const tot = { batches: 0, created: 0, patched: 0, done: 0, review: 0, fail: 0, wait: 0, retry: 0 };
  if (!tasks.length) { console.log("錯題表上傳任務 0 件"); return tot; }

  const fillAll = (ids, status, log, err) => Promise.all(ids.map((id) => must("PATCH", `/pages/${id}`, { properties: {
    任務類型: { select: { name: "記錄" } }, 路由ID: { rich_text: rt("R20") }, 狀態: { select: { name: status } },
    執行紀錄: { rich_text: rt(log) }, 錯誤訊息: { rich_text: rt(err) },
    ...(status === "已完成" ? { 完成時間: { date: { start: new Date().toISOString() } } } : {}),
  } })));
  let roster, weeks;
  for (const g of qs.groupBatches(tasks)) {
    const tag = `批次 ${tid(g.tasks[0])}（${g.tasks.length} 段）`;
    if (g.state === "wait") { tot.wait++; console.log(`${tag}：分段還沒到齊，下一輪再處理`); continue; }
    tot.batches++;
    if (g.state === "broken") {
      tot.fail++;
      if (EXECUTE) await fillAll(g.tasks, "失敗", "沒有寫入", g.why);
      console.log(`${tag}：失敗（格式或分段）`);
      continue;
    }
    let wrote = false;
    try {
      if (EXECUTE) await Promise.all(g.tasks.map((id) => must("PATCH", `/pages/${id}`, { properties: { 狀態: { select: { name: "處理中" } } } })));
      roster ??= await loadRoster();
      weeks ??= loadWeeks();
      const meta = await loadMeta(g.examId, weeks);
      const plan = qs.planBatch(meta, g.rows, roster, await loadExisting(meta));
      console.log(`${tag}：新建 ${plan.creates.length}／補錯題 ${plan.patches.length}／沒變 ${plan.same}／分數不同 ${plan.conflicts.length}／沒寫 ${plan.problems.length + g.bad.length}`);
      if (!EXECUTE) continue;
      const mismatch = [];
      for (const c of plan.creates) {
        const w = await must("POST", "/pages", { parent: { type: "data_source_id", data_source_id: DS.log }, properties: toProps(c.props) });
        wrote = true;
        const b = (await must("GET", `/pages/${w.id}`)).properties;
        if (b.分數?.number !== c.props.分數 || plain(b.錯題?.rich_text) !== c.props.錯題 || b.學生?.relation?.[0]?.id?.replace(/-/g, "") !== c.props.學生.replace(/-/g, "")
          || plain(b.評量名稱?.rich_text) !== c.props.評量名稱 || b.學年?.select?.name !== c.props.學年) mismatch.push(`座號${c.seat}`);
        tot.created++;
      }
      for (const u of plan.patches) {
        await must("PATCH", `/pages/${u.id}`, { properties: { 錯題: { rich_text: rt(u.errors) } } });
        wrote = true;
        const b = (await must("GET", `/pages/${u.id}`)).properties;
        if (plain(b.錯題?.rich_text) !== u.errors) mismatch.push(`座號${u.seat}`);
        tot.patched++;
      }
      const review = [qs.reviewText(plan, g.bad), mismatch.length ? `回讀不符（已寫入，請人工確認）：${mismatch.join("、")}` : ""].filter(Boolean).join("\n");
      await fillAll(g.tasks, review ? "待審" : "已完成", qs.execLog(meta, plan), review);
      review ? tot.review++ : tot.done++;
    } catch (e) {
      if (wrote || !(e instanceof Transient)) {
        tot.fail++;
        if (EXECUTE) await fillAll(g.tasks, "失敗", wrote ? "部分已寫入，請重按上傳補齊（同一份卷重傳不會重複）" : "沒有寫入", e.message).catch(() => {});
        console.log(`${tag}：失敗（${wrote ? "部分已寫入" : "未寫入"}）`);
        continue;
      }
      tot.retry++;
      if (EXECUTE) await Promise.all(g.tasks.map((id) => call("PATCH", `/pages/${id}`, { properties: { 狀態: { select: { name: "待處理" } } } })));
      console.log(`${tag}：Notion 暫時性錯誤，退回待處理`);
    }
  }
  return tot;
}

const t = await main();
console.log(`錯題表上傳：處理 ${t.batches} 批（新建 ${t.created} 列、補錯題 ${t.patched} 列）／完成 ${t.done}／待審 ${t.review}／失敗 ${t.fail}／等分段 ${t.wait}／退回重試 ${t.retry}${EXECUTE ? "" : "（dry-run，未寫入）"}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `wrote=${(t.created ?? 0) + (t.patched ?? 0)}\n`);
