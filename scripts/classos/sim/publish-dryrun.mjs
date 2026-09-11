/**
 * week-publish「週結寫回紀錄庫＋班規⑦」乾跑驗收（只讀，2026-09-12）
 *
 * 用本週真實資料模擬「尚未週結」（隱藏本週帳列），疊加檢核台會送出的 ⑦ 類事件（照 R18 規則轉成紀錄列），然後：
 *   1 R18 轉換：⑦ 幣值核對 class-rules.json、欄位型別與選項對 Notion schema
 *   2 f24 試算：⑦ 事件進 ②、無故缺席扣打掃薪水、沒補做扣常規獎勵、未達標 ≥3 出現 ⑦ −5
 *   3 照 class-bank／week-publish SKILL 算出要寫的紀錄列＋帳列（不寫），金額與 f24 ②⑥⑦ 逐項核對、schema 驗證
 *   4 把計畫寫入的列疊回去重跑：f24 待入帳歸零、week-publish 0 筆新寫入
 *   5 防重複兩條護欄的必要性：③ 事件描述含次數（第 4 次未達標）、施工前的舊帳（真實第2週 ④）
 * **全程不寫 Notion**。⚠️ PUBLIC repo：只印座號、筆數、金額。
 */
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { queryAll, getSchema, DS } from "../lib/notion.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "../../..");
const num = (p, k) => p.properties?.[k]?.number ?? null;
const sel = (p, k) => p.properties?.[k]?.select?.name ?? "";
const anyText = (p, k) => ((p.properties?.[k]?.title ?? p.properties?.[k]?.rich_text ?? [])).map(t => t.plain_text).join("");
const relIds = (p, k) => (p.properties?.[k]?.relation ?? []).map(r => r.id);
const dateOf = (p, k) => (p.properties?.[k]?.date?.start ?? "").slice(0, 10);
const seatsOf = s => String(s ?? "").split(/[,、，\s]+/).map(x => x.trim()).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n > 0);
const yearOf = d => String(Number(d.slice(0, 4)) - 1911 - (Number(d.slice(5, 7)) < 8 ? 1 : 0));
const T = s => [{ plain_text: s, text: { content: s } }];
const nid = id => String(id).replace(/-/g, "");
let seq = 0;
const fid = () => `00000000-7777-4000-8000-${String(++seq).padStart(12, "0")}`;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "✅" : "❌"} ${msg}`); if (!ok) fails++; };

// ── 本週 ──────────────────────────────────────────────────────
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
const weeks = JSON.parse(await readFile(path.join(ROOT, "data", "weeks.json"), "utf8"));
let wk = null;
for (const t of weeks.學期 ?? []) {
  const w = (t.週 ?? []).find(w => (today >= w.起 && today <= w.迄) || w.預排日?.includes(today));
  if (w) { wk = w; break; }
}
if (!wk) { console.log("今天不在上課週，不驗收"); process.exit(0); }
const LABEL = wk.標籤, N = wk.週次;
const m = String(LABEL).match(/-(\d+)\/(\d+)\)/);
const END = `${Number(wk.起.slice(0, 4)) + (Number(m[1]) < Number(wk.起.slice(5, 7)) ? 1 : 0)}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
const YEAR = yearOf(END);
const days = Array.from({ length: 5 }, (_, i) => { const d = new Date(`${wk.起}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
console.log(`📅 ${LABEL}｜寫回日期 ${END}｜學年 ${YEAR}`);

const roster = (await queryAll(DS.roster)).filter(p => p.properties?.["在學"]?.checkbox)
  .map(p => ({ id: p.id, seat: num(p, "座號") })).filter(r => Number.isFinite(r.seat));
const idOf = new Map(roster.map(r => [r.seat, r.id]));
const seatOf = new Map(roster.map(r => [nid(r.id), r.seat]));
const seatOfId = id => seatOf.get(nid(id));
const [logSchema, bankSchema] = await Promise.all([getSchema(DS.log), getSchema(DS.bank)]);
const rules = JSON.parse(await readFile(path.join(ROOT, "data", "class-rules.json"), "utf8")).cards;
const card = n => rules.find(c => Number(c.n) === n);
const allLogs = await queryAll(DS.log);
const weekLogs = allLogs.filter(p => anyText(p, "週次") === LABEL);
const bank = await queryAll(DS.bank);
const cleaners = [...new Set((await queryAll(DS.duties))
  .filter(d => d.properties?.["顯示"]?.checkbox && sel(d, "類型") === "打掃")
  .flatMap(d => seatsOf(anyText(d, "成員座號"))))].filter(s => idOf.has(s)).sort((a, b) => a - b);
const mine = (p, s) => relIds(p, "學生").some(id => seatOfId(id) === s);
const titleOf = p => anyText(p, "事件描述");

// ── 1 檢核台事件 → R18 紀錄列 ─────────────────────────────────
console.log("\n== 1 檢核台事件照 R18 規則入庫 ==");
const has = (s, title, d) => weekLogs.some(p => titleOf(p) === title && dateOf(p, "日期") === d && mine(p, s));
const A = cleaners.find(s => !has(s, "打掃缺席", days[2]));
const B = roster.map(r => r.seat).find(s => s !== A && !has(s, "常規未達成", days[3]));
const C = cleaners.find(s => s !== A && s !== B && !weekLogs.some(p => titleOf(p) === "打掃未達標" && mine(p, s)));
const i7a = (card(7)?.bad ?? []).findIndex(a => a.act === "答應的工作或幹部職務擺爛");
const i7b = (card(7)?.bad ?? []).findIndex(a => a.act === "常規沒做到、也不肯重做");
check(i7a >= 0 && i7b >= 0, `班規⑦ 兩行都在 class-rules.json（act_i ${i7a}、${i7b}）`);
const ruleEv = (seat, date, i, period, tool) => ({ tool, date, seat, src: "rule", rule_n: 7, kind: "bad", act_i: i,
  act: card(7).bad[i].act, coin: card(7).bad[i].coin, level: card(7).bad[i].level, period });
const events = [
  { tool: "cleanup", date: days[2], seat: A, src: "tally", kind: "neutral", act: "打掃缺席", period: "環境晨掃", note: "無故" },
  ruleEv(A, days[2], i7a, "環境晨掃", "cleanup"),
  { tool: "teeth", date: days[3], seat: B, src: "tally", kind: "bad", act: "常規未達成", period: "午餐潔牙", note: "沒潔牙，未補做" },
  ruleEv(B, days[3], i7b, "午餐潔牙", "teeth"),
  ...[0, 1, 2].map(i => ({ tool: "cleanup", date: days[i], seat: C, src: "tally", kind: "bad", act: "打掃未達標", period: "環境晨掃" })),
];
console.log(`情境：座號 ${A} 無故沒打掃（${days[2]}）、座號 ${B} 沒潔牙也沒補做（${days[3]}）、座號 ${C} 本週 3 次打掃未達標`);
const RULE_CAT = { 1: "生活指導", 2: "人際互動", 3: "生活技能", 4: "作業", 5: "課堂表現", 6: "生活指導", 7: "生活指導", 8: "人際互動", 9: "課堂表現", 10: "生活指導" };
function r18(ev) {
  let coin = 0, level = null, title = ev.act;
  if (ev.src === "rule") {
    const a = card(ev.rule_n)?.bad?.[ev.act_i];
    if (!a || a.coin !== ev.coin || a.level !== ev.level) return { error: "E07" };
    coin = Number(String(ev.coin).replace("−", "-"));
    level = Math.abs(ev.level);
    title = `${card(ev.rule_n).rule.replace(/\s+/g, "")}－${ev.act}（${ev.period}）`;
  }
  const cat = ev.src === "rule" ? RULE_CAT[ev.rule_n]
    : /打掃|午餐/.test(ev.act) ? "生活技能" : /作業/.test(ev.act) ? "作業" : ev.act === "常規未達成" ? "生活指導" : "需人工";
  const eid = `${ev.tool}-${ev.date.replace(/-/g, "")}-s${ev.seat}-${ev.src === "rule" ? `r${ev.rule_n}b.${ev.act_i}` : `t.${ev.act}`}`;
  return { id: fid(), properties: {
    事件描述: { title: T(title) }, 事件id: { rich_text: T(eid) }, 學生: { relation: [{ id: idOf.get(ev.seat) }] },
    日期: { date: { start: ev.date } }, 週次: { rich_text: T(LABEL) }, 學年: { select: { name: yearOf(ev.date) } },
    類別: { select: { name: cat } }, 正負向: { select: { name: { bad: "－", good: "＋", neutral: "中性" }[ev.kind] } },
    程度: { number: level }, 金幣影響: { number: coin }, 次數: { number: 1 },
    ...(ev.note ? { 備註: { rich_text: T(ev.note) } } : {}),
  } };
}
function validate(page, schema) {
  const bad = [];
  for (const [k, v] of Object.entries(page.properties)) {
    const s = schema[k];
    if (!s) { bad.push(`${k}：欄位不存在`); continue; }
    const t = Object.keys(v)[0];
    if (s.type !== t) { bad.push(`${k}：型別 ${t}≠${s.type}`); continue; }
    if (t === "select" && !(s.select?.options ?? []).some(o => o.name === v.select.name)) bad.push(`${k}：選項「${v.select.name}」不存在`);
    if (t === "number" && v.number !== null && !Number.isFinite(v.number)) bad.push(`${k}：不是數字`);
    if (t === "relation") {
      const want = k === "學生" ? DS.roster : DS.log;
      const got = s.relation?.data_source_id;
      if (got && nid(got) !== nid(want)) bad.push(`${k}：關聯到別的資料庫`);
      if (!v.relation.length || v.relation.some(r => !r.id)) bad.push(`${k}：關聯是空的`);
    }
  }
  return bad;
}
const r18rows = events.map(r18);
check(!r18rows.some(r => r.error), "⑦ 兩筆幣值／程度與 class-rules.json 一致（沒有 E07）");
const r18bad = r18rows.flatMap(r => validate(r, logSchema));
check(!r18bad.length, `R18 紀錄列 ${r18rows.length} 列對 Notion schema 全數合格${r18bad.length ? "：" + [...new Set(r18bad)].join("；") : ""}`);
check(r18rows.filter(r => r.properties.正負向.select.name === "中性").length === 1, "無故缺席的「打掃缺席」寫成中性、⑦ 另成一列");

// ── f24 試算（子行程，跑本體）────────────────────────────────
async function f24(injectData) {
  const f = path.join(os.tmpdir(), `sim-inject-${process.pid}-${++seq}.json`);
  await writeFile(f, JSON.stringify(injectData));
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(HERE, "hooks.mjs")).href,
    path.join(ROOT, "scripts/classos/f24-weekly-settle-preview.mjs")], { env: { ...process.env, SIM_INJECT_FILE: f, MODE: "dry-run" }, encoding: "utf8" });
  const out = r.stdout ?? "";
  const g = re => { const x = out.match(re); return x ? Number(x[1]) : null; };
  if (r.status !== 0) console.log(`⚠️ f24 結束碼 ${r.status}：${(r.stderr ?? "").slice(-300)}`);
  return { reward: g(/② 獎懲入帳\s+([+-]?\d+) 幣/), clean: g(/③ 打掃薪水\s+(\d+) 幣/), routine: g(/⑤ 班級常規獎勵\s+(\d+) 幣/),
    hw: g(/⑥ 作業完成獎勵\s+(\d+) 幣/), bad: g(/⑦ 打掃未達標班規③\s+(-?\d+) 幣/), hwPaid: /⑥ 作業完成獎勵[^\n]*已入帳/.test(out),
    due: g(/本次實際待入帳 (-?\d+) 幣/) ?? g(/合計 (-?\d+) 幣/) };
}

console.log("\n== 2 f24 試算（尚未週結）==");
const base = await f24({ dropBankWeek: LABEL });
const withEv = await f24({ dropBankWeek: LABEL, log: r18rows });
console.log(`基準 ②${base.reward}／③${base.clean}／⑤${base.routine}／⑥${base.hw}／⑦${base.bad}／待入帳 ${base.due}`);
console.log(`加事件 ②${withEv.reward}／③${withEv.clean}／⑤${withEv.routine}／⑥${withEv.hw}／⑦${withEv.bad}／待入帳 ${withEv.due}`);
check(!base.hwPaid, "隱藏本週帳列後 ⑥ 不再標「已入帳」（模擬尚未週結成立）");
check(withEv.reward - base.reward === -10, "② 多了兩筆 ⑦ 共 −10");
check(base.clean - withEv.clean === 8, "③ 打掃薪水少 8 幣（無故缺席 1 次＋未達標 3 次，×2 幣）");
const bMiss = new Set(weekLogs.filter(p => titleOf(p) === "常規未達成" && mine(p, B)).map(p => dateOf(p, "日期"))).size;
const wantRoutine = 1 + (bMiss === 0 ? 3 : 0);
check(base.routine - withEv.routine === wantRoutine, `⑤ 只因座號 ${B} 沒補做少 ${wantRoutine} 幣；座號 ${A} 的 ⑦ 不連帶扣常規獎勵`);
check(withEv.bad - base.bad === -5, `⑦ 出現座號 ${C} 的 −5`);
check(withEv.hw === base.hw, "⑥ 作業完成獎勵不受影響");

// ── 3 week-publish 寫入計畫（照 SKILL，不寫）─────────────────
function plan(logsWeek, logsAll, bankRows, { prefixKey = true, legacyGuard = true } = {}) {
  const settled = new Set();
  for (const b of bankRows) for (const l of relIds(b, "紀錄庫")) for (const s of relIds(b, "學生")) settled.add(`${nid(l)}|${nid(s)}`);
  const W = [];
  const ledger = (reason, amount, sid, logId) => ({ id: fid(), properties: {
    事由: { title: T(reason) }, 類型: { select: { name: amount > 0 ? "獎勵金" : "懲罰金" } }, 金額: { number: amount },
    日期: { date: { start: END } }, 週次: { rich_text: T(LABEL) }, 學年: { select: { name: YEAR } },
    學生: { relation: [{ id: sid }] }, 紀錄庫: { relation: [{ id: logId }] } } });
  const record = (title, seat, cat, sign, coin, count) => ({ id: fid(), properties: {
    事件描述: { title: T(title) }, 類別: { select: { name: cat } }, 正負向: { select: { name: sign } }, 程度: { number: 1 },
    金幣影響: { number: coin }, 次數: { number: count }, 日期: { date: { start: END } }, 週次: { rich_text: T(LABEL) },
    學年: { select: { name: YEAR } }, 學生: { relation: [{ id: idOf.get(seat) }] } } });
  // ② 獎懲：紀錄id×學生id 沒入過帳的
  for (const l of logsWeek) {
    const c = num(l, "金幣影響");
    if (!c) continue;
    for (const sid of relIds(l, "學生")) {
      if (settled.has(`${nid(l.id)}|${nid(sid)}`)) continue;
      W.push({ item: "②", seat: seatOfId(sid), amount: c, ledger: ledger(titleOf(l), c, sid, l.id) });
    }
  }
  const exists = (full, prefix, seat) => logsAll.some(l => (prefixKey ? titleOf(l).startsWith(prefix) : titleOf(l) === full)
    && mine(l, seat) && sel(l, "學年") === YEAR && anyText(l, "週次") === LABEL);
  const legacy = (prefix, seat) => legacyGuard && bankRows.some(b => anyText(b, "事由").startsWith(prefix)
    && relIds(b, "紀錄庫").length === 0 && relIds(b, "學生").some(id => seatOfId(id) === seat));
  const tally = act => {
    const mm = new Map();
    for (const l of logsWeek.filter(l => titleOf(l) === act)) for (const sid of relIds(l, "學生")) {
      const s = seatOfId(sid); if (s) mm.set(s, (mm.get(s) ?? 0) + (num(l, "次數") ?? 1));
    }
    return mm;
  };
  for (const [s, n] of tally("打掃未達標")) {
    if (n < 3) continue;
    const pre = `第${N}週打掃未達標`, full = `${pre}（${n} 次）`;
    if (exists(full, pre, s) || legacy(pre, s)) continue;
    const r = record(full, s, "生活技能", "－", -5, n);
    W.push({ item: "⑦", seat: s, amount: -5, record: r, ledger: ledger(full, -5, idOf.get(s), r.id) });
  }
  const done = tally("作業完成"), hwBad = new Set();
  for (const l of logsWeek) if (sel(l, "類別") === "作業" && sel(l, "正負向") === "－") relIds(l, "學生").forEach(id => seatOfId(id) && hwBad.add(seatOfId(id)));
  if (done.size) for (const r0 of roster) {
    const s = r0.seat;
    if (!done.has(s) || hwBad.has(s)) continue;
    const pre = `第${N}週作業完成獎勵`;
    if (exists(pre, pre, s) || legacy(pre, s)) continue;
    const r = record(pre, s, "作業", "＋", 5, 1);
    W.push({ item: "⑥", seat: s, amount: 5, record: r, ledger: ledger(pre, 5, idOf.get(s), r.id) });
  }
  return W;
}
const sum = (W, item) => W.filter(w => w.item === item).reduce((a, w) => a + w.amount, 0);

console.log("\n== 3 week-publish 寫入計畫（照 SKILL，不寫）==");
const bankUnsettled = bank.filter(b => anyText(b, "週次") !== LABEL);
const P = plan(weekLogs.concat(r18rows), allLogs.concat(r18rows), bankUnsettled);
const recs = P.filter(w => w.record), leds = P.map(w => w.ledger);
console.log(`計畫：帳列 ${leds.length} 筆（② ${P.filter(w => w.item === "②").length}、⑥ ${P.filter(w => w.item === "⑥").length}、⑦ ${P.filter(w => w.item === "⑦").length}）｜寫回紀錄列 ${recs.length} 列`);
check(sum(P, "②") === withEv.reward, `② 計畫 ${sum(P, "②")} 幣＝f24 ${withEv.reward} 幣`);
check(sum(P, "⑥") === withEv.hw, `⑥ 計畫 ${sum(P, "⑥")} 幣＝f24 ${withEv.hw} 幣`);
check(sum(P, "⑦") === withEv.bad, `⑦ 計畫 ${sum(P, "⑦")} 幣＝f24 ${withEv.bad} 幣`);
check(recs.length === P.filter(w => w.item !== "②").length, "寫回紀錄列數＝⑥⑦ 帳列數，每筆帳列都掛著自己的紀錄列");
const recBad = recs.flatMap(w => validate(w.record, logSchema)), ledBad = leds.flatMap(l => validate(l, bankSchema));
check(!recBad.length, `寫回紀錄列對 schema 合格${recBad.length ? "：" + [...new Set(recBad)].join("；") : ""}`);
check(!ledBad.length, `帳列對 schema 合格${ledBad.length ? "：" + [...new Set(ledBad)].join("；") : ""}`);

// ── 4 寫入後重跑 ──────────────────────────────────────────────
console.log("\n== 4 假設照計畫寫入後重跑 ==");
const again = await f24({ dropBankWeek: LABEL, log: [...r18rows, ...recs.map(w => w.record)], bank: leds });
console.log(`重跑 ②${again.reward}／⑥${again.hw}／⑦${again.bad}／⑤${again.routine}`);
check(again.reward === 0 && again.hw === 0 && again.bad === 0, "f24 的 ②⑥⑦ 待入帳全部歸零（沒有重複算）");
check(again.routine === withEv.routine, "寫回列不影響 ⑤ 常規獎勵");
const P2 = plan(weekLogs.concat(r18rows, recs.map(w => w.record)), allLogs.concat(r18rows, recs.map(w => w.record)), bankUnsettled.concat(leds));
check(P2.length === 0, `week-publish 再跑一次：0 筆新寫入（實際 ${P2.length}）`);

// ── 5 兩條防重複護欄 ─────────────────────────────────────────
console.log("\n== 5 防重複護欄 ==");
const fourth = r18({ tool: "cleanup", date: days[3], seat: C, src: "tally", kind: "bad", act: "打掃未達標", period: "環境晨掃" });
const logs4 = weekLogs.concat(r18rows, recs.map(w => w.record), [fourth]);
const all4 = allLogs.concat(r18rows, recs.map(w => w.record), [fourth]);
const bank4 = bankUnsettled.concat(leds);
const P4old = plan(logs4, all4, bank4, { prefixKey: false }), P4 = plan(logs4, all4, bank4);
console.log(`寫回後座號 ${C} 又多 1 次未達標：整句比對會再扣 ${sum(P4old, "⑦")} 幣／比對開頭 ${sum(P4, "⑦")} 幣`);
check(sum(P4, "⑦") === 0, "③ 防重複比對事件描述開頭（不含次數），第 4 次不會再扣一次 −5");
const PnowOld = plan(weekLogs, allLogs, bank, { legacyGuard: false }), PnowG = plan(weekLogs, allLogs, bank);
console.log(`真實現況（本週已在施工前入帳）：沒有舊帳護欄會再發 ④ ${P.filter(() => false).length || sum(PnowOld, "⑥")} 幣／有護欄 ${sum(PnowG, "⑥")} 幣`);
check(sum(PnowG, "⑥") === 0 && sum(PnowG, "⑦") === 0, "施工前的舊帳（事由相同、沒掛紀錄庫）會被認出，不重複發錢");

console.log(`\n${fails ? `❌ 驗收未通過：${fails} 項` : "✅ 驗收全數通過"}`);
process.exit(fails ? 1 : 0);
