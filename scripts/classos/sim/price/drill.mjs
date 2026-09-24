/**
 * 浮動調價演練（全假資料，零網路；2026-09-24 改達標觸發制）：`node scripts/classos/sim/price/drill.mjs`
 * 每個情境自建一份假 Notion 狀態 → 以假日期跑正式的 f33／f34（程式本體一字不改）→ 檢查結果。
 * 對照組：情境裡刻意放「不該被調」的品項（① 免費、④ 沙盒、未上架），看它們前後同數字。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DS } from "../../lib/notion.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "../../../..");
const weeks = JSON.parse(readFileSync(path.join(ROOT, "data/weeks.json"), "utf8"));
const allWeeks = weeks.學期.flatMap(t => t.週);
const DIR = mkdtempSync(path.join(tmpdir(), "price-drill-"));

const T = s => ({ title: [{ plain_text: s }] });
const item = (id, name, price, tier, on = true) => ({ id, properties: {
  "品項": T(name), "價格": { number: price }, "層級": { select: { name: tier } }, "上架": { checkbox: on } } });
const STORE = () => [
  item("s-a", "免午休券", 100, "② 活動特權・消費型"),
  item("s-b", "小老師徽章", 150, "③ 職務公會・解鎖型"),
  item("s-c", "擊掌", 0, "① 社會性・免費即時"),          // 對照：免費不調
  item("s-d", "提案新規則", 200, "④ 創造沙盒・系統演化"),  // 對照：④ 不調
  item("s-e", "一節自由活動時間", 540, "⑥ 全班集資・共同達成"),
  item("s-f", "貼紙", 60, "⑤ 實物兌換・最後手段"),
  item("s-g", "舊品項", 90, "② 活動特權・消費型", false), // 對照：未上架不調
];
// 每週一筆淨額＝W×27（W 由 fn(週起) 給；排除學期第 1 週，跟 evaluate 同定義）
function ledger(fn) {
  const rows = [];
  for (const w of allWeeks) if (w.週次 !== 1) { const W = fn(w.起); if (W) rows.push({ id: `b-${w.起}`,
    properties: { "日期": { date: { start: w.起 } }, "金額": { number: W * 27 } } }); }
  return rows;
}
const step = (...pairs) => d => { let v = 0; for (const [from, W] of pairs) if (d >= from) v = W; return v; };
const fri = start => allWeeks.find(w => w.起 === start).上課迄;   // 某週的最後上課日（週結日）
const roster = Array.from({ length: 27 }, (_, i) => ({ id: `r${i}`, properties: { "在學": { checkbox: true } } }));
function fresh(name, led) {
  const f = path.join(DIR, `${name}.json`);
  writeFileSync(f, JSON.stringify({ seq: 1, writes: [], db: {
    [DS.roster]: roster, [DS.bank]: led, [DS.store]: STORE(), [DS.announcements]: [], [DS.inbox]: [] } }));
  return f;
}
const run = (script, today, state, mode = "execute") => execFileSync("node",
  ["--import", path.join(HERE, "hooks.mjs"), path.join(ROOT, `scripts/classos/${script}`)],
  { env: { ...process.env, SIM_TODAY: today, SIM_STATE: state, MODE: mode, NOTION_TOKEN: "" }, encoding: "utf8" });
const st = f => JSON.parse(readFileSync(f, "utf8"));
const price = (f, id) => st(f).db[DS.store].find(r => r.id === id).properties;
const P = (f, id) => price(f, id)["價格"].number;
const N = (f, id) => price(f, id)["下期價格"]?.number ?? null;

let pass = 0, failN = 0;
const check = (name, cond, extra = "") => { cond ? pass++ : failN++; console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `｜${extra}` : ""}`); };
const onlyInbox = f => st(f).writes.every(w => w.ds === DS.inbox);
const inboxStatus = f => st(f).db[DS.inbox].at(-1)?.properties["狀態"].select.name;
// 基準 45；11/02 那週起 60（第 2 個高週＝11/20 首次達標、11/27 連續第 2 週 → 12/07 生效）
const RISE = step(["2026-09-07", 45], ["2026-11-02", 60]);

// ① 監測期：10/05 起就漲，10/30 已連續達標，但 10/31 前只記錄
let f = fresh("s1", ledger(step(["2026-09-07", 45], ["2026-10-05", 60])));
let out = run("f33-price-draft.mjs", "2026-10-30", f);
check("①10/30 監測期連續達標只記錄", /監測期/.test(out) && onlyInbox(f) && inboxStatus(f) === "已完成", out.split("\n")[0]);

// ② 未達標：一直 45
f = fresh("s2", ledger(step(["2026-09-07", 45])));
out = run("f33-price-draft.mjs", "2026-11-27", f);
check("②R＝1.00 未達標、只寫收件匣", /R＝1\.00，在/.test(out) && onlyInbox(f));

// ③ 達標第 1 週不調；連續第 2 週才調
f = fresh("s3", ledger(RISE));
out = run("f33-price-draft.mjs", "2026-11-20", f);
check("③11/20 達標第 1 週不調", /第 1 週/.test(out) && onlyInbox(f), out.split("\n")[0]);
out = run("f33-price-draft.mjs", "2026-11-27", f);
check("③11/27 連續 2 週 R＝1.33 → 12/07 生效", /R＝1\.33 連續 2 週達標（漲）→ 2026-12-07 生效/.test(out), out.split("\n")[0]);
check("③R＝1.33 夾到 1.3：②層 100→130、價格本身不動", N(f, "s-a") === 130 && P(f, "s-a") === 100);
check("③③層 150→195、⑥層 540→700（702 到 5）、⑤層 60→80（78 到 5）", N(f, "s-b") === 195 && N(f, "s-e") === 700 && N(f, "s-f") === 80);
check("③對照組 ①④未上架 都沒寫", [N(f, "s-c"), N(f, "s-d"), N(f, "s-g")].every(v => v === null));
const ann = st(f).db[DS.announcements];
check("③公告一則，11/30 上架、12/06 下架", ann.length === 1 && ann[0].properties["日期"].date.start === "2026-11-30"
  && ann[0].properties["日期"].date.end === "2026-12-06", ann[0]?.properties["標題"].title[0].plain_text);
check("③收件匣＝待審", inboxStatus(f) === "待審");
const w3 = st(f).writes.length, inbox3 = st(f).db[DS.inbox].length;
run("f33-price-draft.mjs", "2026-11-27", f);
check("③同日重跑冪等：公告 1 則、收件匣不增、商店不重寫、仍待審",
  st(f).db[DS.announcements].length === 1 && st(f).db[DS.inbox].length === inbox3 && inboxStatus(f) === "待審"
  && st(f).writes.slice(w3).filter(w => w.op === "update" && w.id.startsWith("s-")).length === 0);
out = run("f33-price-draft.mjs", "2026-12-04", f);
check("③下週 12/04：已有待生效調價，只記錄", /已有待生效/.test(out) && N(f, "s-a") === 130);

// ④ f34：生效日前不動、12/07 套用、重跑不改第二次
const w4 = st(f).writes.length;
run("f34-price-apply.mjs", "2026-12-06", f);
check("④12/06 未到生效日零寫入", st(f).writes.length === w4 && P(f, "s-a") === 100);
run("f34-price-apply.mjs", "2026-12-07", f);
check("④12/07 套用 100→130、540→700，兩欄清空", P(f, "s-a") === 130 && P(f, "s-e") === 700 && N(f, "s-a") === null);
check("④對照組 ④ 仍 200、未上架仍 90", P(f, "s-d") === 200 && P(f, "s-g") === 90);
const w4b = st(f).writes.length;
run("f34-price-apply.mjs", "2026-12-07", f);
check("④重跑不改第二次", st(f).writes.length === w4b && P(f, "s-a") === 130);

// ⑤ 調價後：W_ref 換成上次定價時的 M（60），冷卻 4 週內再達標也不調，滿 4 週才調
{
  const g = fresh("s5", ledger(step(["2026-09-07", 45], ["2026-11-02", 60], ["2026-11-30", 80])));
  run("f33-price-draft.mjs", "2026-11-27", g); run("f34-price-apply.mjs", "2026-12-07", g);
  out = run("f33-price-draft.mjs", "2026-12-11", g);
  check("⑤12/11 W_ref＝60（上次定價）、R＝1.00", /上次定價（2026-12-07 生效） W＝60｜R＝1\.00/.test(out), out.split("\n")[1]);
  out = run("f33-price-draft.mjs", "2026-12-25", g);
  check("⑤12/25 連續達標但冷卻中（12/07＋4 週）不調", /冷卻中/.test(out) && N(g, "s-a") === null);
  const jan = allWeeks.find(w => w.起 >= "2027-01-04");
  out = run("f33-price-draft.mjs", fri(jan.起), g);
  check(`⑤${fri(jan.起)} 滿 4 週 → 130→170`, /連續 2 週達標（漲）/.test(out) && N(g, "s-a") === 170, out.split("\n")[0]);
}

// ⑥ 否決：勾否決 → 清空、價格不變、公告取消發布；f33 重跑不再寫；之後 4 週冷卻
f = fresh("s6", ledger(RISE));
run("f33-price-draft.mjs", "2026-11-27", f);
let s = st(f); s.db[DS.announcements][0].properties["否決調價"] = { checkbox: true }; writeFileSync(f, JSON.stringify(s));
run("f34-price-apply.mjs", "2026-11-30", f);
check("⑥否決：價格維持 100、兩欄清空", P(f, "s-a") === 100 && N(f, "s-a") === null);
check("⑥否決：公告取消發布", st(f).db[DS.announcements][0].properties["發布"].checkbox === false);
out = run("f33-price-draft.mjs", "2026-11-27", f);
check("⑥否決後同日重跑不再寫", /否決優先於重算/.test(out) && N(f, "s-a") === null);
out = run("f33-price-draft.mjs", "2026-12-04", f);
check("⑥否決後下週仍達標＝冷卻不調", /已否決.*冷卻中/.test(out) && N(f, "s-a") === null);

// ⑦ 跌：45→30，R＝0.67 夾到 0.7：100→70
f = fresh("s7", ledger(step(["2026-09-07", 45], ["2026-11-02", 30])));
out = run("f33-price-draft.mjs", "2026-11-27", f);
check("⑦跌 R＝0.67 夾到 0.70：100→70", /（跌）/.test(out) && N(f, "s-a") === 70, out.split("\n")[0]);

// ⑧ 資料不完整：帳本全空
f = fresh("s8", ledger(() => 0));
out = run("f33-price-draft.mjs", "2026-11-27", f);
check("⑧帳本全空＝數字不完整不調", /數字不完整/.test(out) && onlyInbox(f));

// ⑨ ±30% 上限：45→90（R＝2）→ 只漲 30%
f = fresh("s9", ledger(step(["2026-09-07", 45], ["2026-11-02", 90])));
run("f33-price-draft.mjs", "2026-11-27", f);
check("⑨R＝2 夾到 1.3：100→130", N(f, "s-a") === 130);

// ⑩ 4–5 月照調；⑪ 生效日進 6 月不調
{
  const sem2 = allWeeks.filter(w => w.起 >= "2027-02-01");
  const aprW = sem2.find(w => w.起 >= "2027-04-05"), mayW = sem2.find(w => w.起 >= "2027-05-03");
  const i = sem2.indexOf(aprW), j = sem2.indexOf(mayW);
  f = fresh("s10", ledger(step(["2026-09-07", 45], [aprW.起, 60])));
  out = run("f33-price-draft.mjs", fri(sem2[i + 3].起), f);
  check(`⑩${fri(sem2[i + 3].起)} 4 月連續達標照調`, /→ 2027-0[45]-\d\d 生效/.test(out) && N(f, "s-a") === 130, out.split("\n")[0]);
  f = fresh("s11", ledger(step(["2026-09-07", 45], [mayW.起, 60])));
  const last = sem2.slice(j).map(w => run("f33-price-draft.mjs", fri(w.起), f)).join("\n");
  check("⑪5 月起漲：生效日進 6 月那週起不調、商店零寫入", /已進 6 月/.test(last) && N(f, "s-a") === null
    && st(f).db[DS.announcements].every(a => a.properties["標題"].title[0].plain_text < "🏪 商店調價預告｜2027-06"));
}

// ⑫ 消費不算進 W：同 ③ 但 11 月起每週另有一筆大額消費，R 必須仍是 1.33
{
  const led = ledger(RISE);
  for (const r of led.filter(r => r.id >= "b-2026-11")) led.push({ id: r.id + "-spend",
    properties: { ...r.properties, "金額": { number: -30 * 27 }, "類型": { select: { name: "消費" } } } });
  f = fresh("s12", led);
  out = run("f33-price-draft.mjs", "2026-11-27", f);
  check("⑫大量消費不拉低 W（R 仍 1.33）", /R＝1\.33 連續/.test(out));
}

// ⑬ dry-run 零寫入（正式 workflow 手動跑的預設模式）
f = fresh("s13", ledger(RISE));
run("f33-price-draft.mjs", "2026-11-27", f, "dry-run");
check("⑬dry-run 零寫入", st(f).writes.length === 0);

console.log(`\n總計 ${pass + failN} 項／失敗 ${failN} 項`);
process.exit(failN ? 1 : 0);
