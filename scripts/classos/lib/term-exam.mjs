/**
 * 定期評量（期中考／期末考）收尾——唯一一份規則（U83），老師 2026-11-06 定案（DH 線）：
 *   提案正本 ClassOS_v3.5_藍圖/試後分析表_提案/PROPOSAL_期中評量收尾流程.md（§2 算法、§5 裁定）。
 *
 * 一、期考分數（f53 試算／f54 寫入學期成績庫「○○期考」）
 *   - 來源＝紀錄庫評量列、評量名稱＝期中考／期末考（錯題表上傳，分數＝100−錯題扣分）。
 *   - 缺考不寫（保持空白、另行補考）；判不出（沒分數也沒寫缺考、同科兩筆）＝需人工、不寫。
 *
 * 二、試後分析表（f55 → 填學校原表 6試後分析表）
 *   - 應考人數＝有分數的人；缺考另計。得分等距 100／90–99／80–89／70–79／60–69／未滿 60。
 *   - 一列＝一題；錯誤人數＝該題被扣分（含部分扣分）的人數；錯誤率＝錯誤人數 ÷ 應考人數（＝答錯題次 ÷ 總題次）。
 *   - 列入門檻：≥ 30％ 全班補救；20％～29％ 小組補救（N 人）；< 20％ 不列（個別訂正）。依題目順序。
 *   - 同一知識點 ≥ 2 題達 30％ → 分析欄註明同一觀念、全班整體偏弱；錯的人過半是部分扣分 → 註明。
 *   - 百分比與平均一律四捨五入取整數（Math.floor(x+0.5)，禁銀行家捨入）。
 *   - fail-closed：任何一位學生錯題碼對不到題目、算出分數≠紀錄分數、有分數沒錯題碼 → 整科不出表，回 manual。
 *   - 不列名次、不列姓名座號（通用鐵則 6）；小組補救名單（座號）只回給 Notion 收件匣，不進公開 log／artifact。
 * 純函式、不讀檔、不連 Notion。
 */
import { toTermExam, roundHalfUp, MAIN } from "./term-quiz.mjs";
import { analyze, parseErrorCode, itemCode } from "./quiz-errors.mjs";

export const FULL = 30;   // 錯誤率 ≥ 30％：全班補救
export const GROUP = 20;  // 錯誤率 20％～29％：小組補救
export const examName = (stage) => (stage === "期末" ? "期末考" : "期中考");

/**
 * 紀錄庫列 → 每位學生各科期考。
 * @param {Array} recs [{ seats:number[], date, category, subject, score, name, desc, errors }]
 * @param {number[]} seats 在學座號
 * @param {{stage:"期中"|"期末", from:string, to:string}} opt 學期起迄（含頭含尾）
 * @returns {{ rows: Array<{seat, subjects: Record<string,{score,absent,errors}|null>}>, manual: string[], orphan: number }}
 *   manual 字串含座號——只准寫進 Notion，不准印到公開 log。
 */
export function termExamScores(recs, seats, opt) {
  const want = examName(opt.stage);
  const by = new Map(seats.map((s) => [s, Object.fromEntries(MAIN.map((m) => [m, []]))]));
  const manual = [];
  let orphan = 0;
  for (const r of recs) {
    const t = toTermExam(r);
    if (!t || t.name.replace(/\s+/g, "") !== want) continue;
    if (t.date < opt.from || t.date > opt.to) continue;
    const mine = (r.seats || []).filter((s) => by.has(s));
    if (!mine.length) { orphan++; continue; }
    for (const s of mine) {
      if (t.manual) { manual.push(`座號${s} ${t.subject || "（科目空白）"}${want}：${t.manual}`); continue; }
      if (!MAIN.includes(t.subject)) continue;
      by.get(s)[t.subject].push({ score: t.score, absent: t.absent, errors: String(r.errors ?? "").trim() });
    }
  }
  const rows = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([seat, subj]) => ({
    seat,
    subjects: Object.fromEntries(MAIN.map((m) => {
      const a = subj[m];
      if (a.length > 1) { manual.push(`座號${seat} ${m}${want}有 ${a.length} 筆，請刪到剩一筆`); return [m, null]; }
      return [m, a[0] ?? null];
    })),
  }));
  return { rows, manual, orphan };
}

/** 卷 JSON → 題目清單（含試題類型顯示字「一、選擇題第2題」與知識點名）。 */
export function examLayout(exam) {
  const SEC = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const out = [];
  (exam.sections || []).forEach((sec, si) => {
    let name = String(sec.name || "").replace(/（[^）]*）|\([^)]*\)/g, "").trim();
    if (!/^[一二三四五六七八九十]+、/.test(name)) name = `${SEC[si] ?? si + 1}、${name}`;
    (sec.items || []).forEach(([no, pts, , tag]) => {
      const m = String(no).trim().match(/^(\d+)\s*(.*)$/);
      const q = m ? `第${m[1]}題${m[2] ? `（${m[2]}）` : ""}` : String(no).trim();
      out.push({ code: itemCode(si, no), label: `${name}${q}`, pts: Number(pts) || 0, kp: exam.tags?.[tag]?.[0] ?? String(tag ?? "") });
    });
  });
  return out;
}

/**
 * 一科試後分析。
 * @param {object} exam 卷 JSON（quiz-exam/1）
 * @param {Array<{seat:number, score:number|null, absent:boolean, errors:string}>} rows 該科每位學生（null＝沒紀錄者先濾掉）
 * @returns {{manual:string[]} | {n, absent, avg, bins, summary, items, listed, groups}}
 *   groups＝{ 題目代碼: 座號[] }（只寫 Notion）；其餘欄位不含座號，可進 artifact。
 */
export function postExamAnalysis(exam, rows) {
  const layout = examLayout(exam);
  const manual = [];
  const sat = rows.filter((r) => !r.absent);
  const lostBy = new Map(layout.map((it) => [it.code, []])); // code → [{seat, partial}]
  const scores = [];
  for (const r of sat) {
    if (!r.errors) { manual.push(`座號${r.seat}：有分數但錯題表沒登記（全對請登記「無」）`); continue; }
    const res = analyze(exam, r.errors, r.score);
    if (res.manual) { manual.push(`座號${r.seat}：${res.manual}`); continue; }
    scores.push(Number(r.score));
    const parsed = parseErrorCode(r.errors);
    for (const e of parsed.entries || []) {
      const it = layout.find((x) => x.code === e.code);
      lostBy.get(e.code).push({ seat: r.seat, partial: e.ded != null && e.ded < it.pts });
    }
  }
  if (!sat.length) manual.push("沒有任何應考成績");
  if (manual.length) return { manual };

  const n = scores.length;
  const bins = [
    scores.filter((s) => s === 100).length, scores.filter((s) => s >= 90 && s < 100).length,
    scores.filter((s) => s >= 80 && s < 90).length, scores.filter((s) => s >= 70 && s < 80).length,
    scores.filter((s) => s >= 60 && s < 70).length, scores.filter((s) => s < 60).length,
  ];
  const avg = roundHalfUp(scores.reduce((a, b) => a + b, 0) / n);
  const items = layout.map((it) => {
    const who = lostBy.get(it.code);
    const wrong = who.length, partial = who.filter((w) => w.partial).length;
    const rate = roundHalfUp((100 * wrong) / n);
    return { code: it.code, label: it.label, kp: it.kp, wrong, partial, rate,
      level: rate >= FULL ? "全班" : rate >= GROUP ? "小組" : null };
  });
  const listed = items.filter((it) => it.level);
  const fullKp = {};
  for (const it of listed) if (it.level === "全班" && it.kp) (fullKp[it.kp] ??= []).push(it);
  for (const it of listed) {
    const notes = [];
    if (it.partial * 2 > it.wrong) notes.push(`（${it.wrong} 人中 ${it.partial} 人為部分扣分，多為過程或細節失分）`);
    const same = it.level === "全班" ? (fullKp[it.kp] || []).filter((o) => o !== it) : [];
    if (same.length) notes.push(`與${same.map((o) => o.label).join("、")}同屬「${it.kp}」觀念，全班整體偏弱。`);
    it.note = notes.join("");
    it.remedyPrefix = it.level === "全班" ? "全班補救：" : `小組補救（${it.wrong} 人）：`;
  }
  const hi = bins[0] + bins[1] + bins[2];
  const full = listed.filter((it) => it.level === "全班").length;
  const summary = `全班平均 ${avg} 分；80 分以上 ${hi} 人（${roundHalfUp((100 * hi) / n)}%）；`
    + (bins[5] ? `未滿 60 分 ${bins[5]} 人，列入補救教學名單。` : "無未滿 60 分者。")
    + (listed.length
      ? `錯誤率 30% 以上 ${full} 題全班補救、20%～29% ${listed.length - full} 題小組補救，其餘個別訂正。`
      : "各題錯誤率皆未達 20%，個別訂正。");
  const groups = Object.fromEntries(listed.filter((it) => it.level === "小組")
    .map((it) => [it.code, lostBy.get(it.code).map((w) => w.seat)]));
  return { n, absent: rows.length - sat.length, avg, bins, summary, items, listed, groups };
}
