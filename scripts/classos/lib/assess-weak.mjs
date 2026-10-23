/**
 * 課堂作答弱點分析（CG 線 P2d；SPEC_單節課簡報v4 §8 P2d，老師 2026-10-23 範本定案、60% 沿用）。
 * 純函式、不讀檔、不連 Notion：sync-notion.mjs 撈紀錄庫後呼叫這裡，教師儀表板與家長學習報告都吃同一份結果（U83）。
 *
 * 資料來源：「📝 班經與學習紀錄庫」類別＝課堂表現、事件描述含「課堂作答」的列，讀「作答明細」（r 原字串，
 *   格式與驗證共用 cm-events.mjs 的 parseAssessR）。**不讀「錯題」欄**（平時卷錯題碼，文法不同）。
 * 規則：
 *   - 得分率＝答對 ÷（答對＋答錯＋未答），未答算在分母、不算對（§9-1）；百分比取整數、四捨五入（班級規則禁銀行家捨入：
 *     用整數算 floor((2o×100＋rec)／(2rec))，＝ROUND_HALF_UP，沒有浮點誤差）。
 *   - 同一知識點不到 MIN_ITEMS（3）題次＝資料不足：rate＝null，不標弱點。
 *   - 低於 LOW_RATE（60）％＝弱點（沿用作答面板「⚠ 建議重講」門檻，老師 10-23 裁定）。
 * 隱私：輸出只有座號與知識點；姓名、查詢碼不經過這裡。呼叫端把結果放進加密檔（學生報告／教師儀表板），不寫公開 JSON（U42）。
 */
import { parseAssessR, ASSESS_ACT, ASSESS_LESSON_RE } from "./cm-events.mjs";

export const MIN_ITEMS = 3;
export const LOW_RATE = 60;
const SUBJ = { 國: "國語", 數: "數學", 社: "社會" };

export function pct(o, rec) {
  return rec > 0 ? Math.floor((2 * o * 100 + rec) / (2 * rec)) : null;
}

/** 紀錄庫一列（props 後的物件）→ { seat, date, lesson, subj, week, items } 或 null（不是課堂作答／格式壞＝略過，回 why）。 */
export function rowFromRecord(r, seatOfId) {
  const desc = String(r["事件描述"] ?? "");
  if (r["類別"] !== "課堂表現" || !desc.includes(ASSESS_ACT)) return { skip: "不是課堂作答" };
  const lesson = desc.split(/\s/)[0];
  if (!ASSESS_LESSON_RE.test(lesson)) return { skip: `事件描述開頭不是節次（${lesson}）` };
  const p = parseAssessR(r["作答明細"]);
  if (!p.ok) return { skip: p.why };
  const ids = r["學生"] ?? [];
  const seat = ids.length === 1 ? seatOfId.get(ids[0]) : undefined;
  if (seat == null) return { skip: "學生關聯不是剛好一位在學學生" };
  return { seat, date: String(r["日期"]?.start ?? r["日期"] ?? "").slice(0, 10), lesson, subj: SUBJ[lesson[0]],
    week: String(r["週次"] ?? "").trim(), items: p.items };
}

/** 「四上第9週(10/26-10/30)」→ { key:"四上|9", term:"四上", n:9 }；別名「第九週」也收（同 weeks.json 別名）。 */
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const cnNum = s => /^\d+$/.test(s) ? Number(s) : s.length === 1 ? CN[s] : s[0] === "十" ? 10 + (CN[s[1]] ?? 0) : (CN[s[0]] ?? 0) * 10 + (CN[s[2]] ?? 0);
export function weekKey(label) {
  const m = String(label ?? "").match(/(\S{2})第([0-9一二三四五六七八九十]+)週/);
  if (!m) return null;
  const n = cnNum(m[2]);
  return n ? { key: `${m[1]}|${n}`, term: m[1], n } : null;
}

/** 題目清單 → 依（科目、知識點）彙總：[{ subj, kp, o, x, n, rec, rate }]，rate 不足 3 題＝null。 */
export function aggregate(list) {
  const m = new Map();
  for (const it of list) {
    const k = `${it.subj}|${it.kp}`;
    const a = m.get(k) ?? m.set(k, { subj: it.subj, kp: it.kp, o: 0, x: 0, n: 0 }).get(k);
    if (it.res === "O") a.o++; else if (it.res === "X") a.x++; else a.n++;
  }
  return [...m.values()].map(a => {
    const rec = a.o + a.x + a.n;
    return { ...a, rec, rate: rec >= MIN_ITEMS ? pct(a.o, rec) : null };
  }).sort((a, b) => a.subj.localeCompare(b.subj) || a.kp.localeCompare(b.kp));
}

const flat = rows => rows.flatMap(r => r.items.map(i => ({ ...i, subj: r.subj, seat: r.seat, lesson: r.lesson })));

/** 全部列 → 依週分組的教師版資料（新的週在後）。weeks＝data/weeks.json（給週的起迄日期與排序）。 */
export function teacherWeeks(rows, weeks) {
  const meta = new Map();
  for (const t of weeks?.學期 ?? []) for (const w of t.週 ?? []) meta.set(`${t.學期名稱}|${w.週次}`, { label: w.標籤, from: w.上課起 || w.起, to: w.上課迄 || w.迄, order: `${t.學年}${t.學期 === "下" ? 2 : 1}-${String(w.週次).padStart(2, "0")}` });
  const groups = new Map();
  for (const r of rows) {
    const wk = weekKey(r.week);
    if (!wk) continue;
    (groups.get(wk.key) ?? groups.set(wk.key, []).get(wk.key)).push(r);
  }
  return [...groups.entries()].map(([key, rs]) => {
    const m = meta.get(key) ?? { label: key.replace("|", "第") + "週", from: "", to: "", order: key };
    const lessons = [...new Set(rs.map(r => r.lesson))].map(l => {
      const lr = rs.filter(r => r.lesson === l);
      return { lesson: l, subj: lr[0].subj, date: lr.map(r => r.date).sort()[0], n: lr.length, kp: aggregate(flat(lr)) };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.lesson.localeCompare(b.lesson));
    const seats = [...new Set(rs.map(r => r.seat))].sort((a, b) => a - b);
    const all = flat(rs);
    return { key, label: m.label, from: m.from, to: m.to, order: m.order, rows: rs.length, items: all.length, overall: pct(all.filter(i => i.res === "O").length, all.length),
      classKp: aggregate(all), lessons, bySeat: Object.fromEntries(seats.map(s => [s, aggregate(flat(rs.filter(r => r.seat === s)))])) };
  }).sort((a, b) => a.order.localeCompare(b.order)).map(({ order, ...w }) => w);
}

/** 某生某週的家長版：{ subjects:[{ subj, kp:[...] }], strong:[], weak:[], few:[] }；這週沒有作答紀錄＝null。 */
export function seatWeek(rows, seat, key) {
  const mine = rows.filter(r => r.seat === seat && weekKey(r.week)?.key === key);
  if (!mine.length) return null;
  const kp = aggregate(flat(mine));
  const subjects = [...new Set(kp.map(k => k.subj))].map(subj => ({ subj, kp: kp.filter(k => k.subj === subj) }));
  const name = k => subjects.length > 1 ? `${k.subj}・${k.kp}` : k.kp;   // 同週兩科以上才加科目，避免同名知識點混在一起
  return { lessons: [...new Set(mine.map(r => r.lesson))], subjects,
    strong: kp.filter(k => k.rate != null && k.rate >= 85).map(name),
    weak: kp.filter(k => k.rate != null && k.rate < LOW_RATE).map(name),
    few: kp.filter(k => k.rate == null).map(name) };
}
