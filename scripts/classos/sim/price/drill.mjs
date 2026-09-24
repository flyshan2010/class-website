/**
 * 浮動調價演練（全假資料，零網路）：`node scripts/classos/sim/price/drill.mjs`
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
// 每一期每週一筆淨額＝W×27（排除學期第 1 週，跟 computeW 同定義）
function ledger(spec) {
  const rows = [];
  for (const [ym0, ym1, W] of spec)
    for (const w of allWeeks) if (w.週次 !== 1 && w.起 >= ym0 && w.起 <= ym1)
      rows.push({ id: `b-${w.起}`, properties: { "日期": { date: { start: w.起 } }, "金額": { number: W * 27 } } });
  return rows;
}
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
const SEP_OCT = ["2026-09-01", "2026-10-31"], NOV_DEC = ["2026-11-01", "2026-12-31"], FEB_MAR = ["2027-02-01", "2027-03-31"];

// ① 基準期：10/23 只記 W₀，不寫商店、不建公告
let f = fresh("s1", ledger([[...SEP_OCT, 45]]));
let out = run("f33-price-draft.mjs", "2026-10-23", f);
check("①10/23 基準期只記錄", /基準期：W₀＝45/.test(out) && st(f).writes.every(w => w.ds === DS.inbox || w.op === "update" && false),
  `writes=${JSON.stringify(st(f).writes.map(w => w.op + (w.ds === DS.inbox ? ":inbox" : "")))}`);
check("①收件匣狀態＝已完成", st(f).db[DS.inbox][0]?.properties["狀態"].select.name === "已完成");

// ② 非算價週：10/16 什麼都不做
f = fresh("s2", ledger([[...SEP_OCT, 45]]));
out = run("f33-price-draft.mjs", "2026-10-16", f);
check("②10/16 非算價週零寫入", st(f).writes.length === 0 && /不是算價週/.test(out));

// ③ 11–12 月算價：W 40→50，R＝1.25
f = fresh("s3", ledger([[...SEP_OCT, 40], [...NOV_DEC, 50]]));
out = run("f33-price-draft.mjs", "2026-12-25", f);
check("③12/25 R＝1.25", /R＝1\.25/.test(out));
check("③②層 100→125", N(f, "s-a") === 125 && P(f, "s-a") === 100);
check("③③層 150→190（187.5 四捨五入到 5）", N(f, "s-b") === 190);
check("③⑥層 540→675、⑤層 60→75", N(f, "s-e") === 675 && N(f, "s-f") === 75);
check("③對照組 ①④未上架 都沒寫", [N(f, "s-c"), N(f, "s-d"), N(f, "s-g")].every(v => v === null));
const ann = st(f).db[DS.announcements];
check("③公告一則，12/28 上架、12/31 下架", ann.length === 1 && ann[0].properties["日期"].date.start === "2026-12-28"
  && ann[0].properties["日期"].date.end === "2026-12-31", ann[0]?.properties["標題"].title[0].plain_text);
check("③收件匣＝待審", st(f).db[DS.inbox][0].properties["狀態"].select.name === "待審");
const w3 = st(f).writes.length;
run("f33-price-draft.mjs", "2026-12-25", f);
check("③重跑冪等：公告仍 1 則、收件匣仍 1 列、商店不重寫",
  st(f).db[DS.announcements].length === 1 && st(f).db[DS.inbox].length === 1
  && st(f).writes.slice(w3).filter(w => w.op === "update" && w.id.startsWith("s-")).length === 0);

// ④ 生效日前 12/31：f34 不動
const w4 = st(f).writes.length;
run("f34-price-apply.mjs", "2026-12-31", f);
check("④12/31 未到生效日零寫入", st(f).writes.length === w4 && P(f, "s-a") === 100);

// ⑤ 1/01 生效：價格改好、兩欄清空；再跑一次不改第二次
run("f34-price-apply.mjs", "2027-01-01", f);
check("⑤1/01 套用 100→125、540→675", P(f, "s-a") === 125 && P(f, "s-e") === 675 && N(f, "s-a") === null);
check("⑤對照組 ④ 仍 200、未上架仍 90", P(f, "s-d") === 200 && P(f, "s-g") === 90);
const w5 = st(f).writes.length;
run("f34-price-apply.mjs", "2027-01-01", f);
check("⑤重跑不改第二次", st(f).writes.length === w5 && P(f, "s-a") === 125);

// ⑥ 否決：勾否決 → 清空、價格不變、公告取消發布；f33 重跑也不再寫
f = fresh("s6", ledger([[...SEP_OCT, 40], [...NOV_DEC, 50]]));
run("f33-price-draft.mjs", "2026-12-25", f);
let s = st(f); s.db[DS.announcements][0].properties["否決調價"] = { checkbox: true }; writeFileSync(f, JSON.stringify(s));
run("f34-price-apply.mjs", "2026-12-29", f);
check("⑥否決：價格維持 100、兩欄清空", P(f, "s-a") === 100 && N(f, "s-a") === null);
check("⑥否決：公告取消發布", st(f).db[DS.announcements][0].properties["發布"].checkbox === false);
out = run("f33-price-draft.mjs", "2026-12-25", f);
check("⑥否決後 f33 重跑不再寫", /否決優先於重算/.test(out) && N(f, "s-a") === null);
run("f34-price-apply.mjs", "2027-01-01", f);
check("⑥否決後 1/01 價格仍 100", P(f, "s-a") === 100);

// ⑦ 死區：W 50→52，R＝1.04 不調
f = fresh("s7", ledger([[...SEP_OCT, 50], [...NOV_DEC, 52]]));
out = run("f33-price-draft.mjs", "2026-12-25", f);
check("⑦R＝1.04 不調", /R＝1\.04/.test(out) && N(f, "s-a") === null && st(f).db[DS.announcements].length === 0);

// ⑧ 資料不完整：上一期帳本全空 → W＝0 → 不調
f = fresh("s8", ledger([[...NOV_DEC, 50]]));
out = run("f33-price-draft.mjs", "2026-12-25", f);
check("⑧上一期無資料＝數字不完整不調", /數字不完整/.test(out) && N(f, "s-a") === null);

// ⑨ ±30% 上限：W 40→80（R＝2）→ 只漲 30%
f = fresh("s9", ledger([[...SEP_OCT, 40], [...NOV_DEC, 80]]));
run("f33-price-draft.mjs", "2026-12-25", f);
check("⑨R＝2 夾到 1.3：100→130", N(f, "s-a") === 130);

// ⑩ 下學期 2–3 月（跨西元年找上一期 11–12）：W 50→60，4/01 生效
const calc23 = allWeeks.filter(w => w.起 >= FEB_MAR[0] && w.起 <= FEB_MAR[1]).slice(-2)[0];
const fri23 = new Date(Date.parse(calc23.起 + "T00:00:00Z") + 4 * 864e5).toISOString().slice(0, 10);
f = fresh("s10", ledger([[...NOV_DEC, 50], [...FEB_MAR, 60]]));
out = run("f33-price-draft.mjs", fri23, f);
check(`⑩${fri23} 算 2–3 月 R＝1.20、4/01 生效`, /R＝1\.20/.test(out) && price(f, "s-a")["調價生效日"]?.date.start === "2027-04-01");

// ⑫ 消費不算進 W：同 ③ 但 11–12 月每週另有一筆大額消費，R 必須仍是 1.25
{
  const led = ledger([[...SEP_OCT, 40], [...NOV_DEC, 50]]);
  for (const r of led.filter(r => r.id >= "b-2026-11")) led.push({ id: r.id + "-spend",
    properties: { ...r.properties, "金額": { number: -30 * 27 }, "類型": { select: { name: "消費" } } } });
  f = fresh("s12", led);
  out = run("f33-price-draft.mjs", "2026-12-25", f);
  check("⑫大量消費不拉低 W（R 仍 1.25）", /R＝1\.25/.test(out));
}

// ⑪ dry-run 零寫入（正式 workflow 手動跑的預設模式）
f = fresh("s11", ledger([[...SEP_OCT, 40], [...NOV_DEC, 50]]));
run("f33-price-draft.mjs", "2026-12-25", f, "dry-run");
check("⑪dry-run 零寫入", st(f).writes.length === 0);

console.log(`\n總計 ${pass + failN} 項／失敗 ${failN} 項`);
process.exit(failN ? 1 : 0);
