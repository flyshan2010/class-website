/**
 * R18 課堂事件包入庫規則（純函式，不連網、不寫任何資料）
 * 規則正本：ClassOS_v3.5_藍圖/SPEC_R18事件包入庫腳本.md §3（從 07 §四之四 搬來，一條不改）。
 * 切換後「程式與測試即規則」——改這裡一定要同步改 sim/cm-events.mjs 的題目。
 *
 * ⚠️ 兩處規格沒寫死、先照 07 的實例解讀，對照期（§5 第 3 步）會用 Sonnet 實寫值驗證：
 *   1. 程度：班規的 bad 行為 level 是負數（−1／−2；⑩ 是 −9）。取絕對值落在 1–3 才寫
 *      （與 R01「程度＝|±N|，只接受 1–3」一致；⑩ −200 定額不算程度 → 空白）。
 *   2. 事件描述括號：07 兩個實例「干擾課堂（數學）」「午餐後沒潔牙，也沒有補刷」的原始事件都帶 period，
 *      但標題都沒出現 period → 括號只補 subj。
 */
import { academicYearValue } from "./academic-year.mjs";

export const FINGERPRINT = "#CM-EVENTS";

/** 第一行以 #CM-EVENTS 開頭＝R18。 */
export const isR18 = (text) => String(text ?? "").split("\n")[0].trim().startsWith(FINGERPRINT);

/**
 * 解析事件包：取**第二行起**第一個 `{` 之後全部。失敗＝E06（整件一筆都不寫）。
 * 07 原文是「取第一個 `{`」；首行摘要不含 `{` 時兩者相同。從第二行找是防首行摘要
 * （含「⚠ 前次送出失敗…」錯誤原文）哪天帶了 `{` 而整包誤判 E06。
 */
export function parsePacket(text) {
  const s = String(text ?? "");
  const nl = s.indexOf("\n");
  const i = nl < 0 ? -1 : s.indexOf("{", nl);
  if (!isR18(s) || i < 0) return { ok: false, code: "E06" };
  let body;
  try { body = JSON.parse(s.slice(i)); } catch { return { ok: false, code: "E06" }; }
  if (!body || !Array.isArray(body.events) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? ""))) {
    return { ok: false, code: "E06" };
  }
  // 逐筆不重複帶 tool／date（前端省字數），由外層 envelope 補回
  const events = body.events.map((e) => ({ tool: body.tool, date: body.date, ...e }));
  return { ok: true, body: { ...body, events } };
}

/** weeks.json → 該日的週次標籤（先比起迄，再比預排日；都查無＝空字串＝假期）。 */
export function weekLabel(date, weeks) {
  const terms = weeks?.學期 ?? [];
  for (const t of terms) for (const w of t.週 ?? []) if (w.起 <= date && date <= w.迄) return w.標籤;
  for (const t of terms) for (const w of t.週 ?? []) if ((w.預排日 ?? []).includes(date)) return w.標籤;
  return "";
}

/** class-rules.json 找行為：rule_n＋kind（good／bad）＋act_i。 */
export function findRuleAct(rules, ruleN, kind, actI) {
  const card = (rules?.cards ?? []).find((c) => c.n === Number(ruleN));
  const list = card?.[kind === "good" ? "good" : "bad"];
  return list?.[Number(actI ?? 0)] ?? null;
}

const RULE_CAT = { 1: "生活指導", 2: "人際互動", 3: "生活技能", 4: "作業", 6: "生活指導", 7: "生活指導", 8: "人際互動", 9: "課堂表現", 10: "生活指導" };

/** 類別；判不出回 null（呼叫端記失敗「類別判不出，需人工」，不寫入）。 */
export function categoryOf(ev) {
  if (ev.src === "rule") {
    if (Number(ev.rule_n) === 5) return ev.kind === "good" ? "人際互動" : "課堂表現";
    return RULE_CAT[Number(ev.rule_n)] ?? null;
  }
  const act = String(ev.act ?? "");
  if (act.includes("打掃") || act.includes("午餐")) return "生活技能";
  if (act.includes("作業")) return "作業";
  if (act === "常規未達成") return "生活指導";
  if (act.includes("小組")) return "課堂表現";
  if (ev.subj) return "課堂表現";
  return null;
}

/** 事件描述（週結靠這些字串撈，逐字固定）。 */
export function describe(ev) {
  const act = String(ev.act ?? "");
  if (ev.src === "rule") return ev.subj ? `${act}（${ev.subj}）` : act;
  // 小組加分／扣分與舉手回答同一格式：「在數學課小組加分」「在數學課舉手回答」
  return ev.subj ? `在${ev.subj}課${act}` : act;
}

const PN = { good: "＋", bad: "－", neutral: "中性" };

/**
 * 科目（2026-09-25 回溯第 3 週補上：SPEC 原表漏了這欄，但 class-report 的國語／數學／社會分數
 * 只撈「課堂表現且科目相符」的列，不寫就會讓課堂紀錄掉出科目分數）。
 * routine 實寫 27/27 都是「科目＝subj」；紀錄庫選項只有國語／數學／社會／其他 → 其餘科目歸「其他」。
 */
export const subjectOf = (ev) => (!ev.subj ? "" : ["國語", "數學", "社會"].includes(ev.subj) ? ev.subj : "其他");

/**
 * 作業科目（2026-10-02 老師裁定方案 A）：作業類紀錄另寫多選欄「作業科目」，**不拆列、不改 id、不動事件描述與金幣**。
 * 為什麼不拆列：班規④「同一人同一天多份未交合併一列、只扣一次 −5」是定案規則，f29 依「每列 金幣影響」入帳、
 *   學習報告作業分數負向每列扣一次——拆成一科一列會變成一天最多 −15；tally 加 subj 也會改掉 sig／id（重送不再略過）
 *   與事件描述（f24 逐字比對「作業完成」會撈不到，⑥ 全班不給）。
 * 判法：備註＝作業名＋（MM-DD 派），多份以「、」串接 → 每一份看開頭縮寫（RULE_聯絡簿作業排程.md）。
 *   任何一份判不出就加「需人工」（U53：不猜）；「統整園地」是數學習作的單元名。
 *   「聯絡簿」天天都在作業清單裡但不屬任何科 → 不計科目；國數社以外的科（考自然U1）→ 其他（與科目欄同口徑）。
 *   開頭可帶「考」（考自然U1）。f38 回填第 1–5 週實測（run 37025801239）判不出的只有這兩種與空備註。
 */
export const HW_MANUAL = "需人工";
const HW_PREFIX = [
  ["國語", /^考?(國習|國練|國作|國甲|國乙|國卷|甲本|乙本|預習國|國語)/],
  ["數學", /^考?(數習|數練|數卷|數學|統整園地)/],
  ["社會", /^考?(社習|社練|社卷|社會)/],
  ["其他", /^考?(自然|英語|英文)/],
  ["", /^聯絡簿/],   // 不屬任何科：不計、也不算判不出
];
const HW_ORDER = ["國語", "數學", "社會", "其他", HW_MANUAL];
const hwOrder = (set) => HW_ORDER.filter((s) => set.has(s));

/** 單份作業名 → 科目；不屬任何科（聯絡簿）回 ""；判不出回 null。 */
export const hwSubjectOfItem = (name) => (HW_PREFIX.find(([, re]) => re.test(String(name ?? "").trim())) ?? [null])[0];

/** 作業清點的備註（可能多份）→ 科目陣列（固定順序、去重）；空備註或有一份判不出 → 含「需人工」。 */
export function hwSubjectsOf(note) {
  const items = String(note ?? "").split("、").map((x) => x.trim()).filter(Boolean);
  const set = new Set(items.length ? items.map((x) => hwSubjectOfItem(x) ?? HW_MANUAL) : [HW_MANUAL]);
  set.delete("");   // 只有聯絡簿＝不屬任何科 → 空陣列
  return hwOrder(set);
}

/**
 * 一筆事件／紀錄的作業科目。只有類別＝作業才有值：
 *   作業清點（tool＝homework）→ 從備註判；其他工具或老師一句話的作業列 → 用科目欄；都沒有 → 需人工。
 */
export function hwSubjectsFor({ category, tool, note, subject }) {
  if (category !== "作業") return [];
  if (tool === "homework") return hwSubjectsOf(note);
  return subject ? [subject] : [HW_MANUAL];
}

/** coin 字串（可能是 U+2212 減號）→ 數字；轉不成回 null（絕不回 0）。 */
export function coinNumber(coin) {
  const s = String(coin ?? "").trim().replace(/−/g, "-").replace(/^\+/, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * 舉手回答計次＝主動發表（學習報告評分標準 v2 §2，老師 2026-09-28 裁定）：入庫就記程度 1、+5 幣，
 * 走週結 ② 一般獎懲入帳。每生每科每天只給一筆（09-05 拍板 #8）——同天同科已有「有金幣的課堂正向」
 * （一句話記的主動發表，或先前已入庫的舉手回答）→ **不寫入**（action "drop"）。
 * 老師 2026-09-28 裁定：不給金幣的列不要記，學生看到 0 幣的舉手列會以為帳目有問題。
 * handKey 的「科目」用 subj 原文（自然、英語不併成「其他」）；既有列從事件描述「在X課」取，取不到才用科目欄。
 */
export const HAND_ACT = "舉手回答", HAND_COIN = 5;
export const handKey = (student, subj) => `${String(student).replace(/-/g, "")}|${subj ?? ""}`;
/** 某天紀錄庫既有列 → 已發過課堂正向金幣的 (學生|科目) 集合。rows：fromNotionPage 的結果。 */
export function handPaidFrom(rows) {
  const set = new Set();
  for (const r of rows) {
    if (r.類別 !== "課堂表現" || r.正負向 !== "＋" || !(r.金幣影響 > 0)) continue;
    const subj = (String(r.事件描述 ?? "").match(/在(.+?)課/) || [])[1] ?? r.科目 ?? "";
    for (const st of String(r.學生 ?? "").split(",").filter(Boolean)) set.add(handKey(st, subj));
  }
  return set;
}

/**
 * 單筆事件 → 應寫值或處置。三道關卡順序不可調：防重複 → 金幣核對 → tally 不入帳（舉手回答例外，見上）。
 * 回傳另有 { action:"drop", seat, why }＝刻意不寫（同天同科舉手已給過 +5），不算失敗、也不算已入庫。
 * ctx: { rules, weeks, roster: Map(座號→頁面id), existingIds: Set }
 * 回傳 { action:"skip" } | { action:"fail", seat, code, why } | { action:"write", seat, row }
 */
export function planEvent(ev, ctx) {
  const seat = Number(ev.seat);
  if (ctx.existingIds.has(ev.id)) return { action: "skip", seat };
  if (!ev.id) return { action: "fail", seat, code: "E06", why: "事件缺 id" };
  const kindPN = PN[ev.kind];
  if (!kindPN) return { action: "fail", seat, code: "E06", why: `正負向不明（${ev.kind}）` };
  const student = ctx.roster.get(seat);
  if (!student) return { action: "fail", seat, code: "E01", why: "名冊查無此座號" };

  let level = null;
  let coin = 0;
  if (ev.src === "rule") {
    const ref = findRuleAct(ctx.rules, ev.rule_n, ev.kind, ev.act_i);
    if (!ref) return { action: "fail", seat, code: "E07", why: `班規查無此行為（${ev.rule_n}/${ev.kind}/${ev.act_i}）` };
    // 字串比字串：先轉數字再比，轉換失敗會變 NaN != NaN 而全部誤判
    if (String(ev.coin) !== String(ref.coin) || String(ev.level) !== String(ref.level)) {
      return { action: "fail", seat, code: "E07", why: `班規幣值不符（工具 ${ev.coin}／班規 ${ref.coin}）` };
    }
    coin = coinNumber(ev.coin);
    if (coin === null) return { action: "fail", seat, code: "E07", why: `幣值無法轉成數字（${ev.coin}）` };
    const lv = Math.abs(Number(ev.level));
    level = Number.isInteger(lv) && lv >= 1 && lv <= 3 ? lv : null;
  } else if (ev.src !== "tally") {
    return { action: "fail", seat, code: "E06", why: `來源不明（${ev.src}）` };
  }

  const cat = categoryOf(ev);
  if (!cat) return { action: "fail", seat, code: "需人工", why: "類別判不出，需人工" };

  // 舉手回答＝主動發表：每生每科每天第一筆記 +5／程度 1（ctx.handPaid 由呼叫端依當天紀錄庫建立，本包內也會累加）
  if (ev.src === "tally" && ev.act === HAND_ACT && ev.kind === "good") {
    const k = handKey(student, ev.subj);
    const paid = ctx.handPaid ?? new Set();
    if (paid.has(k)) return { action: "drop", seat, why: "同天同科已給過主動發表 +5，不另記" };
    level = 1; coin = HAND_COIN; paid.add(k);
  }

  return {
    action: "write",
    seat,
    row: {
      事件描述: describe(ev),
      學生: student,
      事件id: ev.id,
      次數: ev.count == null ? 1 : Number(ev.count),
      正負向: kindPN,
      備註: ev.note ? String(ev.note) : "",
      程度: level,
      金幣影響: coin,
      日期: ev.date,
      學年: academicYearValue(ev.date),
      週次: weekLabel(ev.date, ctx.weeks),
      類別: cat,
      科目: subjectOf(ev),
      作業科目: hwSubjectsFor({ category: cat, tool: ev.tool, note: ev.note, subject: subjectOf(ev) }),
    },
  };
}

/** 整包規劃。同包內重複 id 也視為已入庫（第二筆略過）。 */
export function planPacket(text, ctx) {
  const p = parsePacket(text);
  if (!p.ok) return { fatal: "E06", results: [] };
  const seen = new Set(ctx.existingIds);
  const handPaid = ctx.handPaid ?? new Set(); // 同包兩筆同科舉手只給一次 +5
  const results = p.body.events.map((ev) => {
    const r = planEvent(ev, { ...ctx, existingIds: seen, handPaid });
    if (r.action === "write") seen.add(ev.id);
    return r;
  });
  return { fatal: null, date: p.body.date, results };
}

/** 收件匣執行紀錄（與現行 routine 同格式；Notion 非公開，可列座號）。 */
export function execLog(results) {
  const n = results.filter((r) => r.action === "write").length;
  const m = results.filter((r) => r.action === "skip").length;
  const f = results.filter((r) => r.action === "fail");
  const d = results.filter((r) => r.action === "drop").length;
  const seats = [...new Set(f.map((r) => r.seat))].sort((a, b) => a - b);
  return `已入庫 ${n} 筆／略過 ${m} 筆（已入庫）` + (d ? `／不記 ${d} 筆（同天同科舉手已給過 +5）` : "")
    + `／失敗 ${f.length} 筆` + (f.length ? `：座號${seats.join("、")}` : "");
}

/** 任務狀態：全數失敗才記失敗（每一筆都失敗；有任何一筆寫入或略過就算已完成）。 */
export function taskStatus(results) {
  const f = results.filter((r) => r.action === "fail").length;
  return f > 0 && f === results.length ? "失敗" : "已完成";
}

/** 失敗明細（寫進收件匣「錯誤訊息」，Notion 非公開）。 */
export function failDetail(results) {
  return results.filter((r) => r.action === "fail").map((r) => `座號${r.seat} ${r.code} ${r.why}`).join("；");
}

const rt = (s) => (s ? [{ type: "text", text: { content: String(s).slice(0, 2000) } }] : []);

/** 應寫值 → Notion properties（型別對照 RULE_Notion操作限制 §5a：number 一律數字、relation 用頁面 id）。 */
export function toNotionProps(row) {
  return {
    事件描述: { title: rt(row.事件描述) },
    學生: { relation: [{ id: row.學生 }] },
    事件id: { rich_text: rt(row.事件id) },
    次數: { number: row.次數 },
    正負向: { select: { name: row.正負向 } },
    備註: { rich_text: rt(row.備註) },
    程度: { number: row.程度 },
    金幣影響: { number: row.金幣影響 },
    日期: { date: { start: row.日期 } },
    學年: { select: { name: row.學年 } },
    週次: { rich_text: rt(row.週次) },
    類別: { select: { name: row.類別 } },
    科目: { select: row.科目 ? { name: row.科目 } : null },
    作業科目: { multi_select: (row.作業科目 ?? []).map((name) => ({ name })) },
  };
}

/** Notion 頁面 → 與應寫值同形的物件（對照與回讀共用）。 */
export function fromNotionPage(page) {
  const p = page.properties ?? {};
  const text = (x) => (x?.title ?? x?.rich_text ?? []).map((t) => t.plain_text).join("");
  return {
    事件描述: text(p.事件描述),
    學生: (p.學生?.relation ?? []).map((r) => r.id.replace(/-/g, "")).join(","),
    事件id: text(p.事件id),
    次數: p.次數?.number ?? null,
    正負向: p.正負向?.select?.name ?? "",
    備註: text(p.備註),
    程度: p.程度?.number ?? null,
    金幣影響: p.金幣影響?.number ?? null,
    日期: p.日期?.date?.start ?? "",
    學年: p.學年?.select?.name ?? "",
    週次: text(p.週次),
    類別: p.類別?.select?.name ?? "",
    科目: p.科目?.select?.name ?? "",
    作業科目: (p.作業科目?.multi_select ?? []).map((o) => o.name),
  };
}

export const COMPARE_FIELDS = ["事件描述", "學生", "次數", "正負向", "備註", "程度", "金幣影響", "日期", "學年", "週次", "類別", "科目", "作業科目"];

/** 逐欄比對應寫值與實際值，回傳不同的欄位名。 */
export function diffRow(expected, actual) {
  const norm = (k, v) => (k === "學生" ? String(v ?? "").replace(/-/g, "")
    : Array.isArray(v) ? [...v].sort().join("、")   // 多選欄（作業科目）：順序不算差異
    : v ?? (k === "程度" ? null : ""));
  return COMPARE_FIELDS.filter((k) => norm(k, expected[k]) !== norm(k, actual[k]));
}
