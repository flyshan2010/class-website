/**
 * ClassOS Phase F｜F27：清除學生名冊上指向「已永久刪除頁面」的舊關聯
 *
 * 背景：2026-08-01 模擬資料全面清除（v3.5.9），回收區整頁刪除、30 天後永久消失。
 *      但名冊的關聯欄（🏦 銀行帳／📊 學習報告／📚 學期成績／🧭 輔導…）仍留著那些頁面 id，
 *      Notion 畫面顯示成一排「沒有存取權限」，老師誤以為學生資料不見了。
 *
 * 關鍵事實（2026-09-11 第一版 dry-run 實測）：
 *   官方 API 讀關聯時會「自動濾掉」已刪除的頁面——候選 0 筆，完全看不到死 id；
 *   只有 Notion 畫面與 MCP fetch 看得到。所以無法「挑出死 id 再刪」，
 *   改成：把 API 看得到的有效清單（＝全部存在的頁面）原樣寫回，覆蓋掉隱藏的死 id。
 *
 * 目標終態：名冊每個關聯欄只剩真實存在的頁面；有效關聯一筆不少。
 *
 * 安全設計：
 *   · 預設 dry-run；MODE=execute 才動手。SEAT=座號 可只處理一位（先試一位再全班）。
 *   · API 看得到的每個 id 都必須在目標庫現存列裡，否則中止（代表判讀前提不成立）。
 *   · 寫入前逐欄「重讀當下關聯」再寫回，避免蓋掉讀取後才新增的有效關聯。
 *   · 關聯用 property item 端點分頁讀全（頁面 GET 只給前 25 筆）。
 *   · 寫後回讀：每欄筆數與 id 集合必須與寫入前完全相同。
 *   · 死 id 是否真的消失，API 看不到——由 Claude 用 MCP fetch 回讀名冊頁驗收。
 *   · Actions log 公開可讀：不印姓名、座號、頁面內容，只印欄名與筆數。
 */

import { DS, apiOrThrow, queryAll, getSchema, propText, updatePage, isExecute } from "./lib/notion.mjs";

const EXECUTE = isExecute();
const SEAT = (process.env.SEAT ?? "").trim();
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

// ── 3. 名冊（可限定座號）與前提檢查 ─────────────────────
let roster = await queryAll(DS.roster);
if (SEAT) roster = roster.filter((p) => propText(p, "座號") === SEAT);
if (!roster.length) { console.error("❌ 名冊沒有符合的學生，中止"); process.exit(1); }
console.log(`範圍：${SEAT ? "單一學生" : "全班"} ${roster.length} 位\n`);

const plan = []; // { pageId, prop, ids }
let notLive = 0;
for (const p of roster) {
  for (const r of relProps) {
    const ids = await readRelation(p.id, r.id);
    notLive += ids.filter((id) => !live[r.target].has(id)).length;
    plan.push({ pageId: p.id, prop: r, ids });
  }
}
if (notLive) { console.error(`❌ API 讀到 ${notLive} 個不在目標庫的 id，與「API 會濾掉死 id」前提不符，中止`); process.exit(1); }

const byProp = {};
for (const c of plan) byProp[c.prop.name] = (byProp[c.prop.name] ?? 0) + c.ids.length;
console.log(`將原樣寫回 ${plan.length} 個關聯欄（有效 id 全數保留）：`);
for (const [name, n] of Object.entries(byProp)) console.log(`    · ${name}：有效 ${n} 筆`);

if (!EXECUTE) {
  console.log("\n🔍 DRY-RUN 結束，未異動任何資料。");
  console.log("   以 MODE=execute 重跑即寫回，覆蓋隱藏的死關聯。");
  process.exit(0);
}

// ── 4. 寫入：重讀當下關聯 → 原樣寫回 ────────────────────
console.log("\n開始寫回…\n");
let ok = 0;
const fail = [];
const expected = []; // { pageId, prop, keep }
for (const c of plan) {
  try {
    const keep = await readRelation(c.pageId, c.prop.id);
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

// ── 5. 回讀驗證：有效關聯一筆不少、不多 ─────────────────
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
  console.log(`結論：${ok} 個關聯欄已寫回，有效關聯零遺失。死 id 是否消失請以 MCP fetch 名冊頁驗收。`);
} else {
  console.log("結論：未完全寫回或有遺失，需檢查上列項目。");
  process.exit(1);
}
