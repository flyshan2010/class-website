/**
 * 自學星圖題本｜只改題庫「塔題類」一欄（P3 SPEC §13.2：現有國語題 AI 標、老師裁定後寫入）
 *
 * 範圍＝資料包的 levels（題目依關卡代碼前綴）；應有值＝gen.py qroot／qchild 的「塔題類」（沒有＝空）。
 * 先全部檢查、一筆不符就整批不改（fail-closed）：Notion 該範圍的題目和 bundle 一一對上（不多、不少、沒有同鍵兩列）。
 * 通過才逐頁只改「塔題類」，改完回讀該欄；已是應有值的略過（中斷後重跑會接著改）。題目其他欄位一律不碰。
 * log 只印筆數與題號，不印題目內容。
 */
import { toNotionProps, readBack } from "./props.mjs";
import { DS } from "./writer.mjs";

export const TAG_PROP = "塔題類";
const KEY = "題目ID";
const LEVEL_PROP = "關卡代碼";

async function call(api, method, path, body) {
  const r = await api(method, path, body);
  if (!r.ok) throw new Error(`Notion API ${method} ${path} → ${r.status} ${r.json?.code ?? ""} ${r.json?.message ?? ""}`);
  return r.json;
}

export async function runTag({ payload, ids, gen, api, execute, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), throttleMs = 350 }) {
  const levels = payload.levels ?? [];
  if (!levels.length || levels.some((x) => !x)) throw new Error("資料包沒有指定關卡範圍 levels");
  const schema = (await call(api, "GET", `/data_sources/${DS.q}`)).properties ?? {};
  if (schema[TAG_PROP]?.type !== "select") throw new Error(`題庫沒有 select 欄「${TAG_PROP}」（先在 Notion 加欄）`);
  const lvType = schema[LEVEL_PROP]?.type;
  if (lvType !== "rich_text" && lvType !== "title") throw new Error(`題庫「${LEVEL_PROP}」欄型是 ${lvType}，無法依關卡篩`);

  const want = new Map(["qroot", "qchild"].flatMap((g) => gen(g, ids, undefined, true)).map((p) => [p.properties[KEY], p.properties[TAG_PROP] ?? ""]));
  const filter = { or: levels.map((lv) => ({ property: LEVEL_PROP, [lvType]: { starts_with: lv } })) };
  const pages = [];
  let cursor;
  do {
    const j = await call(api, "POST", `/data_sources/${DS.q}/query`, { page_size: 100, filter, ...(cursor ? { start_cursor: cursor } : {}) });
    pages.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);

  const problems = [], byKey = new Map();
  for (const p of pages) {
    const k = readBack(p.properties?.[KEY]);
    if (!k) { problems.push(`Notion 有一列缺「${KEY}」`); continue; }
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  const dup = [...byKey].filter(([, v]) => v.length > 1).map(([k]) => k);
  if (dup.length) problems.push(`Notion 同題號兩列以上 ${dup.length} 個（${dup.slice(0, 5).join("、")}）`);
  const extra = [...byKey.keys()].filter((k) => !want.has(k));
  if (extra.length) problems.push(`Notion 有但 bundle 沒有 ${extra.length} 列（${extra.slice(0, 5).join("、")}）`);
  const missing = [...want.keys()].filter((k) => !byKey.has(k));
  if (missing.length) problems.push(`bundle 有但 Notion 沒有 ${missing.length} 列（${missing.slice(0, 5).join("、")}）`);
  if (problems.length) {
    problems.forEach((p) => log(`❌ ${p}`));
    throw new Error(`檢查不通過 ${problems.length} 項，一列都沒改`);
  }

  const todo = [], count = {};
  let already = 0;
  for (const [k, v] of want) {
    const page = byKey.get(k)[0], cur = readBack(page.properties?.[TAG_PROP]) ?? "";
    if (cur === v) { already++; continue; }
    toNotionProps({ [TAG_PROP]: v }, schema); // 先驗選項存在（打錯字整批不改）
    todo.push({ k, id: page.id, v, cur });
    count[v || "（清空）"] = (count[v || "（清空）"] ?? 0) + 1;
  }
  log(`🏷️ 塔題類：要改 ${todo.length} 題（${Object.entries(count).map(([a, n]) => `${a} ${n}`).join("、") || "無"}）、已是應有值 ${already} 題`);
  let n = 0;
  if (execute) {
    for (const { k, id, v } of todo) {
      const r = await api("PATCH", `/pages/${id}`, { properties: toNotionProps({ [TAG_PROP]: v }, schema).properties });
      if (!r.ok) throw new Error(`${k} 改塔題類失敗：${r.status} ${r.json?.code ?? ""}（已改 ${n} 筆；直接重跑會略過已改的）`);
      if ((readBack(r.json.properties?.[TAG_PROP]) ?? "") !== v) throw new Error(`${k} 改完回讀塔題類不是「${v}」`);
      n++;
      await sleep(throttleMs);
    }
    log(`✅ 已改 ${n} 題，逐頁回讀一致`);
  }
  return { summary: [{ label: "塔題類", change: todo.length, already, done: n }], changed: todo.map((t) => t.k) };
}
