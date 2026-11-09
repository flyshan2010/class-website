// 📝 教師專區「作文說明單」→ 作文分析（老師 2026-11-09 定案範本）
// 把 Notion 學習報告「作文批改」列（同一題目）彙整成全班分析；只輸出座號，不輸出姓名。
// 結果只進教師加密檔 essay-tiers.json（與分層名單同一把口令），不進公開檔。
// 規則對齊 SPEC_作文說明單 §3：等第換分 優8…乙下2；五分項→說明單步驟；最弱步驟同分依 審題→選材→組織→技巧→檢查。

export const GV = { 優: 8, 甲上: 7, 甲: 6, 甲下: 5, 乙上: 4, 乙: 3, 乙下: 2 };
const VG = Object.fromEntries(Object.entries(GV).map(([k, v]) => [v, k]));
// 成績單固定五行「項目｜等第｜建議」；項目名稱用關鍵字對應，容許「版面字體」「版面」等寫法
export const DIMS = [
  { key: "版面", kw: /版面/, step: "檢查" },
  { key: "文字標點", kw: /文字|標點/, step: "技巧" },
  { key: "段落結構", kw: /結構|段落/, step: "組織" },
  { key: "主旨切題", kw: /主旨|切題/, step: "審題" },
  { key: "創意真情", kw: /創意|真情/, step: "選材" },
];
const STEP_ORDER = ["審題", "選材", "組織", "技巧", "檢查"];
const TIERS = ["挑戰版", "進階版", "基礎版"];

// 四捨五入到 n 位小數（禁銀行家捨入，班級鐵則：math.floor(x+0.5)）
export const round = (x, n = 1) => Math.floor(x * 10 ** n + 0.5) / 10 ** n;
export const gradeOf = x => VG[Math.floor(x + 0.5)] || "";

// 題目比對：去掉標點空白；說明單題目裡的「○」當萬用字（〈對○○的特別回憶〉對到〈對奶奶的特別回憶〉）
const norm = s => String(s || "").replace(/[\s，,。、；;：:！!？?「」『』〈〉《》（）()．·・—\-]/g, "");
export function topicMatches(topic, title) {
  const t = norm(topic), x = norm(title);
  if (!t || !x) return false;
  if (!t.includes("○")) return t === x;
  const re = new RegExp("^" + t.split(/○+/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".{1,8}") + "$");
  return re.test(x);
}

export function parseScores(text) {
  const out = {};
  for (const line of String(text || "").split("\n")) {
    const [item, g] = line.split(/[｜|]/).map(s => (s || "").trim());
    const d = DIMS.find(d => d.kw.test(item || ""));
    if (d && GV[g] && !(d.key in out)) out[d.key] = GV[g];
  }
  return out;
}

const wordCount = text => { const m = String(text || "").match(/約\s*(\d+)\s*字/); return m ? Number(m[1]) : null; };
// 抓漏評語：「錯的」要寫成「對的」→ 以「對的」計數（同一個字錯在不同句子也合併）
const typos = text => [...String(text || "").matchAll(/「[^」]{1,20}」要寫成「([^」0-9０-９]{1,6})」/g)].map(m => m[1]);
// 開場第三段＝亮點句（magic_goals／warm_intro／shining_sentence 依序，段間空行）
function shining(text) {
  const paras = String(text || "").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const p = paras.reverse().find(s => s.startsWith("「"));
  const m = p && p.match(/^「(.+?)」/);
  return m ? m[1] : "";
}

/**
 * @param {object} o
 * @param {string} o.topic   說明單題目
 * @param {object[]} o.rows  學習報告列（props() 後），會自己篩「作文批改」＋題目相符＋在名冊
 * @param {number[]} o.seats 在學座號
 * @param {object|null} o.tiers 分層名單 {基礎版:[[座號,最弱]],…}
 * @returns {object|null} 沒有任何相符批改列＝null（前端顯示「尚未批改」）
 */
export function analyzeEssays({ topic, rows, seats, tiers }) {
  const inRoster = new Set(seats);
  // 同生多列：取期間（批改日期）最新的一列
  const bySeat = new Map();
  for (const r of rows) {
    if (r["報告類型"] !== "作文批改" || !topicMatches(topic, r["作文_題目"])) continue;
    const seat = Number(r["座號"]);
    if (!inRoster.has(seat)) continue;
    const cur = bySeat.get(seat);
    if (!cur || String(r["期間"] || "") >= String(cur["期間"] || "")) bySeat.set(seat, r);
  }
  if (!bySeat.size) return null;
  const tierOf = {};
  for (const [t, list] of Object.entries(tiers || {})) for (const [s] of list || []) tierOf[s] = t;

  const list = [], typoCnt = {};
  for (const [seat, r] of [...bySeat].sort((a, b) => a[0] - b[0])) {
    const dims = parseScores(r["作文_成績單"]);
    const ok = DIMS.every(d => d.key in dims);
    const weak = ok ? STEP_ORDER.map(s => DIMS.find(d => d.step === s))
      .reduce((m, d) => (dims[d.key] < dims[m.key] ? d : m)).step : "";
    const wc = wordCount(r["作文_升級站"]);
    const flags = [];
    if (!GV[r["作文_總評等第"]] || !ok) flags.push("等第缺漏");
    if (/\[？疑似/.test(r["作文_原文"] || "")) flags.push("辨識不清");
    if (/(?<!沒有|未|不|沒)(偏題|離題)/.test(r["作文_成績單"] || "")) flags.push("偏題");
    if (wc != null && wc < 250) flags.push("字數不到250");
    for (const t of typos(r["作文_抓漏"])) typoCnt[t] = (typoCnt[t] || 0) + 1;
    list.push({ seat, tier: tierOf[seat] || "", final: GV[r["作文_總評等第"]] ? r["作文_總評等第"] : "",
      dims, weak, wc, flags, shine: shining(r["作文_開場"]), published: !!r["發布"],
      date: String(r["期間"] || "").slice(0, 10) });
  }
  const graded = list.filter(x => x.final);
  const avg = Object.fromEntries(DIMS.map(d => {
    const v = list.map(x => x.dims[d.key]).filter(Number.isFinite);
    return [d.key, v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 2) : null];
  }));
  const weakest = DIMS.filter(d => avg[d.key] != null)
    .reduce((m, d) => (!m || avg[d.key] < avg[m.key] ? d : m), null);
  const dist = Object.fromEntries(Object.keys(GV).map(k => [k, graded.filter(x => x.final === k).length]));
  const sorted = graded.map(x => GV[x.final]).sort((a, b) => a - b);
  const bytier = {};
  for (const t of TIERS) {
    const v = graded.filter(x => x.tier === t).map(x => GV[x.final]);
    if (v.length) bytier[t] = { n: v.length, avg: round(v.reduce((a, b) => a + b, 0) / v.length, 1) };
  }
  const wcs = list.map(x => x.wc).filter(Number.isFinite);
  const weakCnt = {};
  for (const x of list) if (x.weak) weakCnt[x.weak] = (weakCnt[x.weak] || 0) + 1;
  return {
    roster: seats.length, done: list.length, published: list.filter(x => x.published).length,
    date: list.map(x => x.date).sort().at(-1) || "",
    dist, median: sorted.length ? VG[sorted[Math.floor(sorted.length / 2)]] : "",
    avg, weakest: weakest ? { dim: weakest.key, step: weakest.step, avg: avg[weakest.key] } : null,
    bytier, weak: weakCnt,
    wc: wcs.length ? { avg: Math.floor(wcs.reduce((a, b) => a + b, 0) / wcs.length + 0.5), min: Math.min(...wcs),
      under250: wcs.filter(w => w < 250).length, under300: wcs.filter(w => w < 300).length } : null,
    typos: Object.entries(typoCnt).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8),
    shine: [...graded].sort((a, b) => GV[b.final] - GV[a.final] || a.seat - b.seat).filter(x => x.shine)
      .slice(0, 3).map(x => ({ seat: x.seat, s: x.shine })),
    missing: seats.filter(s => !bySeat.has(s)),
    rows: list.map(({ shine, date, ...x }) => x),
  };
}
