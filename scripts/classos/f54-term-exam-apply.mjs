/**
 * f54｜寫入期考（老師確認 f53 待審後才跑）
 * ───────────────────────────────────────────────────────────────
 * 把 f53 試算的國數社期考寫進「📚 學期成績庫」該學期＋階段每生一列的「○○期考」；
 * 缺考、沒紀錄、判不出的科目不寫（保持空白，不填 0）；公式欄（○○平時／○○成績／平均）不碰。
 * 該生該階段還沒有列 → 新建（項目「115上期中_07」、學生 relation、學年都填）。防重複鍵＝學期＋階段＋座號。
 *
 * 用法：payload 填「115上期中 <f53 的指紋>」
 *   mode=dry-run：重算、比對指紋，只印「會新建／會更新／不變」人數
 *   mode=execute：指紋相同才寫；不同＝f53 之後紀錄庫有改過 → 擋下，請重跑 f53 給老師再看一次
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印人數與指紋，不印分數。
 */
import { queryAll, api, updatePage, forEachThrottled, isExecute, DS, propText } from "./lib/notion.mjs";
import { parsePayload } from "./lib/term-quiz-notion.mjs";
import { loadTermExam } from "./lib/term-exam-notion.mjs";
import { MAIN } from "./lib/term-quiz.mjs";

const rt = (s) => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const P = parsePayload(process.env.PAYLOAD);
if (!P) { console.log("❌ payload 要填「115上期中 <f53 指紋>」"); process.exit(1); }
const { term, stage, fp } = P;
const r = await loadTermExam(term, stage);
if (r.error) { console.log(`❌ ${r.error}`); process.exit(1); }
console.log(`🔑 重算指紋 ${r.fp}；payload 指紋 ${fp ?? "（未填）"}`);
const same = fp && fp === r.fp;

const grades = await queryAll(DS.termGrades);
const rowOf = (list, seat) => list.find((p) => propText(p, "學期") === term && propText(p, "階段") === stage && p.properties?.座號?.number === seat);
const plan = [];
for (const x of r.rows) {
  const props = {};
  for (const s of MAIN) {
    const c = x.subjects[s];
    if (c && !c.absent && c.score != null) props[`${s}期考`] = { number: c.score };
  }
  const row = rowOf(grades, x.seat);
  if (!row) {
    if (!Object.keys(props).length) continue;
    plan.push({ kind: "create", seat: x.seat, props: {
      ...props,
      "項目": { title: rt(`${term}${stage}_${String(x.seat).padStart(2, "0")}`) },
      "學期": { rich_text: rt(term) }, "階段": { select: { name: stage } },
      "座號": { number: x.seat }, "學生": { relation: [{ id: r.studentId.get(x.seat) }] }, "學年": { select: { name: r.year } },
    } });
    continue;
  }
  const changed = Object.entries(props).filter(([k, v]) => row.properties?.[k]?.number !== v.number);
  plan.push(changed.length ? { kind: "update", seat: x.seat, id: row.id, props: Object.fromEntries(changed) } : { kind: "same", seat: x.seat });
}
const cnt = (k) => plan.filter((p) => p.kind === k).length;
console.log(`📋 ${term}${stage}：會新建 ${cnt("create")} 列／會更新 ${cnt("update")} 列／不變 ${cnt("same")} 列；判不出不寫 ${r.manual.length} 筆`);

if (!isExecute()) { console.log("\n🔍 dry-run：未寫入"); process.exit(0); }
if (!same) {
  console.log("\n⛔ 指紋不同（或沒填）：f53 試算之後紀錄庫有變動。請重跑 f53（execute）讓老師看新的待審，再用新指紋跑本支。");
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
// 回讀：重撈一次，逐列比對期考與寫入值相同
const back = await queryAll(DS.termGrades);
const bad = todo.filter((p) => {
  const row = rowOf(back, p.seat);
  return !row || MAIN.some((s) => p.props[`${s}期考`] && row.properties?.[`${s}期考`]?.number !== p.props[`${s}期考`].number);
});
console.log(bad.length ? `⚠️ 回讀不符 ${bad.length} 列，請重跑 dry-run 檢查` : `🔁 回讀相符 ${todo.length} 列`);
if (bad.length) process.exit(1);
