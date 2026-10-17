/**
 * f51｜寫入日常＋作業（老師確認 f50 待審後才跑）
 * ───────────────────────────────────────────────────────────────
 * 把 f50 試算的國數社「○○日常」「○○作業」寫進「📚 學期成績庫」該學期＋階段每生一列。
 * 該生該階段還沒有列 → 新建（項目「115上期中_07」、學生 relation、學年都填）。
 * 沒有可算作業的科目不寫（保持空白，不填 0）；公式欄（○○平時／○○成績／平均）不碰；平考、期考、備註不碰。
 *
 * 用法：payload 填「115上期中 <f50 的指紋>」
 *   mode=dry-run：重算一次、比對指紋，只印「會新建／會更新／不變」人數
 *   mode=execute：指紋相同才寫；不同＝f50 之後紀錄庫有改過（或多過了一週）→ 擋下，請重跑 f50 給老師再看一次
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印人數與指紋，不印分數。
 */
import { queryAll, api, updatePage, forEachThrottled, isExecute, DS, propText } from "./lib/notion.mjs";
import { loadTermDailyHw, parsePayload } from "./lib/term-daily-hw-notion.mjs";
import { MAIN } from "./lib/term-daily-hw.mjs";

const rt = (s) => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const P = parsePayload(process.env.PAYLOAD);
if (!P) { console.log("❌ payload 要填「115上期中 <f50 指紋>」"); process.exit(1); }
const { term, stage, fp } = P;
const r = await loadTermDailyHw(term, stage);
if (r.error) { console.log(`❌ ${r.error}`); process.exit(1); }
console.log(`🔑 重算指紋 ${r.fp}；payload 指紋 ${fp ?? "（未填）"}（算到 ${r.asOf}，${r.weeks.length} 週）`);
const same = fp && fp === r.fp;

const grades = await queryAll(DS.termGrades);
const valuesOf = (x) => {
  const v = {};
  for (const s of MAIN) {
    if (x.daily[s] != null) v[`${s}日常`] = x.daily[s];
    if (x.hw[s].hw != null) v[`${s}作業`] = x.hw[s].hw;
  }
  return v;
};
const plan = [];
for (const x of r.rows) {
  const row = grades.find((p) => propText(p, "學期") === term && propText(p, "階段") === stage && p.properties?.座號?.number === x.seat);
  const v = valuesOf(x);
  if (!Object.keys(v).length) { plan.push({ kind: "same", seat: x.seat }); continue; }
  if (!row) {
    plan.push({ kind: "create", seat: x.seat, v, props: {
      ...Object.fromEntries(Object.entries(v).map(([k, n]) => [k, { number: n }])),
      "項目": { title: rt(`${term}${stage}_${String(x.seat).padStart(2, "0")}`) },
      "學期": { rich_text: rt(term) }, "階段": { select: { name: stage } },
      "座號": { number: x.seat }, "學生": { relation: [{ id: x.studentId }] }, "學年": { select: { name: r.year } },
    } });
    continue;
  }
  const changed = Object.entries(v).filter(([k, n]) => row.properties?.[k]?.number !== n);
  plan.push(changed.length
    ? { kind: "update", seat: x.seat, id: row.id, v, props: Object.fromEntries(changed.map(([k, n]) => [k, { number: n }])) }
    : { kind: "same", seat: x.seat });
}
const cnt = (k) => plan.filter((p) => p.kind === k).length;
console.log(`📋 ${term}${stage}：會新建 ${cnt("create")} 列／會更新 ${cnt("update")} 列／不變 ${cnt("same")} 列`);

if (!isExecute()) { console.log("\n🔍 dry-run：未寫入"); process.exit(0); }
if (!same) {
  console.log(`\n⛔ 指紋不同（或沒填）：f50 試算之後紀錄庫有變動或多算了一週。請重跑 f50（execute）讓老師看新的待審，再用新指紋跑本支。`);
  process.exit(1);
}
const todo = plan.filter((p) => p.kind !== "same");
const { ok, fail } = await forEachThrottled(todo, (p) => p.kind === "create"
  ? api("POST", "/pages", { parent: { type: "data_source_id", data_source_id: DS.termGrades }, properties: p.props })
  : updatePage(p.id, p.props));
console.log(`\n✅ 寫入成功 ${ok.length} 列；失敗 ${fail.length} 列`);
if (fail.length) {
  for (const f of fail) console.log(`   ❌ ${f.item.kind}：${f.r?.status ?? ""} ${f.r?.json?.message ?? f.error ?? ""}`);
  process.exit(1);
}
// 回讀：重撈一次，逐列比對日常／作業與應寫值相同
const back = await queryAll(DS.termGrades);
const bad = todo.filter((p) => {
  const row = back.find((b) => propText(b, "學期") === term && propText(b, "階段") === stage && b.properties?.座號?.number === p.seat);
  return !row || Object.entries(p.v).some(([k, n]) => row.properties?.[k]?.number !== n);
});
console.log(bad.length ? `⚠️ 回讀不符 ${bad.length} 列，請重跑 dry-run 檢查` : `🔁 回讀相符 ${todo.length} 列`);
if (bad.length) process.exit(1);
