/**
 * ClassOS Phase F｜F27：清除學生名冊上指向「已永久刪除頁面」的舊關聯
 *
 * 背景：2026-08-01 模擬資料全面清除（v3.5.9），回收區整頁刪除、30 天後永久消失。
 *      但名冊的關聯欄（🏦 銀行帳／📊 學習報告／📚 學期成績／🧭 輔導…）仍留著那些頁面 id，
 *      Notion 畫面顯示成一排「沒有存取權限」，老師誤以為學生資料不見了。
 *
 * 目標終態：名冊每個關聯欄只剩真實存在的頁面；有效關聯一筆不少。
 *
 * 判定「死關聯」要同時滿足兩件事（缺一不刪）：
 *   ① 不在關聯目標資料庫的現存列裡（queryAll 撈全庫比對）
 *   ② 單頁 GET 回 404 object_not_found（還在垃圾桶的 in_trash 頁不算，保留不動）
 *
 * 安全設計：
 *   · 預設 dry-run；MODE=execute 才動手。
 *   · 寫入前逐頁「重讀當下關聯」再扣掉死關聯，避免蓋掉讀取後才新增的有效關聯。
 *   · 關聯用 property item 端點分頁讀全（頁面 GET 只給前 25 筆）。
 *   · Actions log 公開可讀：不印姓名、座號、頁面內容，只印欄名與筆數。
 */

import { DS, api, apiOrThrow, queryAll, getSchema, updatePage, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (id) => String(id).replace(/-/g, "");

/** 讀某頁某關聯欄的完整 id 清單（分頁）。 */
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

// ── 1. 名冊的關聯欄與各自目標庫 ─────────────────────────
const schema = await getSchema(DS.roster);
const relProps = Object.entries(schema)
  .filter(([, p]) => p.type === "relation")
  .map(([name, p]) => ({ name, id: p.id, target: p.relation?.data_source_id }));
for (const r of relProps) {
  if (!r.target) { console.error(`❌ 關聯欄「${r.name}」讀不到目標 data_source_id，中止`); process.exit(1); }
}
console.log(`👥 學生名冊｜關聯欄 ${relProps.length} 個：${relProps.map((r) => r.name).join("、")}`);

// ── 2. 各目標庫現存列 id ────────────────────────────────
const live = {};
for (const t of new Set(relProps.map((r) => r.target))) {
  live[t] = new Set((await queryAll(t)).map((p) => norm(p.id)));
}

// ── 3. 逐生讀關聯，找出候選 ────────────────────────────
const roster = await queryAll(DS.roster);
console.log(`名冊 ${roster.length} 位\n`);
const current = []; // { pageId, prop, ids }
const candidates = new Set();
for (const p of roster) {
  for (const r of relProps) {
    const ids = await readRelation(p.id, r.id);
    current.push({ pageId: p.id, prop: r, ids });
    for (const id of ids) if (!live[r.target].has(id)) candidates.add(id);
  }
}

// ── 4. 候選逐頁 GET 確認真的 404 ───────────────────────
const dead = new Set();
let inTrash = 0, unknown = 0;
for (const id of candidates) {
  const r = await api("GET", `/pages/${id}`);
  if (r.status === 404 && r.json?.code === "object_not_found") dead.add(id);
  else if (r.ok && (r.json?.in_trash || r.json?.archived)) inTrash++;
  else unknown++;
  await sleep(350);
}
console.log(`候選 ${candidates.size} 個 → 確認已永久刪除 ${dead.size}／仍在垃圾桶（保留）${inTrash}／無法判定（保留）${unknown}`);
if (unknown) { console.error("❌ 有無法判定的頁面，為安全起見中止。"); process.exit(1); }

// ── 5. 彙整計畫（只印欄名與筆數）────────────────────────
const plan = current
  .map((c) => ({ ...c, drop: c.ids.filter((id) => dead.has(id)) }))
  .filter((c) => c.drop.length);
const byProp = {};
for (const c of plan) {
  byProp[c.prop.name] ??= { students: 0, drop: 0 };
  byProp[c.prop.name].students++;
  byProp[c.prop.name].drop += c.drop.length;
}
console.log(`\n待清理：${new Set(plan.map((c) => c.pageId)).size} 位學生`);
for (const [name, v] of Object.entries(byProp)) console.log(`    · ${name}：${v.students} 位，共移除 ${v.drop} 筆死關聯`);
const keptTotal = current.reduce((s, c) => s + c.ids.filter((id) => !dead.has(id)).length, 0);
console.log(`  有效關聯（保留不動）共 ${keptTotal} 筆`);

if (!plan.length) { console.log("\n✅ 無需處理。"); process.exit(0); }
if (!EXECUTE) {
  console.log("\n🔍 DRY-RUN 結束，未異動任何資料。");
  console.log("   確認上列數字無誤後，以 MODE=execute 重跑即移除死關聯。");
  process.exit(0);
}

// ── 6. 寫入：重讀當下關聯 → 扣掉死關聯 → 寫回 ─────────────
console.log("\n開始清理…\n");
let ok = 0;
const fail = [];
const expected = []; // { pageId, prop, keep }
for (const c of plan) {
  try {
    const now = await readRelation(c.pageId, c.prop.id);
    const keep = now.filter((id) => !dead.has(id));
    if (keep.length > 100) throw new Error(`「${c.prop.name}」有效關聯 ${keep.length} 筆超過單次寫入上限 100`);
    const r = await updatePage(c.pageId, { [c.prop.name]: { relation: keep.map((id) => ({ id })) } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.json?.code ?? ""}`);
    expected.push({ pageId: c.pageId, prop: c.prop, keep });
    ok++;
  } catch (e) {
    fail.push(`「${c.prop.name}」${e.message}`);
  }
  await sleep(350);
}
console.log(`  成功 ${ok}／失敗 ${fail.length}`);
for (const f of fail) console.log(`    ❌ ${f}`);

// ── 7. 回讀驗證 ─────────────────────────────────────────
console.log("\n回讀驗證…");
let residual = 0, lost = 0;
for (const e of expected) {
  const after = new Set(await readRelation(e.pageId, e.prop.id));
  for (const id of after) if (dead.has(id)) residual++;
  for (const id of e.keep) if (!after.has(id)) lost++;
}
console.log(`  ${residual === 0 ? "✅" : "❌"} 死關聯殘留 ${residual} 筆`);
console.log(`  ${lost === 0 ? "✅" : "❌"} 有效關聯遺失 ${lost} 筆`);

console.log("\n════════ 總結 ════════");
if (!fail.length && residual === 0 && lost === 0) {
  console.log(`結論：已移除 ${dead.size} 個已刪除頁面的舊關聯，名冊不再顯示「沒有存取權限」；有效關聯零遺失。`);
} else {
  console.log("結論：未完全清理或有遺失，需檢查上列項目。");
  process.exit(1);
}
