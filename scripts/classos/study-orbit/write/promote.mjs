/**
 * 自學星圖題本上線｜把一批已寫進 Notion 的「待審」列改成可用（卡片「草稿」改「上架」）
 *
 * 老師審題裁定、改稿都寫回 Notion 之後才跑（2026-11-21 老師裁定：改狀態走程式，不用連接器逐頁改）。
 * 範圍＝資料包的 levels（知識點／盲點／故事卡／題目依關卡代碼前綴）＋資料包的 cards（觀念複習卡依卡名）。
 *
 * 先全部檢查、一筆不符就整批不改（fail-closed）：
 *   ① Notion 該範圍的列和 bundle 應有的列一一對上（不多、不少、沒有同鍵兩列）
 *   ② 每列的文字、數字、選項欄和 gen.py／cards.py 產生的應有值相同（老師在 Notion 動過、或寫入時抄錯，都會擋下）
 *   ③ 狀態只能是「待審／草稿」（要改）或已是目標狀態（略過，中斷後重跑會接著改）
 * 通過才逐頁只改「狀態」一欄，改完回讀該欄。relation 不在這裡比（交給 verify.py）。
 * log 只印筆數與代碼，不印題目內容。
 */
import { toNotionProps, mismatches, readBack } from "./props.mjs";
import { DS } from "./writer.mjs";

// table＝Notion 表；gen＝gen.py 參數（卡片讀資料包 cards）；key＝唯一鍵；from→to＝狀態
export const PROMOTE_STEPS = [
  { table: "kp", gen: "kp", key: "代碼", label: "知識點", from: "待審", to: "可用" },
  { table: "bs", gen: "bs", key: "代碼", label: "學習盲點", from: "待審", to: "可用" },
  { table: "story", gen: "story", key: "關卡代碼", label: "故事卡", from: "待審", to: "可用" },
  { table: "card", gen: null, key: "卡名", label: "觀念複習卡", from: "草稿", to: "上架" },
  { table: "q", gen: ["qroot", "qchild"], key: "題目ID", label: "題目", from: "待審", to: "可用" },
];
const LEVEL_PROP = "關卡代碼";
const STATUS = "狀態";

async function call(api, method, path, body) {
  const r = await api(method, path, body);
  if (!r.ok) throw new Error(`Notion API ${method} ${path} → ${r.status} ${r.json?.code ?? ""} ${r.json?.message ?? ""}`);
  return r.json;
}

async function queryPages(api, table, schema, levels) {
  let filter;
  if (table !== "card") {
    const type = schema[LEVEL_PROP]?.type;
    if (type !== "rich_text" && type !== "title") throw new Error(`${table} 表的「${LEVEL_PROP}」欄型是 ${type}，無法依關卡篩`);
    filter = { or: levels.map((lv) => ({ property: LEVEL_PROP, [type]: { starts_with: lv } })) };
  }
  const out = [];
  let cursor;
  do {
    const j = await call(api, "POST", `/data_sources/${DS[table]}/query`, { page_size: 100, ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * @param {object} o
 * @param {{levels:string[], cards?:object[]}} o.payload
 * @param {(what:string, ids:object, code?:string, all?:boolean)=>any} o.gen  跑 gen.py（all＝--all，不略過 ids.json 已有的列）
 * @returns {{summary:object[], problems:string[]}}
 */
export async function runPromote({ payload, ids, gen, api, execute, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), throttleMs = 350 }) {
  const levels = payload.levels ?? [];
  if (!levels.length || levels.some((x) => !x)) throw new Error("資料包沒有指定關卡範圍 levels");
  const plans = [];
  const problems = [];

  // ── 第一輪：全部檢查，不改任何東西 ──
  for (const step of PROMOTE_STEPS) {
    const { table, key, label, from, to } = step;
    const schema = (await call(api, "GET", `/data_sources/${DS[table]}`)).properties ?? {};
    const want = step.gen
      ? [].concat(step.gen).flatMap((g) => gen(g, ids, undefined, true))
      : payload.cards ?? [];
    const expect = new Map(want.map((p) => [p.properties[key], p.properties]));
    if (expect.size !== want.length) throw new Error(`${label}：應有的列有重複的鍵`);
    if (table === "card" && !expect.size) { log(`ℹ️ ${label}：資料包沒有卡片，略過`); continue; }
    const pages = (await queryPages(api, table, schema, levels)).filter((p) => table !== "card" || expect.has(readBack(p.properties?.[key])));
    const byKey = new Map();
    for (const p of pages) {
      const k = readBack(p.properties?.[key]);
      if (!k) { problems.push(`${label}：Notion 有一列缺「${key}」`); continue; }
      byKey.set(k, [...(byKey.get(k) ?? []), p]);
    }
    const dup = [...byKey].filter(([, v]) => v.length > 1).map(([k]) => k);
    if (dup.length) problems.push(`${label}：Notion 同鍵兩列以上 ${dup.length} 個（${dup.slice(0, 5).join("、")}）`);
    const extra = [...byKey.keys()].filter((k) => !expect.has(k));
    if (extra.length) problems.push(`${label}：Notion 有但 bundle 沒有 ${extra.length} 列（${extra.slice(0, 5).join("、")}）`);
    const missing = [...expect.keys()].filter((k) => !byKey.has(k));
    if (missing.length) problems.push(`${label}：bundle 有但 Notion 沒有 ${missing.length} 列（${missing.slice(0, 5).join("、")}），先跑寫入`);

    const todo = [];
    let done = 0;
    const diffCols = new Map();
    for (const [k, props] of expect) {
      const page = byKey.get(k)?.[0];
      if (!page) continue;
      const cur = readBack(page.properties?.[STATUS]);
      if (cur !== from && cur !== to) { problems.push(`${label} ${k}：狀態是「${cur}」，不是「${from}」或「${to}」`); continue; }
      const bad = mismatches({ ...props, [STATUS]: cur }, page.properties);
      if (bad.length) { bad.forEach((c) => diffCols.set(c, [...(diffCols.get(c) ?? []), k])); continue; }
      if (cur === to) done++;
      else todo.push({ k, id: page.id });
    }
    for (const [c, ks] of diffCols) problems.push(`${label}：「${c}」和 bundle 不同 ${ks.length} 列（${ks.slice(0, 5).join("、")}）`);
    const { properties } = toNotionProps({ [STATUS]: to }, schema);
    plans.push({ step, todo, done, properties });
  }

  if (problems.length) {
    problems.forEach((p) => log(`❌ ${p}`));
    throw new Error(`檢查不通過 ${problems.length} 項，一列都沒改（先查 Notion 是否被改過，或 bundle 是否和 Notion 不同步）`);
  }

  // ── 第二輪：只改狀態欄，逐頁回讀 ──
  const summary = [];
  for (const { step, todo, done, properties } of plans) {
    const { label, to } = step;
    let n = 0;
    if (execute) {
      for (const { k, id } of todo) {
        const r = await api("PATCH", `/pages/${id}`, { properties });
        if (!r.ok) throw new Error(`${label} ${k} 改狀態失敗：${r.status} ${r.json?.code ?? ""}（已改 ${n} 筆；直接重跑會略過已改的）`);
        if (readBack(r.json.properties?.[STATUS]) !== to) throw new Error(`${label} ${k} 改完回讀狀態不是「${to}」`);
        n++;
        await sleep(throttleMs);
      }
    }
    summary.push({ label, change: execute ? n : todo.length, already: done });
    log(`${execute ? "✅" : "🔎"} ${label}：${execute ? "已改" : "將改"}「${to}」${execute ? n : todo.length} 筆，原本就是「${to}」${done} 筆`);
  }
  return { summary, problems };
}
