// 自學星圖題本檔（規格正本：ClassOS_v3.5_藍圖/SPEC_自學星圖_P2前台與線上紀錄.md §3）
// 班網同步 sync-notion.mjs 呼叫：Notion 各表列（props() 後的物件）→ 資料包 → checkBundle → data/study-orbit/*.json
// 純函式，不打 Notion、不寫檔；讀 Notion 與寫檔在 sync-notion.mjs。
import { checkBundle, parseOptionBlindspots } from "./check.mjs";

const txt = (v) => String(v ?? "").trim();
const num = (v) => (v === "" || v == null ? null : Number(v));
const LINE_OPT = /^([A-D])[.．、]\s*(.*)$/;
const LINE_LEFT = /^(\d+)[.．、]\s*(.*)$/;

/** 「選項」欄拆成選擇題四個選項，或配合題左右兩欄（P1 SPEC §3.6 配合題寫法） */
export function parseOptions(type, text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const opts = {}, left = [], right = {};
  for (const l of lines) {
    let m;
    if ((m = LINE_OPT.exec(l))) (type === "配合" ? right : opts)[m[1]] = m[2].trim();
    else if ((m = LINE_LEFT.exec(l))) left[Number(m[1]) - 1] = m[2].trim();
  }
  if (type === "配合") return { left, right: "ABCD".split("").filter((k) => k in right).map((k) => right[k]) };
  return { options: "ABCD".split("").map((k) => opts[k] ?? "") };
}

/**
 * Notion 列 → check.mjs 資料包。
 * @param {{books:object[], structures:Map<string,object|null>, kps:object[], blindspots:object[],
 *          stories:object[], questions:object[], reviewCards:object[]}} raw
 *   各表都是 props(page) 後的物件（含 _id）；structures＝題本頁 id → 內文的結構 JSON
 */
export function bundleFromNotion(raw) {
  const codeOf = (rows, key) => new Map(rows.map((r) => [r._id, txt(r[key])]));
  const bookCode = codeOf(raw.books, "代碼");
  const kpCode = codeOf(raw.kps, "代碼");
  const bsCode = codeOf(raw.blindspots, "代碼");
  const qCode = codeOf(raw.questions, "題目ID");
  const cardBy = new Map(raw.reviewCards.map((r) => [r._id, r]));
  const one = (ids, map) => map.get((ids ?? [])[0]) ?? "";
  const many = (ids, map) => (ids ?? []).map((id) => map.get(id)).filter(Boolean);

  return {
    books: raw.books.map((r) => ({
      code: txt(r["代碼"]), name: txt(r["名稱"]), subject: r["科目"], status: r["狀態"],
      semester: `${r["年級"] || ""}${r["學期"] || ""}`, updated: r["最後更新日期"]?.start ?? "",
      structure: raw.structures.get(r._id) ?? { islands: [] },
    })),
    kps: raw.kps.map((r) => ({
      code: txt(r["代碼"]), name: txt(r["名稱"]), subject: r["科目"], book: one(r["題本"], bookCode),
      level: txt(r["關卡代碼"]), reviewCard: txt(cardBy.get((r["觀念複習卡"] ?? [])[0])?.["卡名"]), status: r["狀態"],
    })),
    blindspots: raw.blindspots.map((r) => ({
      code: txt(r["代碼"]), name: txt(r["卡名"]), kp: one(r["知識點"], kpCode), level: txt(r["關卡代碼"]),
      fix: txt(r["正確的想法"]), ex: txt(r["看例子"]), chk: txt(r["檢查口訣"]), status: r["狀態"],
    })),
    stories: raw.stories.map((r) => ({
      level: txt(r["關卡代碼"]), book: one(r["題本"], bookCode), title: txt(r["標題"]), body: txt(r["內文"]), status: r["狀態"],
    })),
    questions: raw.questions.filter((r) => txt(r["關卡代碼"])).map((r) => ({
      id: txt(r["題目ID"]), type: r["題型"], level: txt(r["關卡代碼"]), slot: num(r["格"]), span: num(r["占格"]) ?? 1,
      mother: one(r["母題"], qCode), kp: one(r["知識點"], kpCode), blindspots: many(r["盲點"], bsCode),
      optionBlindspots: String(r["選項盲點"] ?? ""), ...parseOptions(r["題型"], r["選項"]), answer: txt(r["正確答案"]),
      stem: txt(r["題幹"]), hint1: txt(r["提示1"]), hint2: txt(r["提示2"]), explanation: txt(r["解析"]),
      group: txt(r["題組"]), material: String(r["共用素材"] ?? ""), materialType: r["素材類型"] || "", status: r["狀態"],
    })),
    reviewCards: raw.reviewCards.map((r) => ({ name: txt(r["卡名"]), subject: r["科目"], status: r["狀態"] })),
  };
}

/** 一本題本的資料包（只留這本的列，觀念卡整包帶著給第 14 條比對） */
function bundleOf(B, code) {
  const mine = (lv) => String(lv ?? "").startsWith(`${code}-`);
  return {
    books: B.books.filter((b) => b.code === code),
    kps: B.kps.filter((k) => mine(k.level)),
    blindspots: B.blindspots.filter((b) => mine(b.level)),
    stories: B.stories.filter((s) => mine(s.level)),
    questions: B.questions.filter((q) => mine(q.level)),
    reviewCards: B.reviewCards,
  };
}

/** 題目輸出格式（前台與代理讀）：去掉審題欄，選項盲點轉成 {選項: 盲點代碼} */
function outQuestion(q) {
  const o = { id: q.id, type: q.type, level: q.level, slot: q.slot, span: q.span };
  if (q.mother) o.mother = q.mother;
  o.kp = q.kp; o.stem = q.stem;
  if (q.type === "配合") { o.left = q.left; o.right = q.right; } else o.options = q.options;
  o.answer = q.answer;
  o.ob = Object.fromEntries(parseOptionBlindspots(q.optionBlindspots).map);
  o.hint1 = q.hint1; o.hint2 = q.hint2; o.explanation = q.explanation;
  if (q.group) o.group = q.group;
  if (q.materialType && q.material) { o.material = q.material; o.materialType = q.materialType; } // 圖表單題沒有題組也帶圖（SPEC §3.6.1）
  return o;
}

/**
 * 產生題本檔。只看狀態＝上線的題本；某本 checkBundle 有錯 → 這本不輸出（沿用上一版，index 也沿用上一版那一列）。
 * 一本裡只有通過第 13 條上線門檻的關卡會進結構與題目（fail-closed）。
 * @param {object} B bundleFromNotion() 的結果
 * @param {{books?:object[]}} prevIndex 上一版 index.json（讀不到給 {}）
 * @returns {{index:{books:object[]}, files:Record<string,object>, kept:string[], log:string[]}}
 */
export function buildBookFiles(B, prevIndex = {}) {
  const prevBy = new Map((prevIndex.books ?? []).map((b) => [b.code, b]));
  const index = [], files = {}, kept = [], log = [];
  for (const book of B.books.filter((b) => b.status === "上線").sort((a, b) => a.code.localeCompare(b.code))) {
    const one = bundleOf(B, book.code);
    const r = checkBundle(one);
    if (r.errors.length) {
      log.push(`❌ 題本 ${book.code} 檢核 ${r.errors.length} 錯，本次不輸出（沿用上一版）：`,
        ...r.errors.slice(0, 20).map((e) => `   第 ${e.rule} 條｜${e.msg}`));
      if (prevBy.has(book.code)) { index.push(prevBy.get(book.code)); kept.push(book.code); }
      continue;
    }
    const ok = new Set(Object.entries(r.publishable).filter(([, v]) => v).map(([k]) => k));
    const off = Object.keys(r.publishable).filter((k) => !ok.has(k));
    if (!ok.size) { log.push(`⏸️ 題本 ${book.code} 沒有可上線的關卡（${off.length} 關未達上線門檻），本次不列入`); continue; }
    if (off.length) log.push(`⏸️ 題本 ${book.code} 有 ${off.length} 關未達上線門檻，先不放：${off.join("、")}`);
    const structure = {
      islands: (book.structure.islands ?? [])
        .map((isl) => ({ ...isl, levels: (isl.levels ?? []).filter((lv) => ok.has(lv.code)) }))
        .filter((isl) => isl.levels.length),
    };
    const inOk = (x) => ok.has(x.level);
    const questions = one.questions.filter((q) => inOk(q) && q.status === "可用").map(outQuestion);
    const used = new Set(one.questions.filter(inOk).flatMap((q) => q.blindspots));
    files[book.code] = {
      code: book.code,
      kps: one.kps.filter((k) => inOk(k) && k.status === "可用").map(({ code, name, level, reviewCard }) => ({ code, name, level, reviewCard })),
      blindspots: one.blindspots.filter((b) => inOk(b) && b.status === "可用" && used.has(b.code))
        .map(({ code, name, kp, level, fix, ex, chk }) => ({ code, name, kp, level, card: { fix, ex, chk } })),
      stories: one.stories.filter((s) => inOk(s) && s.status === "可用").map(({ level, title, body }) => ({ level, title, body })),
      questions,
    };
    index.push({ code: book.code, subject: book.subject, semester: book.semester, title: book.name, updated: book.updated, structure });
    const units = questions.reduce((n, q) => n + (q.span || 1), 0);
    log.push(`✅ 題本 ${book.code}：${ok.size} 關、題目 ${questions.length} 列（${units} 題）、盲點 ${files[book.code].blindspots.length}、故事卡 ${files[book.code].stories.length}`);
  }
  return { index: { books: index }, files, kept, log };
}
