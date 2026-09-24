/**
 * f33｜浮動調價：達標就寫草稿（SPEC_班級經濟機制 §3、§4；2026-09-24 施工，同日改達標觸發制）
 * ───────────────────────────────────────────────────────────────
 * 每週五週結試算（weekly-settle.yml）跑完 f24 之後接著跑，**每週都檢查一次**：
 *   判斷全在 lib/price.mjs 的 evaluate()（近 4 週中位數÷上次定價時的 W，±15% 連續 2 週達標，
 *   冷卻 4 週、10/31 前監測期只記錄、6 月不生效）——本檔只負責讀資料、寫草稿。
 *
 * 動作（預設生效、公告週內可否決；§4 開頭說明為何可作 U53 例外）：
 *   ① 不調 → 收件匣留一列「調價監測 日期」（已完成），沉默也要可查
 *   ② 要調 → ②③⑤⑥ 層各品項寫「下期價格／調價生效日」＋建一則公告（下週一上架、生效日前一天下架）
 *      ＋收件匣那列改「待審」附對照表與否決方法
 * 真正改「價格」的是 f34（sync.yml 同步前跑），本腳本永遠不動「價格」欄。
 *
 * 冪等：同一天重跑只刷新同一則公告、同一列收件匣與同樣的兩欄；公告已被勾「否決調價」就不再寫。
 *
 * 用法：MODE=dry-run（預設，只印）／execute（寫入）；F33_TODAY=yyyy-mm-dd 假日期只在 dry-run 生效。
 * ⚠️ 本 repo 為 PUBLIC：只印品項與價格（本來就公開在 store.json），不印任何學生資料。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryAll, api, updatePage, isExecute, DS } from "./lib/notion.mjs";
import { evaluate, newPrice, tierAdjustable, announceTitle, effOfTitle, addDays, clampR, MAX_STEP } from "./lib/price.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJSON = async f => JSON.parse(await readFile(path.join(ROOT, "data", f), "utf8"));
const rt = s => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const num = (p, k) => p.properties?.[k]?.number ?? null;
const title = (p, k) => (p.properties?.[k]?.title ?? []).map(t => t.plain_text).join("");
const dateOf = (p, k) => (p.properties?.[k]?.date?.start ?? "").slice(0, 10);

const AS_OF = !isExecute() && /^\d{4}-\d{2}-\d{2}$/.test(process.env.F33_TODAY || "") ? process.env.F33_TODAY : "";
const today = AS_OF || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
if (AS_OF) console.log(`🕰️ 假日期演練（只讀）：以 ${AS_OF} 當作「今天」`);

// ── 讀資料（任何一庫撈失敗 apiOrThrow 會丟例外 → 腳本失敗、零寫入＝fail-closed）──
const weeksFile = await readJSON("weeks.json");
const roster = (await queryAll(DS.roster)).filter(p => p.properties?.["在學"]?.checkbox);
const ledgerRows = (await queryAll(DS.bank)).map(b => ({ date: dateOf(b, "日期"), amount: num(b, "金額") ?? 0,
  type: b.properties?.["類型"]?.select?.name ?? "" }));
const annPages = (await queryAll(DS.announcements)).filter(p => effOfTitle(title(p, "標題")));
const anns = annPages.map(p => ({ eff: effOfTitle(title(p, "標題")), vetoed: !!p.properties?.["否決調價"]?.checkbox }));

const ev = evaluate({ ledgerRows, weeksFile, rosterN: roster.length, today, anns });
console.log(`📈 ${today}｜${ev.verdict}\n${ev.line}`);
if (!ev.week) process.exit(0);
const YEAR = ev.week.學年;
const wLine = `${ev.line}（在學 ${roster.length} 人）`;

const inboxTitle = `調價監測 ${today}（自動・${YEAR} 學年）`;
async function upsertInbox(status, body) {
  console.log(`\n【${inboxTitle}】狀態＝${status}\n${body}`);
  if (!isExecute()) { console.log("\n🔍 dry-run：未寫入任何資料"); return; }
  const old = (await queryAll(DS.inbox)).find(p => title(p, "任務原文") === inboxTitle);
  const props = { "執行紀錄": { rich_text: rt(body) }, "狀態": { select: { name: status } } };
  const r = old ? await updatePage(old.id, props)
    : await api("POST", "/pages", { parent: { type: "data_source_id", data_source_id: DS.inbox }, properties: {
      ...props, "任務原文": { title: rt(inboxTitle) }, "路由ID": { rich_text: rt("R03") },
      "任務類型": { select: { name: "週結" } }, "學年": { select: { name: YEAR } } } });
  if (!r.ok) { console.error(`❌ 收件匣寫入失敗：${r.status} ${r.json?.message ?? ""}`); process.exit(1); }
  console.log(`✅ 收件匣${old ? "已刷新" : "已新增"}（${status}）`);
}

if (!ev.act) { await upsertInbox("已完成", `${ev.verdict}\n${wLine}`); process.exit(0); }

// ── 要調：算新價 ────────────────────────────────────────────
const { R, eff: effDate, annFrom } = ev;
const annTitle = announceTitle(effDate);
const anns2 = annPages.filter(p => title(p, "標題") === annTitle);
if (anns2.some(p => p.properties?.["否決調價"]?.checkbox)) {
  console.log(`🛑 ${annTitle} 已被老師勾「否決調價」——不再寫入（否決優先於重算）`);
  process.exit(0);
}
const store = (await queryAll(DS.store)).filter(p => p.properties?.["上架"]?.checkbox
  && (num(p, "價格") ?? 0) > 0 && tierAdjustable(p.properties?.["層級"]?.select?.name));
const plan = store.map(p => ({ p, name: title(p, "品項"), old: num(p, "價格"), neu: newPrice(num(p, "價格"), R) }))
  .filter(x => x.neu !== x.old)
  .sort((a, b) => a.old - b.old);
const clamped = clampR(R) !== R ? `（超過 ±${MAX_STEP * 100}%，以 ${clampR(R).toFixed(2)} 倍計）` : "";
if (!plan.length) { await upsertInbox("已完成", `R＝${R.toFixed(2)} 達標，但各品項捨入到 5 的倍數後都沒變，不調\n${wLine}`); process.exit(0); }

const table = plan.map(x => `${x.name}｜${x.old} → ${x.neu}`).join("\n");
const annTo = addDays(effDate, -1);             // 生效日前一天下架
const annBody = `大家最近 4 週平均一週賺 ${ev.M} 幣，是上次定價時（${ev.Wref} 幣）的 ${R.toFixed(2)} 倍${clamped}，`
  + `而且連續 2 週都${R > 1 ? "超過 1.15 倍" : "低於 0.85 倍"}，`
  + `所以商店價格跟著變成約 ${clampR(R).toFixed(2)} 倍（四捨五入到 5 的倍數）。\n`
  + `${effDate.slice(5).replace("-", "/")} 起的新價格：\n${table}\n`
  + `已經買到手、還沒用的券不受影響；在那之前申請的，也照現在的價格。`;
const inboxBody = `【要調價・預設 ${effDate} 生效】R＝${R.toFixed(2)}${clamped}\n${wLine}\n`
  + `對照表（${plan.length} 項，只調 ②③⑤⑥ 層）：\n${table}\n`
  + `公告「${annTitle}」${annFrom} 上架、${annTo} 下架。\n`
  + `✅ 同意：什麼都不用做，${effDate} 早上 07:00 同步時自動生效。\n`
  + `🛑 不同意：到 📣 公告打開那則，勾「否決調價」——這次全部不調（${annTo} 前勾都有效；否決後 4 週內不再調）。`;

console.log(`\n📋 預告公告「${annTitle}」${annFrom}～${annTo}\n${annBody}`);
if (isExecute()) {
  let fail = 0;
  for (const x of plan) {
    if (num(x.p, "下期價格") === x.neu && dateOf(x.p, "調價生效日") === effDate) continue;   // 重跑：已寫過
    const r = await updatePage(x.p.id, { "下期價格": { number: x.neu }, "調價生效日": { date: { start: effDate } } });
    if (!r.ok) { fail++; console.error(`❌ ${x.name} 寫入失敗：${r.status}`); }
  }
  // 重跑時 R 變了、某品項這次捨入後不調了 → 把上次寫的草稿清掉，免得生效日照舊值套用
  const inPlan = new Set(plan.map(x => x.p.id));
  for (const p of store) {
    if (inPlan.has(p.id) || dateOf(p, "調價生效日") !== effDate) continue;
    const r = await updatePage(p.id, { "下期價格": { number: null }, "調價生效日": { date: null } });
    if (!r.ok) { fail++; console.error(`❌ ${title(p, "品項")} 清除舊草稿失敗：${r.status}`); }
  }
  const annProps = {
    "內容": { rich_text: rt(annBody) }, "日期": { date: { start: annFrom, end: annTo } },
    "發布": { checkbox: true }, "來源": { select: { name: "班級" } }, "分類": { select: { name: "公告" } },
  };
  const ar = anns2.length ? await updatePage(anns2[0].id, annProps)
    : await api("POST", "/pages", { parent: { type: "data_source_id", data_source_id: DS.announcements },
      properties: { ...annProps, "標題": { title: rt(annTitle) } } });
  if (!ar.ok) { fail++; console.error(`❌ 公告寫入失敗：${ar.status} ${ar.json?.message ?? ""}`); }
  if (fail) {
    await upsertInbox("失敗", `${inboxBody}\n⚠️ 有 ${fail} 筆寫入失敗，請看 Actions log；已寫入的「下期價格」仍會在生效日套用，請老師確認或勾否決。`);
    process.exit(1);
  }
}
await upsertInbox("待審", inboxBody);
