/**
 * f49｜寫入平考（老師確認 f48 待審後才跑）
 * ───────────────────────────────────────────────────────────────
 * 把 f48 試算的國數社平時考平均寫進「📚 學期成績庫」該學期＋階段每生一列的「○○平考」，
 * 其他科平均寫進「備註」（只換掉「其他科平時考平均：」那一行，備註其他內容保留）。
 * 該生該階段還沒有列 → 新建（項目「115上期中_07」、學生 relation、學年都填）。
 * 沒有平時考的科目不寫（保持空白，不填 0）；公式欄（○○平時／○○成績／平均）不碰。
 *
 * 用法：payload 填「115上期中 <f48 的指紋>」
 *   mode=dry-run：重算一次、比對指紋，只印「會新建／會更新／不變」人數
 *   mode=execute：指紋相同才寫；不同＝f48 之後紀錄庫有改過 → 擋下，請重跑 f48 給老師再看一次
 * 另：學期欄以「（模擬）」開頭的測試列，dry-run 會印出它的公式欄結果（驗收平時比例公式用，非學生資料）。
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印人數與指紋，不印分數。
 */
import { queryAll, api, updatePage, forEachThrottled, isExecute, DS, propText } from "./lib/notion.mjs";
import { loadTermQuiz, parsePayload } from "./lib/term-quiz-notion.mjs";
import { MAIN } from "./lib/term-quiz.mjs";

const rt = (s) => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const grades = await queryAll(DS.termGrades);

// ── 模擬列公式回讀（MCP 讀不到公式結果，只能從官方 API 看）──
const mock = grades.filter((p) => propText(p, "學期").startsWith("（模擬）"));
for (const p of mock) {
  const f = (k) => p.properties?.[k]?.formula?.number ?? null;
  const n = (k) => p.properties?.[k]?.number ?? null;
  console.log(`🧪 模擬列 ${p.id.slice(-8)}：` + MAIN.map((s) =>
    `${s} 日常${n(`${s}日常`)} 作業${n(`${s}作業`)} 平考${n(`${s}平考`)} 期考${n(`${s}期考`)} → 平時${f(`${s}平時`)} 成績${f(`${s}成績`)}`).join("｜")
    + `｜平均${f("平均")}`);
}

const P = parsePayload(process.env.PAYLOAD);
if (!P) {
  if (mock.length) process.exit(0); // 只做公式回讀
  console.log("❌ payload 要填「115上期中 <f48 指紋>」"); process.exit(1);
}
const { term, stage, fp } = P;
const r = await loadTermQuiz(term, stage);
if (r.error) { console.log(`❌ ${r.error}`); process.exit(1); }
console.log(`🔑 重算指紋 ${r.fp}；payload 指紋 ${fp ?? "（未填）"}`);
const same = fp && fp === r.fp;

const NOTE_RE = /^其他科平時考平均：.*$/m;
const mergeNote = (old, line) => {
  const kept = String(old || "").replace(NOTE_RE, "").replace(/\n{2,}/g, "\n").trim();
  return [kept, line].filter(Boolean).join("\n");
};

const plan = [];
for (const x of r.rows) {
  const row = grades.find((p) => propText(p, "學期") === term && propText(p, "階段") === stage && p.properties?.座號?.number === x.seat);
  const props = {};
  for (const s of MAIN) if (x.avg[s] != null) props[`${s}平考`] = { number: x.avg[s] };
  const note = mergeNote(row ? propText(row, "備註") : "", x.note);
  if (note !== (row ? propText(row, "備註") : "")) props["備註"] = { rich_text: rt(note) };
  if (!row) {
    if (!Object.keys(props).length) continue;   // 沒任何平時考、也沒列 → 不建空列
    plan.push({ kind: "create", seat: x.seat, props: {
      ...props,
      "項目": { title: rt(`${term}${stage}_${String(x.seat).padStart(2, "0")}`) },
      "學期": { rich_text: rt(term) }, "階段": { select: { name: stage } },
      "座號": { number: x.seat }, "學生": { relation: [{ id: x.studentId }] }, "學年": { select: { name: r.year } },
    } });
    continue;
  }
  const changed = Object.entries(props).filter(([k, v]) =>
    k === "備註" || row.properties?.[k]?.number !== v.number);
  plan.push(changed.length ? { kind: "update", seat: x.seat, id: row.id, props: Object.fromEntries(changed) } : { kind: "same", seat: x.seat });
}
const cnt = (k) => plan.filter((p) => p.kind === k).length;
console.log(`📋 ${term}${stage}：會新建 ${cnt("create")} 列／會更新 ${cnt("update")} 列／不變 ${cnt("same")} 列`);

if (!isExecute()) { console.log("\n🔍 dry-run：未寫入"); process.exit(0); }
if (!same) {
  console.log(`\n⛔ 指紋不同（或沒填）：f48 試算之後紀錄庫有變動。請重跑 f48（execute）讓老師看新的待審，再用新指紋跑本支。`);
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
// 回讀：重撈一次，逐列比對平考與寫入值相同
const back = await queryAll(DS.termGrades);
const bad = todo.filter((p) => {
  const row = back.find((b) => propText(b, "學期") === term && propText(b, "階段") === stage && b.properties?.座號?.number === p.seat);
  return !row || MAIN.some((s) => p.props[`${s}平考`] && row.properties?.[`${s}平考`]?.number !== p.props[`${s}平考`].number);
});
console.log(bad.length ? `⚠️ 回讀不符 ${bad.length} 列，請重跑 dry-run 檢查` : `🔁 回讀相符 ${todo.length} 列`);
if (bad.length) process.exit(1);
