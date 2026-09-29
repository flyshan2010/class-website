/**
 * R13 作品入庫規則本體（純函式，不連 Notion）
 * ───────────────────────────────────────────────────────────────
 * 規格：ClassOS_v3.5_藍圖/SPEC_R13作品入庫腳本.md；解析表正本 .claude/skills/class-portfolio/RUNBOOK_class-portfolio.md §3。
 * 測試：scripts/classos/sim/r13-works.mjs（改規則先改測試）。
 *
 * 照片對應（2026-09-29 老師裁定）：
 *   1 個座號          → 所有照片給他
 *   多座號＋1 張照片  → 合作作品，每人共用這張
 *   多座號＋多張照片  → 依「檔名裡的座號」一人一張以上；任一張對不到、或有人分不到 → 待審，不猜順序
 */
import { weekLabel } from "./cm-events.mjs";
import { academicYearValue } from "./academic-year.mjs";

const SEP = "[\\s、,，和與及跟]+";
// 句首座號串：「19 23 …」「座號3和5的…」「12號 作品…」
const SEAT_RUN = new RegExp(`^(?:座號\\s*)?(\\d{1,2})(?:號)?((?:${SEP}(?:座號\\s*)?\\d{1,2}(?:號)?)*)`);
const PREFIX = /^(?:這是|上傳作品\s*[:：]?)\s*/;
const TYPE_RULES = [
  ["美勞", /美勞|美術|勞作|畫/],
  ["寫作", /作文|日記|心得/],
  ["國語", /國語|國文/],
  ["數學", /數學/],
  ["社會", /社會/],
  ["自然", /自然/],
];

/** 路由判斷：附件存在＋（作品／佳作），且不是 R18 事件包（登記簿附件路由 R13 排最前）。 */
export function isR13(text, fileCount) {
  const t = String(text ?? "");
  if (t.split("\n")[0].trim().startsWith("#CM-EVENTS")) return false;
  return fileCount > 0 && /作品|佳作/.test(t);
}

/** 解析一句話 → { ok, seats, rest } 或 { ok:false, code, why }。 */
export function parseSentence(text) {
  const s = String(text ?? "").trim().replace(PREFIX, "");
  const m = s.match(SEAT_RUN);
  if (!m) return { ok: false, code: "E01", why: "句首找不到座號（請寫「座號12 作品 ○○」或「19 23 ○○作品」）" };
  let after = s.slice(m[0].length);
  // 座號後面緊接數字相關符號＝日期或區間，不是座號串（「9/29 作品」「座號1-3」）
  if (/^[\/\-~–－～.．月點]/.test(after) || /^\d/.test(after)) {
    return { ok: false, code: "E03", why: "看不出座號（作品入庫不支援日期開頭或座號區間，請逐一列出座號）" };
  }
  const seats = [...new Set(m[0].match(/\d{1,2}/g).map(Number))];
  const rest = after.replace(/^[\s的:：、,，]+/, "").trim();
  return { ok: true, seats, rest };
}

/** 作品名：「作品」開頭取其後文字；否則整句（去掉包住全句的引號）；空＝「{M/D}{類型}作品」。 */
export function workName(rest, type, date) {
  let r = String(rest ?? "").trim();
  const m = r.match(/^(?:的)?作品[\s:：]*(.*)$/);
  if (m) r = m[1].trim();
  r = r.replace(/^[「『"“](.*)[」』"”]$/, "$1").trim();
  if (r) return r;
  const [, mm, dd] = String(date).split("-").map(Number);
  return `${mm}/${dd}${type === "其他" ? "" : type}作品`;
}

export function workType(text) {
  for (const [name, re] of TYPE_RULES) if (re.test(String(text ?? ""))) return name;
  return "其他";
}

/** 從檔名取座號：去掉代理加的時間戳與副檔名，取 1–2 位且不以 0 開頭的獨立數字，落在句中座號內且只有一個才算。 */
export function seatFromFilename(name, seats) {
  const base = String(name ?? "")
    .replace(/\.[A-Za-z0-9]{2,5}$/, "")
    .replace(/^\d{8}-\d{6}_/, "");
  if (!base || /^附件\d+$/.test(base)) return null; // 舊版代理只給「附件N」，沒有原檔名
  const nums = (base.match(/(?<!\d)\d+(?!\d)/g) ?? []).filter((n) => /^[1-9]\d?$/.test(n)).map(Number);
  const hit = [...new Set(nums.filter((n) => seats.includes(n)))];
  return hit.length === 1 ? hit[0] : null;
}

/** 照片分配 → { ok, bySeat:Map<seat,files[]> } 或 { ok:false, why }。files＝[{ name, url }]。 */
export function assignPhotos(seats, files) {
  const bySeat = new Map(seats.map((s) => [s, []]));
  if (seats.length === 1 || files.length === 1) {
    for (const s of seats) bySeat.set(s, [...files]);
    return { ok: true, bySeat };
  }
  const miss = [];
  files.forEach((f, i) => {
    const seat = seatFromFilename(f.name, seats);
    if (seat == null) miss.push(`第${i + 1}張`);
    else bySeat.get(seat).push(f);
  });
  const empty = seats.filter((s) => !bySeat.get(s).length);
  if (miss.length || empty.length) {
    const why = [
      miss.length ? `${miss.join("、")}照片檔名對不到座號` : "",
      empty.length ? `座號${empty.join("、")}沒有分到照片` : "",
    ].filter(Boolean).join("；");
    return { ok: false, why: `${why}（多位學生多張照片時，檔名請帶座號，例如 19教師節畫.jpg）` };
  }
  return { ok: true, bySeat };
}

/**
 * 整件規劃（不寫任何東西）。
 * task＝{ text, files:[{name,url,external}], date:"YYYY-MM-DD" }；ctx＝{ roster:Map<seat,pageId>, weeks, existing:Set<"座號|作品|日期"> }
 * 回傳 { status:"write"|"review"|"fail", code?, why?, rows:[{ seat, action:"write"|"skip", props }] }
 */
export function planTask(task, ctx) {
  const { text, files, date } = task;
  if (!files.length) return { status: "fail", code: "E61", why: "沒有收到作品照片，請附照片後重送", rows: [] };
  if (files.some((f) => !f.external)) {
    return { status: "review", why: "附件是 Notion 直接上傳的檔案，程式無法搬移，請在對話執行 /class-portfolio", rows: [] };
  }
  const p = parseSentence(text);
  if (!p.ok) return { status: "fail", code: p.code, why: p.why, rows: [] };
  const off = p.seats.filter((s) => !ctx.roster.has(s));
  if (off.length) return { status: "fail", code: "E01", why: `座號${off.join("、")}不在名冊或已不在學`, rows: [] };
  const a = assignPhotos(p.seats, files);
  if (!a.ok) return { status: "review", why: a.why, rows: [] };

  const type = workType(text);
  const name = workName(p.rest, type, date);
  const week = weekLabel(date, ctx.weeks);
  const year = academicYearValue(date);
  const rows = p.seats.map((seat) => {
    const key = `${seat}|${name}|${date}`;
    return {
      seat, key, photos: a.bySeat.get(seat).length,
      action: ctx.existing?.has(key) ? "skip" : "write",
      props: {
        作品: { title: [{ text: { content: name } }] },
        日期: { date: { start: date } },
        週次: { rich_text: week ? [{ text: { content: week } }] : [] },
        座號: { number: seat },
        學生: { relation: [{ id: ctx.roster.get(seat) }] },
        類型: { select: { name: type } },
        照片: { files: a.bySeat.get(seat).map((f) => ({ name: f.name.slice(0, 100), type: "external", external: { url: f.url } })) },
        說明: { rich_text: p.rest ? [{ text: { content: p.rest.slice(0, 2000) } }] : [] },
        發布: { checkbox: true },
        學年: { select: { name: year } },
      },
    };
  });
  return { status: "write", name, type, week, year, rows };
}

/** 收件匣執行紀錄（≤100 字，只稱座號）。 */
export function execLog(plan) {
  if (plan.status !== "write") return plan.why;
  const w = plan.rows.filter((r) => r.action === "write");
  const k = plan.rows.filter((r) => r.action === "skip");
  const list = w.map((r) => `座號${r.seat}（${r.photos}張）`).join("、");
  const when = plan.week ? `將出現在${plan.week.replace(/\(.*$/, "")}報告` : "將收錄於期末作品牆";
  const parts = [];
  if (w.length) parts.push(`已入庫作品〈${plan.name}〉：${list}（${plan.type}），${when}`);
  if (k.length) parts.push(`座號${k.map((r) => r.seat).join("、")}已入庫過，略過`);
  return parts.join("；").slice(0, 100);
}
