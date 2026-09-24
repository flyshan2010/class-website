/** 假 Notion：讀寫都在 SIM_STATE 這個 JSON 檔裡；沒有任何網路呼叫。寫入另記 writes 供驗收。 */
import { readFileSync, writeFileSync } from "node:fs";
import { DS as REAL_DS } from "../../lib/notion.mjs";   // 只取 ID 常數；該模組的 api() 從未被呼叫
export const DS = REAL_DS;
export const isExecute = () => (process.env.MODE ?? "dry-run") === "execute";
const F = process.env.SIM_STATE;
const load = () => JSON.parse(readFileSync(F, "utf8"));
const save = s => writeFileSync(F, JSON.stringify(s, null, 1));
// 寫入格式（text.content）轉成讀取格式（plain_text），跟真 API 回讀一致
const norm = props => Object.fromEntries(Object.entries(props).map(([k, v]) => {
  for (const t of ["title", "rich_text"]) if (Array.isArray(v?.[t]))
    return [k, { [t]: v[t].map(x => ({ plain_text: x.plain_text ?? x.text?.content ?? "" })) }];
  return [k, v];
}));
export async function queryAll(ds) { return structuredClone(load().db[ds] ?? []); }
export async function updatePage(id, properties) {
  const s = load();
  for (const rows of Object.values(s.db)) {
    const p = rows.find(r => r.id === id);
    if (!p) continue;
    for (const [k, v] of Object.entries(norm(properties))) p.properties[k] = v;
    s.writes.push({ op: "update", id, keys: Object.keys(properties) });
    save(s); return { ok: true, status: 200, json: {} };
  }
  return { ok: false, status: 404, json: { message: "not found" } };
}
export async function api(method, path, body) {
  if (method !== "POST" || path !== "/pages") throw new Error(`假層不支援 ${method} ${path}`);
  const s = load(), ds = body.parent.data_source_id, id = `fake-${s.seq++}`;
  (s.db[ds] ??= []).push({ id, properties: norm(body.properties) });
  s.writes.push({ op: "create", ds, id });
  save(s); return { ok: true, status: 200, json: { id } };
}
