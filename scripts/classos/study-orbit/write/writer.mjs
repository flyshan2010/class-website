/**
 * 自學星圖題本寫入｜核心流程（不碰檔案與網路細節，api／gen 由呼叫端注入，測試用 mock）
 *
 * 依「被關聯的先建」順序：觀念複習卡 → 知識點 → 學習盲點 → 故事卡 → 母題 → 子題，最後更新題本頁內文的結構 JSON。
 * 每張表的 pages 一律由 gen.py（卡片由 cards.py）產生——欄位正本在那兩支，這裡只換外殼、送出、記 id。
 *
 * 防重複（RULE_Notion操作限制 §5b）：每張表先依關卡代碼（卡片依卡名）查 Notion 現有列，
 *   已有同鍵的不建、直接補記 id（上次寫到一半中斷，重跑就會接著寫）；Notion 自己有兩列同鍵 → 停。
 * dry-run：照樣查重、轉換、檢查選項與欄位，只是不送出，用假 id 讓下一張表的關聯接得上。
 * 公開 log：只印筆數、代碼、欄位名，不印題目內容。
 */
import { toNotionProps, mismatches, mdToBlocks, rt, readBack } from "./props.mjs";

export const DS = {
  card: "74bfc789-192e-425e-b7c6-477033bec302", // 📚 觀念複習卡
  kp: "41ab1f9d-7e45-81da-bd65-000b536e9294", // 🌌 知識點
  bs: "41ab1f9d-7e45-8156-bc9c-000bba6c8369", // 🎯 學習盲點
  story: "41ab1f9d-7e45-8116-9be6-000b62c71f55", // 🎴 故事卡
  q: "8dbb69f2-e9e2-442b-82f2-d0462c986c5a", // 📝 題庫
};

// table＝ids.json 的鍵；gen＝gen.py 的參數；key＝哪一欄是唯一鍵（＝ids.json 的 key）
export const STEPS = [
  { table: "card", gen: null, key: "卡名", label: "觀念複習卡" },
  { table: "kp", gen: "kp", key: "代碼", label: "知識點" },
  { table: "bs", gen: "bs", key: "代碼", label: "學習盲點" },
  { table: "story", gen: "story", key: "關卡代碼", label: "故事卡" },
  { table: "q", gen: "qroot", key: "題目ID", label: "母題" },
  { table: "q", gen: "qchild", key: "題目ID", label: "子題" },
];
const LEVEL_PROP = "關卡代碼";
// ids.json 慣例：卡片 id 去連字號（cards.py 註明），其餘照 API 回傳的帶連字號
const idFor = (table, id) => (table === "card" ? id.replace(/-/g, "") : id);

async function call(api, method, path, body) {
  const r = await api(method, path, body);
  if (!r.ok) throw new Error(`Notion API ${method} ${path} → ${r.status} ${r.json?.code ?? ""} ${r.json?.message ?? ""}`);
  return r.json;
}

async function queryAll(api, ds, filter) {
  const out = [];
  let cursor;
  do {
    const j = await call(api, "POST", `/data_sources/${ds}/query`, { page_size: 100, ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** Notion 現有列：唯一鍵 → [頁面 id…]（依關卡代碼前綴篩；卡片表沒有關卡代碼，整表讀） */
async function existing(api, table, schema, key, levels) {
  let filter;
  if (table !== "card") {
    const type = schema[LEVEL_PROP]?.type;
    if (type !== "rich_text" && type !== "title") throw new Error(`${table} 表的「${LEVEL_PROP}」欄型是 ${type}，無法依關卡篩`);
    filter = { or: levels.map((lv) => ({ property: LEVEL_PROP, [type]: { starts_with: lv } })) };
  }
  const map = new Map();
  for (const page of await queryAll(api, DS[table], filter)) {
    const k = readBack(page.properties?.[key]);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), page.id]);
  }
  return map;
}

let fakeSeq = 0;
const fakeId = () => `00000000-0000-4000-8000-${(++fakeSeq).toString(16).padStart(12, "0")}`;

/**
 * @param {object} o
 * @param {{levels:string[], cards?:object[], structure?:string[]}} o.payload
 * @param {object} o.ids        ids.json 內容（會就地補上新 id，供下一張表的 gen 使用）
 * @param {(what:string, ids:object, code?:string)=>any} o.gen  跑 gen.py（structure 時回物件，其餘回 pages 陣列）
 * @param {Function} o.api      (method, path, body) → {ok,status,json}
 * @param {boolean} o.execute
 * @param {object} o.newIds     寫入成功／補記的 id 收在這（中途失敗也保留已寫的，呼叫端 finally 落檔）
 */
export async function runWrite({ payload, ids, gen, api, execute, newIds, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), throttleMs = 350 }) {
  const levels = payload.levels ?? [];
  if (!levels.length || levels.some((x) => !x)) throw new Error("資料包沒有指定關卡範圍 levels（不給範圍會把舊批沒記 id 的子題重建一次）");
  const warnings = new Set();
  const summary = [];
  const schemas = {};
  for (const t of Object.keys(DS)) schemas[t] = (await call(api, "GET", `/data_sources/${DS[t]}`)).properties ?? {};
  const seen = {};

  for (const step of STEPS) {
    const { table, key, label } = step;
    const schema = schemas[table];
    if (!(table in seen)) {
      seen[table] = await existing(api, table, schema, key, levels);
      const dup = [...seen[table]].filter(([, v]) => v.length > 1).map(([k]) => k);
      if (dup.length) throw new Error(`${label}：Notion 已有重複的列（同鍵兩列以上），先人工處理：${dup.slice(0, 10).join("、")}`);
      // ids.json 有、Notion（此範圍）查不到 → 只提醒（可能被刪或關卡代碼改過）
      const lost = Object.keys(ids[table] ?? {}).filter((k) => !seen[table].has(k) && (table === "card" || levels.some((lv) => k.startsWith(lv))));
      if (lost.length && table !== "card") warnings.add(`${label}：ids.json 有但 Notion 查不到 ${lost.length} 列（${lost.slice(0, 5).join("、")}…）`);
    }
    ids[table] ??= {};
    newIds[table] ??= {};
    let pages = step.gen ? gen(step.gen, ids) : (payload.cards ?? []).filter((p) => !(p.properties[key] in ids.card));
    const s = { label, create: 0, adopt: 0 };
    for (const page of pages) {
      const k = page.properties[key];
      if (!k) throw new Error(`${label}：有一列缺唯一鍵「${key}」`);
      const have = seen[table].get(k);
      if (have) { // 已在 Notion：補記 id，不重建
        ids[table][k] = newIds[table][k] = idFor(table, have[0]);
        s.adopt++;
        continue;
      }
      const { properties, warnings: w } = toNotionProps(page.properties, schema);
      w.forEach((x) => warnings.add(`${label}：${x}`));
      const children = page.content ? mdToBlocks(page.content) : undefined;
      if (!execute) {
        ids[table][k] = idFor(table, fakeId());
        s.create++;
        continue;
      }
      const r = await api("POST", "/pages", { parent: { type: "data_source_id", data_source_id: DS[table] }, properties, ...(children ? { children } : {}) });
      if (!r.ok) {
        const maybe = r.status >= 500 ? "（5xx 可能其實已建立；直接重跑，查重會補記）" : "";
        throw new Error(`${label} ${k} 建立失敗：${r.status} ${r.json?.code ?? ""} ${r.json?.message ?? ""}${maybe}`);
      }
      ids[table][k] = newIds[table][k] = idFor(table, r.json.id);
      seen[table].set(k, [r.json.id]);
      const bad = mismatches(page.properties, r.json.properties);
      if (bad.length) throw new Error(`${label} ${k} 寫入後回讀不符：${bad.join("、")}`);
      s.create++;
      await sleep(throttleMs);
    }
    summary.push(s);
    log(`${execute ? "✅" : "🔎"} ${label}：${execute ? "已建" : "將建"} ${s.create} 筆，已在 Notion（補記 id）${s.adopt} 筆`);
  }

  for (const code of payload.structure ?? []) summary.push(await writeStructure({ code, ids, gen, api, execute, log }));
  for (const w of warnings) log(`⚠️ ${w}`);
  return { summary, warnings: [...warnings] };
}

/** 題本頁內文的結構 JSON（gen.py structure）寫進頁面裡唯一的 code 區塊，寫完回讀比對。 */
export async function writeStructure({ code, ids, gen, api, execute, log = console.log }) {
  const struct = gen("structure", ids, code);
  const islands = struct?.islands ?? [];
  if (!islands.length) throw new Error(`題本 ${code}：結構 JSON 沒有島`);
  if (code.startsWith("c-")) { // 國語一座島＝一課，必帶 unit（P2 SPEC §7）
    const noUnit = islands.filter((i) => !Number.isInteger(i.unit)).map((i) => i.id);
    if (noUnit.length) throw new Error(`題本 ${code}：島 ${noUnit.join("、")} 缺 unit`);
  }
  const pageId = ids.book?.[code];
  if (!pageId) throw new Error(`ids.json 沒有題本 ${code} 的頁面 id`);
  const kids = (await call(api, "GET", `/blocks/${pageId}/children?page_size=100`)).results ?? [];
  const codes = kids.filter((b) => b.type === "code");
  if (codes.length !== 1) throw new Error(`題本 ${code} 內文應恰有 1 個程式碼區塊，實際 ${codes.length} 個`);
  const curText = codes[0].code.rich_text.map((t) => t.plain_text).join("");
  let cur = null;
  try { cur = JSON.parse(curText); } catch { /* 舊內文壞掉也照樣覆寫 */ }
  const text = JSON.stringify(struct);
  const same = cur && JSON.stringify(cur) === text;
  const nLv = (s) => (s?.islands ?? []).reduce((n, i) => n + (i.levels?.length ?? 0), 0);
  const desc = `島 ${cur?.islands?.length ?? "?"}→${islands.length}、關 ${nLv(cur)}→${nLv(struct)}，unit ${islands.map((i) => i.unit ?? "-").join(",")}`;
  if (same) { log(`✅ 題本 ${code} 結構 JSON 已是最新（${desc}）`); return { label: `結構 ${code}`, create: 0, adopt: 1 }; }
  if (!execute) { log(`🔎 題本 ${code} 結構 JSON 將更新（${desc}）`); return { label: `結構 ${code}`, create: 1, adopt: 0 }; }
  await call(api, "PATCH", `/blocks/${codes[0].id}`, { code: { rich_text: rt(text), language: "json" } });
  const back = await call(api, "GET", `/blocks/${codes[0].id}`);
  const got = JSON.parse(back.code.rich_text.map((t) => t.plain_text).join(""));
  if (JSON.stringify(got) !== text) throw new Error(`題本 ${code} 結構 JSON 寫入後回讀不符`);
  if (code.startsWith("c-") && !got.islands.every((i) => Number.isInteger(i.unit))) throw new Error(`題本 ${code} 回讀結構缺 unit`);
  log(`✅ 題本 ${code} 結構 JSON 已更新並回讀一致（${desc}）`);
  return { label: `結構 ${code}`, create: 1, adopt: 0 };
}
