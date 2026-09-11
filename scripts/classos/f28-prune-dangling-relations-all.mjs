/**
 * ClassOS Phase F｜F28：全庫清除指向「已永久刪除頁面」的舊關聯（F27 的全庫版）
 *
 * 背景：F27（2026-09-11）清完學生名冊後，其他庫可能也掛著同一批死 id——
 *      f14（2026-08-01）刪掉 480+ 筆模擬資料（紀錄、銀行帳、報告、成績、作品、兌換），
 *      那些模擬列曾關聯到「當時已存在、至今仍保留」的真實列（商店品項、教學單元、週報、工作分配…）。
 *
 * 範圍推論：死 id 只可能出現在「刪除日以前建立」的現存列；以 f14（8/1）為主，放寬到 8/12 涵蓋其他已過 30 天的刪除。
 *      之後才建立的列，建立時那批頁面已經刪了，不可能關聯得到。名冊已由 F27 處理，略過。
 *
 * 做法（沿用 F27 實證）：官方 API 讀關聯會自動濾掉已刪除頁面，挑不出死 id；
 *      改把 API 可見清單原樣寫回，覆蓋隱藏的死 id。死 id 是否消失由 Claude 以 MCP fetch 抽查。
 *
 * 安全設計：
 *   · 預設 dry-run；MODE=execute 才動手。
 *   · API 可見的 id 必須都在目標庫現存列裡，否則該欄不寫、列入異常。
 *   · 寫入前逐欄重讀當下關聯；有效關聯 > 100（單次寫入上限）的欄不寫、列為「需人工」。
 *   · 寫後逐欄回讀：id 集合須與寫入前完全相同。
 *   · Actions log 公開可讀：只印資料庫名、欄名與筆數，不印任何列內容。
 */

import { DS, api, apiOrThrow, queryAll, getSchema, updatePage, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();
// 放寬到 8/12：垃圾桶保留 30 天，截至 9/11 已永久刪除者最晚刪於 8/12，關聯只可能掛在更早建立的列
const CUTOFF = "2026-08-12";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (id) => String(id).replace(/-/g, "");

async function readRelation(pageId, propId) {
  const ids = [];
  let cursor;
  do {
    const q = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const json = await apiOrThrow("GET", `/pages/${pageId}/properties/${propId}${q}`);
    for (const it of json.results ?? []) if (it.relation?.id) ids.push(norm(it.relation.id));
    cursor = json.has_more ? json.next_cursor : undefined;
    await sleep(120);
  } while (cursor);
  return ids;
}

// ── 1. 列出整合可見的所有 data source ─────────────────────
const sources = [];
let cursor;
do {
  const json = await apiOrThrow("POST", "/search", {
    filter: { property: "object", value: "data_source" },
    page_size: 100,
    ...(cursor ? { start_cursor: cursor } : {}),
  });
  for (const d of json.results) sources.push({ id: d.id, name: (d.title ?? []).map((t) => t.plain_text).join("") || "(無名)" });
  cursor = json.has_more ? json.next_cursor : undefined;
} while (cursor);
console.log(`可見資料庫 ${sources.length} 個；範圍＝${CUTOFF} 以前建立的現存列（名冊已由 F27 處理，略過）\n`);

// ── 2. 逐庫盤點 ─────────────────────────────────────────
const liveCache = {};
async function liveSet(dsId) {
  if (!liveCache[dsId]) {
    const r = await api("POST", `/data_sources/${dsId}/query`, { page_size: 1 });
    if (!r.ok) return null; // 目標庫整合讀不到 → 無法驗證
    liveCache[dsId] = new Set((await queryAll(dsId)).map((p) => norm(p.id)));
  }
  return liveCache[dsId];
}

const plan = []; // { ds, pageId, prop }
const anomalies = [];
for (const s of sources) {
  if (norm(s.id) === norm(DS.roster)) continue;
  const schema = await getSchema(s.id);
  const relProps = Object.entries(schema)
    .filter(([, p]) => p.type === "relation")
    .map(([name, p]) => ({ name, id: p.id, target: p.relation?.data_source_id }));
  if (!relProps.length) continue;

  const rows = await queryAll(s.id, { filter: { timestamp: "created_time", created_time: { on_or_before: CUTOFF } } });
  if (!rows.length) continue;

  const tally = {};
  for (const row of rows) {
    for (const r of relProps) {
      const live = r.target ? await liveSet(r.target) : null;
      if (!live) { anomalies.push(`${s.name}「${r.name}」目標庫無法讀取，略過`); continue; }
      const ids = await readRelation(row.id, r.id);
      if (ids.some((id) => !live.has(id))) { anomalies.push(`${s.name}「${r.name}」有 API 可見但不在目標庫的 id，略過該欄`); continue; }
      plan.push({ ds: s.name, pageId: row.id, prop: r, visible: ids.length });
      tally[r.name] ??= { cols: 0, ids: 0 };
      tally[r.name].cols++;
      tally[r.name].ids += ids.length;
    }
  }
  console.log(`📂 ${s.name}｜舊列 ${rows.length} 筆`);
  for (const [name, v] of Object.entries(tally)) console.log(`    · ${name}：${v.cols} 欄，有效 ${v.ids} 筆`);
}

const over = plan.filter((c) => c.visible > 100);
console.log(`\n合計將寫回 ${plan.length} 個關聯欄；有效 >100 需人工 ${over.length} 欄；異常 ${anomalies.length} 項`);
for (const a of [...new Set(anomalies)]) console.log(`    ⚠️ ${a}`);
for (const c of over) console.log(`    ✋ ${c.ds}「${c.prop.name}」有效 ${c.visible} 筆，超過寫入上限`);
if (anomalies.length) { console.error("❌ 有異常，為安全起見中止（不寫入）。"); process.exit(1); }

if (!EXECUTE) {
  console.log("\n🔍 DRY-RUN 結束，未異動任何資料。");
  process.exit(0);
}

// ── 3. 寫回 ─────────────────────────────────────────────
console.log("\n開始寫回…\n");
let ok = 0;
const fail = [];
const expected = [];
for (const c of plan.filter((c) => c.visible <= 100)) {
  try {
    const keep = await readRelation(c.pageId, c.prop.id);
    if (keep.length > 100) throw new Error(`有效 ${keep.length} 筆超過寫入上限`);
    const r = await updatePage(c.pageId, { [c.prop.name]: { relation: keep.map((id) => ({ id })) } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.json?.code ?? ""}`);
    expected.push({ ...c, keep });
    ok++;
  } catch (e) {
    fail.push(`${c.ds}「${c.prop.name}」${e.message}`);
  }
  await sleep(350);
}
console.log(`  成功 ${ok}／失敗 ${fail.length}`);
for (const f of fail) console.log(`    ❌ ${f}`);

// ── 4. 回讀 ─────────────────────────────────────────────
console.log("\n回讀驗證…");
let lost = 0, extra = 0;
for (const e of expected) {
  const after = new Set(await readRelation(e.pageId, e.prop.id));
  const before = new Set(e.keep);
  for (const id of before) if (!after.has(id)) lost++;
  for (const id of after) if (!before.has(id)) extra++;
}
console.log(`  ${lost === 0 ? "✅" : "❌"} 有效關聯遺失 ${lost} 筆`);
console.log(`  ${extra === 0 ? "✅" : "❌"} 多出關聯 ${extra} 筆`);

console.log("\n════════ 總結 ════════");
if (!fail.length && lost === 0 && extra === 0) {
  console.log(`結論：${ok} 個關聯欄已寫回，有效關聯零遺失${over.length ? `；另 ${over.length} 欄超過上限需人工` : ""}。`);
} else {
  console.log("結論：未完全寫回或有遺失，需檢查上列項目。");
  process.exit(1);
}
