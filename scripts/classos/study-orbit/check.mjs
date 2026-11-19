// 自學星圖 P1 內容檢核（規格正本：ClassOS_v3.5_藍圖/SPEC_自學星圖_P1資料模型.md §4 十五條）
// 純函式 checkBundle(bundle)；輸入是已整理好的資料包（各表一列一個物件），不直接讀 Notion。
// CLI：node check.mjs <bundle.json>　→ 有錯誤就 exit 1。
//
// 資料包格式（欄名對照 SPEC §3）：
// {
//   books:      [{ code, subject, status, structure:{islands:[{id,name,levels:[{code,name,exam,slots:[7]}]}]} }],
//   kps:        [{ code, name, subject, book, level, reviewCard /*觀念複習卡卡名或空*/, status }],
//   blindspots: [{ code, name, kp, level, fix, ex, chk, status }],
//   stories:    [{ level, book, title, body, status }],
//   questions:  [{ id, type /*選擇｜配合*/, level, slot, span, mother, kp, blindspots:[盲點代碼],
//                  optionBlindspots /*「選項盲點」原文*/, options:[A,B,C,D], answer, left:[], right:[],
//                  hint1, hint2, explanation, group, material, materialType, status }],
//   reviewCards:[{ name, subject, status }],
// }

import { encodeSave } from "./rules.mjs";

export const SAVE_LIMIT_BYTES = 8 * 1024; // §4 第 12 條：存檔最壞情況 ≤8KB
const SLOT_NORMAL = ["基礎", "基礎", "基礎", "進階", "進階", "應用", "應用"];
const SLOT_MATCH = ["基礎", "基礎", "基礎", "基礎", "進階", "應用", "應用"];

const RE_BOOK = /^[cmsne]-[a-z0-9]+-[a-z0-9]+$/;
const RE_QID = /^[A-Z]{2}\d-\d{4}$/;
const levelRe = (book) => new RegExp(`^${book.replace(/[-]/g, "\\-")}-(\\d+|T[1-4]|R[12])-\\d+$`);
const len = (s) => [...String(s ?? "")].length; // 中文以字計
const blank = (s) => String(s ?? "").trim() === "";
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** 第 15 條：圖表素材 JSON（格式正本 SPEC §3.6.1）。回傳問題清單，空陣列＝合格 */
const CHART_KEYS = {
  table: ["k", "title", "head", "rows"],
  bar: ["k", "title", "unit", "cat", "labels", "series", "min", "max", "step", "lab", "dir", "stack"],
  line: ["k", "title", "unit", "cat", "labels", "series", "min", "max", "step", "lab"],
};
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const oneDecimal = (v) => isNum(v) && Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
const isStr = (v) => typeof v === "string" && v.trim() !== "";
export function chartProblems(text) {
  const P = [];
  const raw = String(text ?? "");
  if (/[\r\n]/.test(raw)) P.push("要寫成一行（不換行）");
  if (raw.length > 1500) P.push(`超過 1500 字元（${raw.length}）`);
  let d;
  try { d = JSON.parse(raw); } catch (e) { return [...P, "不是合法的 JSON"]; }
  if (!d || typeof d !== "object" || Array.isArray(d)) return [...P, "要是一個 {…} 物件"];
  const keys = CHART_KEYS[d.k];
  if (!keys) return [...P, `k 要是 table／bar／line（現在是 ${JSON.stringify(d.k)}）`];
  for (const x of Object.keys(d)) if (!keys.includes(x)) P.push(`${d.k} 不認得的欄位「${x}」`);
  if (!isStr(d.title) || len(d.title) > 24) P.push("title 要 1–24 字");
  if (d.k === "table") {
    const R = d.rows;
    if (!Array.isArray(R) || R.length < 1 || R.length > 8 || !R.every(Array.isArray)) return [...P, "rows 要 1–8 列，每列是陣列"];
    const w = R[0].length;
    if (w < 1 || w > 8 || R.some((r) => r.length !== w)) P.push("rows 每列格數要相同，1–8 欄");
    if (R.flat().some((c) => !(isNum(c) || typeof c === "string"))) P.push("格子只能是字串或數字");
    if (d.head !== undefined && (!Array.isArray(d.head) || d.head.length !== w || d.head.some((h) => !isStr(h)))) P.push("head 要和每列同長、不可空");
    return P;
  }
  // bar／line
  if (!isStr(d.unit)) P.push("unit（數量軸單位）不可空");
  if (d.cat !== undefined && !isStr(d.cat)) P.push("cat 有寫就不可空");
  const L = d.labels;
  if (!Array.isArray(L) || L.length < 2 || L.length > 12 || L.some((l) => !isStr(l)) || new Set(L).size !== L.length)
    return [...P, "labels 要 2–12 個、不可空、不重複"];
  const S = d.series;
  if (!Array.isArray(S) || S.length < 1 || S.length > 3) return [...P, "series 要 1–3 組"];
  for (const se of S) {
    if (!se || typeof se !== "object" || Object.keys(se).some((x) => x !== "name" && x !== "vals")) { P.push("series 每組只能有 name、vals"); continue; }
    if (!Array.isArray(se.vals) || se.vals.length !== L.length) P.push(`series「${se.name}」的 vals 個數要等於 labels（${L.length}）`);
    else if (se.vals.some((v) => v !== null && !oneDecimal(v))) P.push(`series「${se.name}」的數值要是數字（最多一位小數）或 null`);
  }
  if (S.length === 1 && S[0].name !== "") P.push("只有一組資料時 name 要填空字串");
  if (S.length > 1 && (S.some((se) => !isStr(se.name)) || new Set(S.map((se) => se.name)).size !== S.length)) P.push("兩組以上時 name 不可空、不重複");
  if (P.length) return P;
  const min = d.min ?? 0, { max, step } = d, lab = d.lab ?? 1;
  if (!isNum(min) || min < 0) P.push("min 要是 ≥0 的數字");
  if (!isNum(max) || !(max > min)) P.push("max 要大於 min");
  if (!isNum(step) || step <= 0) P.push("step 要大於 0");
  if (!Number.isInteger(lab) || lab < 1) P.push("lab 要是正整數");
  if (P.length) return P;
  const ticks = (max - min) / step;
  if (Math.abs(ticks - Math.round(ticks)) > 1e-9 || Math.round(ticks) < 2 || Math.round(ticks) > 20) P.push(`(max−min)/step 要是 2–20 的整數（現在是 ${ticks}）`);
  if (d.dir !== undefined && d.dir !== "v" && d.dir !== "h") P.push("dir 只能是 v 或 h");
  if (d.stack !== undefined && typeof d.stack !== "boolean") P.push("stack 只能是 true／false");
  const stack = d.stack === true;
  if (stack && S.length < 2) P.push("堆疊長條圖要兩組以上");
  const vals = S.flatMap((se) => se.vals);
  const nulls = vals.filter((v) => v === null).length;
  if (nulls > 1) P.push("一張圖最多一個 null（還沒畫）");
  if (stack && nulls) P.push("堆疊長條圖不能用 null");
  const nums = vals.filter((v) => v !== null);
  const tops = stack ? L.map((_, i) => S.reduce((a, se) => a + (se.vals[i] ?? 0), 0)) : nums;
  if (tops.some((v) => v > max + 1e-9) || nums.some((v) => v < min)) P.push(`有數值超出 ${min}～${max}${stack ? "（堆疊看各組相加）" : ""}`);
  if (min > 0 && nums.some((v) => !(v > min))) P.push(`有省略符號（min=${min}）時，每個數值都要大於 min`);
  return P;
}

/** 解析「選項盲點」：一行 `A=代碼` 或 `1=代碼` */
export function parseOptionBlindspots(text) {
  const map = new Map();
  const bad = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([A-D]|\d+)=(\S+)$/.exec(line);
    if (!m || map.has(m[1])) bad.push(line);
    else map.set(m[1], m[2]);
  }
  return { map, bad };
}

/** 存檔最壞情況的位元組數（P2 SPEC §4 第 2 版；鍵省略題本代碼）
 *  最壞＝每關都有紀錄與故事卡、每個盲點都在「已克服」（帶日期，比「確認通過」長）、答到一半的關卡塞滿 */
export function worstSaveBytes(bookCode, levelCodes, blindspotCodes) {
  const short = (c) => c.slice(bookCode.length + 1);
  const lv = {}, cd = {};
  for (const c of levelCodes) lv[short(c)] = [3, 1, 999];
  for (const c of blindspotCodes) if (/-B([1-9]|[12]\d|3[0-5])$/.test(c)) cd[short(c)] = ["d", "2026-11-20"]; // 超過 B35 已由第 11 條報錯
  const longest = levelCodes.map(short).sort((a, b) => b.length - a.length)[0] ?? "";
  const save = {
    lv, cd, ok: [], sc: levelCodes.map(short),
    mid: { k: longest, i: 7, res: "sssssss", q: Array(7).fill("MA4-0000"), t: 1763380000000 },
  };
  return Buffer.byteLength(encodeSave(save), "utf8");
}

export function checkBundle(bundle) {
  const B = { books: [], kps: [], blindspots: [], stories: [], questions: [], reviewCards: [], ...bundle };
  const errs = new Map(); // 去重
  const err = (rule, msg, level = null) => errs.set(`${rule}|${msg}`, { rule, msg, level });

  const kpBy = new Map(B.kps.map((k) => [k.code, k]));
  const bsBy = new Map(B.blindspots.map((b) => [b.code, b]));
  const storyBy = new Map();
  for (const s of B.stories) {
    if (storyBy.has(s.level)) err(10, `${s.level} 有兩張以上故事卡`);
    storyBy.set(s.level, s);
  }

  // 關卡清單（來自題本結構）
  const levels = new Map(); // code → {book, slots}
  for (const book of B.books) {
    if (!RE_BOOK.test(book.code ?? "")) err(11, `題本代碼格式不符：${book.code}`);
    const lre = levelRe(book.code ?? "");
    for (const isl of book.structure?.islands ?? []) {
      for (const lv of isl.levels ?? []) {
        if (!lre.test(lv.code ?? "")) err(11, `關卡代碼格式不符：${lv.code}`);
        if (levels.has(lv.code)) err(11, `關卡代碼重複：${lv.code}`);
        levels.set(lv.code, { book: book.code, slots: lv.slots ?? [] });
        if ((lv.slots ?? []).length !== 7) err(1, `${lv.code} 結構不是 7 格`);
      }
    }
  }

  // 第 11 條：其餘代碼格式
  for (const k of B.kps) {
    if (!new RegExp(`^${k.level}-K\\d+$`).test(k.code ?? "")) err(11, `重點代碼格式不符或和關卡代碼不一致：${k.code}`, k.level);
    if (!levels.has(k.level)) err(11, `重點 ${k.code} 的關卡 ${k.level} 不在任何題本結構`, k.level);
  }
  for (const b of B.blindspots) {
    if (!new RegExp(`^${b.level}-B\\d+$`).test(b.code ?? "")) err(11, `盲點代碼格式不符或和關卡代碼不一致：${b.code}`, b.level);
    else if (Number(/-B(\d+)$/.exec(b.code)[1]) > 35) err(11, `盲點序號超過 B35（存檔第 2 版一關最多 35 個盲點）：${b.code}`, b.level);
  }
  const seenQ = new Set();
  for (const q of B.questions) {
    if (!RE_QID.test(q.id ?? "")) err(11, `題目ID 格式不符：${q.id}`, q.level);
    if (seenQ.has(q.id)) err(11, `題目ID 重複：${q.id}`, q.level);
    seenQ.add(q.id);
    if (q.group && !new RegExp(`^${q.level}-G\\d+$`).test(q.group)) err(11, `題組代號格式不符：${q.group}`, q.level);
    if (!levels.has(q.level)) err(1, `${q.id} 的關卡 ${q.level} 不在任何題本結構`, q.level);
  }

  // 依關卡分組
  const qByLevel = new Map();
  for (const q of B.questions) {
    if (!qByLevel.has(q.level)) qByLevel.set(q.level, []);
    qByLevel.get(q.level).push(q);
  }
  const qBy = new Map(B.questions.map((q) => [q.id, q]));

  for (const [code, lv] of levels) {
    const qs = qByLevel.get(code) ?? [];
    const hasMatch = qs.some((q) => q.type === "配合");
    const want = hasMatch ? SLOT_MATCH : SLOT_NORMAL;
    if (lv.slots.length === 7 && lv.slots.join() !== want.join())
      err(1, `${code} 的 slots 應為 ${want.join("、")}`, code);

    // 第 1 條：每格剛好兩「組」；第 2 條：同格兩題成對
    const units = new Map(); // slot → Set(unitKey)
    const atSlot = new Map(); // slot → [q]
    for (const q of qs) {
      const span = Number(q.span) || 1;
      if (q.type === "配合" ? span !== (q.left ?? []).length : span !== 1) err(8, `${q.id} 占格與題型不符`, code);
      for (let s = Number(q.slot); s < Number(q.slot) + span; s++) {
        if (!(s >= 1 && s <= 7)) { err(1, `${q.id} 的格超出 1–7`, code); continue; }
        if (!units.has(s)) { units.set(s, new Set()); atSlot.set(s, []); }
        units.get(s).add(q.group || q.id);
        atSlot.get(s).push(q);
      }
    }
    for (let s = 1; s <= 7; s++) {
      const n = units.get(s)?.size ?? 0;
      if (n !== 2) err(1, `${code} 第 ${s} 格有 ${n} 組題（應為 2）`, code);
      const pair = atSlot.get(s) ?? [];
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      const roots = pair.filter((q) => blank(q.mother));
      const child = pair.find((q) => !blank(q.mother));
      if (roots.length !== 1 || !child || child.mother !== roots[0].id)
        err(2, `${code} 第 ${s} 格：應一題母題留空、另一題指向它（${a.id}、${b.id}）`, code);
      if (a.kp !== b.kp) err(2, `${code} 第 ${s} 格兩題知識點不同（${a.id}、${b.id}）`, code);
      if (!sameSet(new Set(a.blindspots ?? []), new Set(b.blindspots ?? [])))
        err(2, `${code} 第 ${s} 格兩題盲點集合不同（${a.id}、${b.id}）`, code);
    }

    // 第 9 條：題組
    const groups = new Map();
    for (const q of qs) if (q.group) {
      if (!groups.has(q.group)) groups.set(q.group, []);
      groups.get(q.group).push(q);
    }
    const positions = new Set();
    for (const [g, sub] of groups) {
      const lo = sub[0].materialType === "圖表" ? 2 : 3; // 圖表題組 2–4、文章題組 3–4（老師 2026-11-19）
      if (sub.length < lo || sub.length > 4) err(9, `題組 ${g} 有 ${sub.length} 小題（應 ${lo}–4）`, code);
      if (new Set(sub.map((q) => q.material ?? "")).size !== 1) err(9, `題組 ${g} 的共用素材不是逐字相同`, code);
      if (sub[0].materialType === "文章" && len(sub[0].material) > 300) err(9, `題組 ${g} 文章超過 300 字`, code);
      positions.add(sub.map((q) => q.slot).sort().join(","));
    }
    if (positions.size > 1) err(9, `${code} 有一組以上題組`, code);

    // 第 10 條：故事卡
    const st = storyBy.get(code);
    if (!st) err(10, `${code} 沒有故事卡`, code);
    else if (len(st.body) < 40 || len(st.body) > 60) err(10, `${code} 故事卡內文 ${len(st.body)} 字（應 40–60）`, code);
  }

  // 逐題：第 3、4、5、7、8 條
  for (const q of B.questions) {
    const qerr = (r, m) => err(r, m, q.level);
    const { map, bad } = parseOptionBlindspots(q.optionBlindspots);
    for (const line of bad) qerr(4, `${q.id} 選項盲點有無法解析或重複的行：${line}`);
    let wrongKeys = [];
    if (q.type === "選擇") {
      const opts = q.options ?? [];
      if (opts.length !== 4 || opts.some(blank) || new Set(opts.map((o) => o.trim())).size !== 4)
        qerr(3, `${q.id} 選項不是四個互不相同的文字`);
      if (!/^[A-D]$/.test(q.answer ?? "")) qerr(3, `${q.id} 正確答案不是 A–D`);
      wrongKeys = ["A", "B", "C", "D"].filter((k) => k !== q.answer);
      if (map.has(q.answer)) qerr(4, `${q.id} 正確選項 ${q.answer} 不能出現在選項盲點`);
    } else if (q.type === "配合") {
      const L = q.left ?? [], R = q.right ?? [];
      if (L.length !== R.length) qerr(8, `${q.id} 左右兩欄數量不同`);
      if (new Set(L).size !== L.length || new Set(R).size !== R.length) qerr(8, `${q.id} 配合題項目重複`);
      if (L.length !== Number(q.span)) qerr(8, `${q.id} 對數 ${L.length} ≠ 占格 ${q.span}`);
      wrongKeys = L.map((_, i) => String(i + 1)); // 每一對配錯都要掛盲點
    } else {
      qerr(3, `${q.id} 題型「${q.type}」不是自學星圖用的選擇或配合`);
    }
    for (const k of wrongKeys) if (!map.has(k)) qerr(4, `${q.id} 錯誤選項 ${k} 沒有掛盲點`);
    for (const [k, c] of map) {
      if (q.type === "選擇" && !wrongKeys.includes(k)) continue; // 已在上面報正確選項
      if (q.type === "配合" && !wrongKeys.includes(k)) qerr(4, `${q.id} 選項盲點的 ${k} 不是配合題的項目`);
      const bs = bsBy.get(c);
      if (!bs) qerr(4, `${q.id} 選項 ${k} 的盲點 ${c} 不存在`);
      else if (bs.level !== q.level) qerr(4, `${q.id} 選項 ${k} 的盲點 ${c} 不屬於 ${q.level}`);
    }
    if (!sameSet(new Set(map.values()), new Set(q.blindspots ?? [])))
      qerr(5, `${q.id} 盲點關聯和選項盲點列出的代碼不一致`);
    if (blank(q.hint1) || blank(q.hint2)) qerr(7, `${q.id} 提示1 或提示2 是空的`);
    if (blank(q.explanation)) qerr(7, `${q.id} 解析是空的`);
    if (!blank(q.mother) && !qBy.has(q.mother)) qerr(2, `${q.id} 的母題 ${q.mother} 不存在`);
    // 第 15 條：素材（圖表單題沒有題組也可以有圖；文章只能在題組）
    const mt = q.materialType ?? "";
    if (blank(q.material) !== blank(mt)) qerr(15, `${q.id} 共用素材和素材類型要同時有或同時空`);
    else if (mt && mt !== "文章" && mt !== "圖表") qerr(15, `${q.id} 素材類型「${mt}」不是文章或圖表`);
    else if (mt === "文章" && blank(q.group)) qerr(15, `${q.id} 文章素材只能放在題組`);
    else if (mt === "圖表") for (const p of chartProblems(q.material)) qerr(15, `${q.id} 圖表素材：${p}`);
  }

  // 第 6 條：盲點
  for (const b of B.blindspots) {
    if (!kpBy.has(b.kp)) err(6, `盲點 ${b.code} 沒有知識點或知識點不存在`, b.level);
    if (blank(b.fix) || blank(b.ex) || blank(b.chk)) err(6, `盲點 ${b.code} 秘笈卡三段有空的`, b.level);
  }

  // 第 12 條：存檔最壞情況
  const saveSize = {};
  for (const book of B.books) {
    const lvCodes = [...levels].filter(([, v]) => v.book === book.code).map(([c]) => c);
    const bsCodes = B.blindspots.filter((b) => lvCodes.includes(b.level)).map((b) => b.code);
    saveSize[book.code] = worstSaveBytes(book.code, lvCodes, bsCodes);
    if (saveSize[book.code] > SAVE_LIMIT_BYTES)
      err(12, `題本 ${book.code} 存檔最壞情況 ${saveSize[book.code]} bytes，超過 ${SAVE_LIMIT_BYTES}`);
  }

  // 第 14 條：觀念複習卡關聯（連不到只列清單，科目不同才算錯）
  const cardBy = new Map(B.reviewCards.map((c) => [c.name, c]));
  const noReviewCard = [];
  for (const k of B.kps) {
    if (blank(k.reviewCard)) { noReviewCard.push(k.code); continue; }
    const c = cardBy.get(k.reviewCard);
    if (!c) err(14, `知識點 ${k.code} 連到的觀念複習卡「${k.reviewCard}」不存在`);
    else if (c.subject !== k.subject) err(14, `知識點 ${k.code} 連到的觀念複習卡科目不同（${c.subject}）`);
  }

  // 第 13 條：上線門檻（fail-closed），結果只決定輸出，不算錯誤
  const publishable = {};
  for (const [code] of levels) {
    const qs = qByLevel.get(code) ?? [];
    const used = new Set(qs.flatMap((q) => q.blindspots ?? []));
    const st = storyBy.get(code);
    const errInLevel = [...errs.values()].some((e) => e.level === code);
    publishable[code] =
      !errInLevel &&
      qs.length > 0 && (units14(qs) === 14) &&
      qs.every((q) => q.status === "可用") &&
      [...used].every((c) => bsBy.get(c)?.status === "可用") &&
      st?.status === "可用";
  }

  return { errors: [...errs.values()].sort((a, b) => a.rule - b.rule), publishable, noReviewCard, saveSize };
}

/** 一關的「題數」：配合題一對算一題（§四之一），14＝7 格 × 2 */
function units14(qs) {
  return qs.reduce((n, q) => n + (Number(q.span) || 1), 0);
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const r = checkBundle(JSON.parse(readFileSync(process.argv[2], "utf8")));
  for (const e of r.errors) console.log(`✗ 第 ${e.rule} 條｜${e.msg}`);
  console.log(`錯誤 ${r.errors.length} 筆`);
  console.log(`可上線關卡：${Object.entries(r.publishable).filter(([, v]) => v).map(([k]) => k).join("、") || "（無）"}`);
  console.log(`存檔最壞情況：${JSON.stringify(r.saveSize)}`);
  if (r.noReviewCard.length) console.log(`沒有對應觀念卡（交老師）：${r.noReviewCard.join("、")}`);
  process.exit(r.errors.length ? 1 : 0);
}
