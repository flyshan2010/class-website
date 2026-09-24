/**
 * 浮動價格的共用邏輯（SPEC_班級經濟機制 §3、§4）——純函式，不碰 Notion。
 * ───────────────────────────────────────────────────────────────
 * **達標觸發制**（2026-09-24 老師定案，取代「兩個月一期」）：每週五週結試算時檢查一次，
 *   M＝最近 4 個已結完上課週的「週 W」中位數，跟「上次定價時的 W」比，R＝M÷W_ref。
 *   R ≥ 1.15 或 ≤ 0.85 **連續 2 週** → 調價；距上次調價（或被否決那次）生效未滿 4 週＝冷卻不調。
 *   每學年 10/31 前＝監測期只記錄；生效日落在 6–8 月不調（6 月剩下的幣改換好兒童章 100:1）。
 * 判斷只有 evaluate() 這一份：f33 決定調不調、f24 印週報、drill 演練都呼叫它，不各算各的（SPEC §5-1）。
 * 捨入禁用 round()——一律 floor(x+0.5)。
 */

export const TRIGGER_HI = 1.15, TRIGGER_LO = 0.85;   // 達標門檻（含端點）
export const STREAK = 2;                             // 連續幾週達標才調
export const COOLDOWN_DAYS = 28;                     // 冷卻 4 週（從上次生效日起算）
export const WINDOW = 4;                             // 近幾週取中位數
export const MIN_BASE_WEEKS = 3;                     // 基準 W₀ 至少要幾週，不足＝數字不完整（fail-closed）
export const MAX_STEP = 0.3;                         // 單次最多 ±30%
export const SHADOW_END = "10-31";                   // 每學年這天（含）以前＝監測期，只記錄
export const NO_EFFECT_MONTHS = [6, 7, 8];           // 生效日落在這幾個月不調
// 只調 ②③⑤⑥ 層；①（社會性・免費）④（創造沙盒）不調。沒填層級＝第二層（同 sync-notion STORE_DEFAULT_TIER）
export const ADJUST_TIERS = ["②", "③", "⑤", "⑥"];
export const tierAdjustable = tier => ADJUST_TIERS.includes(String(tier || "②").trim().slice(0, 1));

const half = x => Math.floor(x + 0.5);

/** ISO 日期加天數（純日期運算，不受時區影響）。 */
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 全部上課週（兩學期攤平、依日期排），每週補 end＝下一週的起（不含）；最後一週＝迄的隔天。 */
export function weekList(weeksFile) {
  const ws = (weeksFile.學期 ?? []).flatMap(t => (t.週 ?? []).map(w => ({ ...w, 學年: t.學年 })))
    .sort((a, b) => a.起.localeCompare(b.起));
  return ws.map((w, i) => ({ ...w, end: ws[i + 1]?.起 ?? addDays(w.迄, 1) }));
}

/**
 * 每一週的「週 W」＝該週收入面帳列淨額 ÷ 在學人數（不捨入，取中位數後才捨入）。
 * 收入面＝類型不是「消費」的列（薪水、獎勵金、懲罰金、利息、調整）。
 * **消費（購物、集資捐款、換章）不算**（老師 2026-09-24 裁示）：量的是「賺多少」，
 * 把花掉的也扣掉會變成「越常用商店、價格反而往下調」。
 */
export function weeklyW(ledgerRows, weeks, rosterN) {
  const m = new Map(weeks.map(w => [w.起, 0]));
  for (const b of ledgerRows) {
    if (b.type === "消費" || !b.date) continue;
    const w = weeks.find(x => b.date >= x.起 && b.date < x.end);
    if (w) m.set(w.起, m.get(w.起) + b.amount);
  }
  for (const [k, v] of m) m.set(k, rosterN ? v / rosterN : 0);
  return m;
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** 新價＝舊價×R（R 先夾在 ±30%），四捨五入到 5 的倍數（ROUND_HALF_UP）。 */
export function newPrice(old, R) {
  const r = clampR(R);
  return Math.floor(old * r / 5 + 0.5 + 1e-9) * 5;   // 1e-9：擋浮點誤差把 x.5 算成 x.4999
}
export const clampR = R => Math.min(1 + MAX_STEP, Math.max(1 - MAX_STEP, R));

/** 調價公告的固定標題——f33 建、f34 用它找「否決調價」勾選，兩邊必須逐字一致。 */
export const ANN_PREFIX = "🏪 商店調價預告｜";
export const announceTitle = effDate => `${ANN_PREFIX}${effDate} 起新價格`;
export const effOfTitle = t => (t.startsWith(ANN_PREFIX) ? t.slice(ANN_PREFIX.length, ANN_PREFIX.length + 10) : "");

/**
 * 本週要不要調價（唯一判斷）。
 * anns：本學年以前的調價公告 [{ eff: "yyyy-mm-dd", vetoed: bool }]（f33 從 📣 公告標題解析）。
 * 回傳 { act, verdict, line, M, Wref, R, eff, annFrom, week }；act＝true 才寫草稿。
 */
export function evaluate({ ledgerRows, weeksFile, rosterN, today, anns = [] }) {
  const all = weekList(weeksFile);
  const week = all.find(w => today >= w.起 && today < w.end) || all.find(w => w.預排日?.includes(today));
  if (!week) return { act: false, verdict: `${today} 不在任何上課週（寒暑假），不檢查`, line: "" };

  const yearStart = all.find(w => w.學年 === week.學年).起;
  const shadowEnd = `${yearStart.slice(0, 4)}-${SHADOW_END}`;
  const wk = weeklyW(ledgerRows, all, rosterN);
  // 可計週＝本學年、排除每學期第 1 週（補結舊帳會灌爆平均）、已結完（在本週之前）
  const done = all.filter(w => w.學年 === week.學年 && w.週次 !== 1 && w.end <= week.起);
  const medOf = ws => half(median(ws.map(w => wk.get(w.起))));
  const lastN = (upto, n) => { const d = done.filter(w => w.end <= upto); return d.length >= n ? d.slice(-n) : null; };

  // 本學年的調價公告：待生效（未否決、生效日未到）／已生效／最近一次（含被否決）
  const annFrom = addDays(week.迄, 1), eff = addDays(annFrom, 7);   // 下週一公告、再下週一生效
  const mine = anns.filter(a => a.eff >= yearStart).sort((a, b) => a.eff.localeCompare(b.eff));
  // 本週自己寫的那則（同週重跑）不算「別的待生效」，照常重算刷新
  const pending = mine.find(a => !a.vetoed && a.eff > today && a.eff !== eff);
  const applied = mine.filter(a => !a.vetoed && a.eff <= today).at(-1);
  const lastAny = mine.filter(a => a.eff !== eff && (a.vetoed || a.eff <= today)).at(-1);

  // W_ref：上次自動調價那週算出的 M；本學年還沒調過＝基準 W₀（開學第 2 週～10/31 的週 W 中位數）
  let Wref = null, refLabel = "";
  if (applied) {
    const calcDay = addDays(applied.eff, -10);   // 生效日＝算價週五 +10 天（下週一公告、再下週一生效）
    const cw = all.find(w => calcDay >= w.起 && calcDay < w.end);
    const ws = cw && lastN(cw.起, WINDOW);
    Wref = ws ? medOf(ws) : null;
    refLabel = `上次定價（${applied.eff} 生效）`;
  } else {
    const ws = done.filter(w => w.起 <= shadowEnd);
    Wref = ws.length >= MIN_BASE_WEEKS ? medOf(ws) : null;
    refLabel = `基準 W₀（${ws.length} 週${today > shadowEnd ? "・已定案" : "・監測期還在長"}）`;
  }

  const cur = lastN(week.起, WINDOW), prev = lastN(done.at(-1)?.起 ?? week.起, WINDOW);
  const M = cur ? medOf(cur) : null, Mp = prev ? medOf(prev) : null;
  const line = `近 ${WINDOW} 週中位數 M＝${M ?? "無"}｜${refLabel} W＝${Wref ?? "無"}`
    + (M !== null && Wref > 0 ? `｜R＝${(M / Wref).toFixed(2)}` : "")
    + (Mp !== null && Wref > 0 ? `（上週 ${(Mp / Wref).toFixed(2)}）` : "");
  const base = { act: false, line, M, Wref, week };

  if (pending) return { ...base, verdict: `已有待生效的調價（${pending.eff}），本週只記錄` };
  if (M === null || !(Wref > 0)) return { ...base, verdict: `數字不完整，不調（已結完可計 ${done.length} 週）` };
  const R = M / Wref, Rp = Mp !== null ? Mp / Wref : null;
  const dir = r => (r === null ? null : r >= TRIGGER_HI ? "漲" : r <= TRIGGER_LO ? "跌" : null);
  const hit = dir(R);
  if (!hit) return { ...base, R, verdict: `R＝${R.toFixed(2)}，在 ${TRIGGER_LO}～${TRIGGER_HI} 之間，未達標` };
  if (dir(Rp) !== hit) return { ...base, R, verdict: `R＝${R.toFixed(2)} 達標（${hit}）第 1 週，下週再達標才調` };
  if (today <= shadowEnd) return { ...base, R, verdict: `R＝${R.toFixed(2)} 連續 ${STREAK} 週達標（${hit}）——監測期（${shadowEnd} 前）只記錄、不調` };
  if (lastAny && today < addDays(lastAny.eff, COOLDOWN_DAYS))
    return { ...base, R, verdict: `R＝${R.toFixed(2)} 連續達標（${hit}），但距上次調價（${lastAny.eff}${lastAny.vetoed ? "・已否決" : ""}）未滿 4 週，冷卻中不調` };
  if (NO_EFFECT_MONTHS.includes(Number(eff.slice(5, 7))))
    return { ...base, R, verdict: `R＝${R.toFixed(2)} 連續達標（${hit}），但生效日 ${eff} 已進 6 月——期末不調（剩下的幣換好兒童章）` };
  return { ...base, act: true, R, eff, annFrom, verdict: `R＝${R.toFixed(2)} 連續 ${STREAK} 週達標（${hit}）→ ${eff} 生效` };
}
