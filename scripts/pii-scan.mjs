/**
 * 提交前個資掃描（零相依，Node 18+）——同步流程的最後一道關卡
 * 用法：NOTION_TOKEN=secret_xxx node scripts/pii-scan.mjs
 *
 * 放在 sync.yml「提交更新」前一步：從 Notion 名冊取姓名與查詢碼，掃這次要提交的文字檔
 * （data/ 與 docs/routine-manual.md 裡有變動或新增的檔）。命中＝整次同步失敗、不提交。
 * 放在這裡而不是 sync-notion.mjs 的 save()：校網公告、日曆、Drive 相簿、排程手冊備份四支不經過 save()。
 *
 * 比對規則與本機推送前關卡（Project/Claude/dotclaude/scripts/pii-gate.py）同一套，改規則兩邊一起改，測試案例也兩邊同步：
 *   ・姓名（3 字以上）出現就擋
 *   ・查詢碼分兩級（老師 2026-10-10 裁定；查詢碼是 4 位純數字，孤零零的同值數字多半是巧合）：
 *       強命中＝擋：(a) 前後 NEAR 字元內有「查詢碼／密碼」字樣
 *                   (b) 前後 NEAR 字元內有同一位學生的姓名或座號（座號 N、N 號、seat: N）
 *                   (c) LIST_SPAN 字元內出現 LIST_MIN 個以上不同的查詢碼（名單型）
 *       弱命中＝不擋：其餘。只印「弱命中 N 處」；明細由每週系統健檢在本機用 pii-gate.py 看
 *   ・查詢碼前後緊鄰英數字的不算；緊鄰連字號、而連字號另一邊是英數字或連字號的也不算（雜湊、UUID、日期裡的片段）
 *     連字號的例外有兩種，前後都適用：
 *       ① 連字號另一邊是 1–2 位數字、再過去不是英數字或連字號（01-7391、7391-01）照算；
 *          那個數字是同一位學生的座號＝強命中 (b)，不是就照一般的查詢碼分級（成名單才擋）
 *       ② 連字號另一邊不是半形英數字也不是連字號（小明-7391、7391-甲、全形數字、行首行尾）照算，一般分級
 *   ・.json 檔出現名為「查詢碼」的欄位就擋，不看值
 *   ・手機號碼格式（09xx-xxx-xxx、連寫、空白分隔、+886 9xx…）與身分證字號格式（英文字母＋1/2/8/9＋8 碼且檢查碼正確）
 *     不必對得上名冊。公認的範例值不算（SAMPLE_OK）；前後緊鄰英數字、底線、連字號的不算。
 *     **這邊只通報不擋**（老師 2026-11-14 裁定：無人看管的同步不因一則含聯絡手機的公告就整次中止）：
 *     只印筆數（Actions 的 warning 註記），明細由每週系統健檢在本機用 pii-gate.py 看——本機那支是擋
 *   ・除了原文，另外把三種編碼寫法反解後各掃一份：\uXXXX（JSON 跳脫）、%XX（網址編碼）、&#NNN;／&#xHH;（HTML 實體）
 *   ・二進位檔（前 8000 位元組含 NUL，與 git 同一判法）只比對檔名
 *   ・文字檔一律當 UTF-8：這裡只掃同步腳本自己產的 JSON 與 Markdown。
 *     本機 pii-gate.py 另外會解 UTF-16 與 Big5（老師手動放進 repo 的 CSV）、解開 Office 檔掃 XML，這邊沒有那兩段
 *   ・已知限制（擋不到）：只寫名不寫姓、兩個字的姓名單獨出現、姓名字間夾空白或符號；市話與地址沒有固定格式，不比對
 *
 * Actions 紀錄是公開的：強命中只印檔名、行號、座號，不印姓名與查詢碼；
 * 弱命中的資料已經上站，連檔名、行號、座號都不印（印了等於公告哪個數字是查詢碼）。
 * 讀不到名冊、名冊內容不對＝無法確認＝一樣失敗（結束碼 2）；命中＝結束碼 1。
 */
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROSTER_DS = "ad232b7a-c7f8-4a68-b224-5b2d5b16599a"; // 👥 學生名冊（與 sync-notion.mjs 的 DS.roster 同一個）
const SCAN_PATHS = ["data/", "docs/routine-manual.md"];   // 與 sync.yml「提交更新」的 git add 範圍一致
const MIN_LEN = 3; // 短於這個長度的字串不拿來比對，避免大量誤判
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const KEYWORDS = ["查詢碼", "密碼"];
export const NEAR = 40;       // 強命中 a、b：查詢碼前後幾個字元算「附近」（班網 JSON 多是單行，不能用「同一行」）
export const LIST_SPAN = 200; // 強命中 c：幾個字元算「一小段」
export const LIST_MIN = 3;    // 強命中 c：一小段內幾個不同的查詢碼算名單
const FIELD_RE = /"查詢碼"\s*:/g; // .json 裡名為「查詢碼」的欄位
const WHY_KEYWORD = "附近有「查詢碼／密碼」字樣";
const WHY_OWNER = "緊鄰同一位學生的姓名或座號";
const WHY_LIST = `一小段內有 ${LIST_MIN} 個以上不同學生的查詢碼`;

// 手機號碼、身分證字號格式（不必對得上名冊）。前後緊鄰英數字、底線、連字號的不算（雜湊、編號的片段）
const MOBILE_RE = /(?<![0-9A-Za-z_-])(?:09|\+886[- ]?9)[0-9]{2}[- ]?[0-9]{3}[- ]?[0-9]{3}(?![0-9A-Za-z_-])/g;
const ID_RE = /(?<![0-9A-Za-z_-])[A-Z][1289][0-9]{8}(?![0-9A-Za-z_-])/g;
const ID_LETTER = [10, 11, 12, 13, 14, 15, 16, 17, 34, 18, 19, 20, 21, 22, 35, 23, 24, 25, 26, 27, 28, 29, 32, 30, 31, 33];
// 公認的範例值（教材、規格書、測試常用），不擋；手機先去掉符號、+886 換成 0 再比
const SAMPLE_OK = new Set(["0912345678", "0900123456", "0900000000", "A123456789"]);
const KIND_MOBILE = "手機號碼格式";
const KIND_ID = "身分證字號格式";

export function mobileKey(s) {
  const d = s.replace(/[^0-9]/g, "");
  return d.startsWith("886") ? "0" + d.slice(3) : d;
}

/** 身分證／新式居留證字號的檢查碼。 */
export function idValid(s) {
  const n = ID_LETTER[s.charCodeAt(0) - 65];
  const digits = [Math.floor(n / 10), n % 10, ...[...s.slice(1)].map(Number)];
  return digits.reduce((sum, d, i) => sum + d * [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1][i], 0) % 10 === 0;
}

/** 原文＋三種編碼寫法反解後的版本（\uXXXX、%XX、&#NNN;）；沒有那種寫法或反解後沒變就不多掃。 */
export function variants(text) {
  const out = [text];
  if (text.includes("\\u")) out.push(text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  if (/%[0-9A-Fa-f]{2}/.test(text)) {
    // 不用 decodeURIComponent：一段裡有一個壞位元組就整段丟錯，姓名會漏
    out.push(text.replace(/(?:%[0-9A-Fa-f]{2})+/g, s =>
      new TextDecoder().decode(Uint8Array.from(s.slice(1).split("%"), h => parseInt(h, 16)))));
  }
  if (text.includes("&#")) {
    out.push(text.replace(/&#(?:[xX]([0-9a-fA-F]{1,6})|([0-9]{1,7}));/g,
      (_, h, d) => String.fromCodePoint(Math.min(h ? parseInt(h, 16) : Number(d), 0x10ffff))));
  }
  return [...new Set(out)];
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 「座號 5」「"座號":"05"」「5 號」「seat: 5」這類寫法；座號不是數字就不比對。 */
function seatRegex(seat) {
  if (!/^[0-9]+$/.test(seat)) return null;
  const n = seat.replace(/^0+/, "") || "0";
  return new RegExp(`(?:座號|seat)["'\\s]*[:：=]?["'\\s]*0?${n}(?![0-9])|(?<![0-9])0?${n}\\s*號`, "i");
}

/**
 * 名冊列 → 比對清單 { names: [{ name, seat }], codes: Map(查詢碼 → [{ seat, name, seatRe }]), codeRe, count }。
 * 名冊內容不對就丟錯（訊息只帶座號）。姓名、查詢碼各自對在學人數把關：在學生缺任一項就不放行。
 */
export function buildNeedles(rows) {
  const names = [];
  const codes = new Map();
  let enrolled = 0, count = 0;
  for (const r of rows) {
    const seat = String(r["座號"] ?? "").trim() || "？";
    const name = String(r["姓名"] ?? "").trim();
    const code = String(r["查詢碼"] ?? "").trim();
    if (r["在學"]) {
      enrolled++;
      // 兩個字的姓名不當比對字串，但算「有姓名」
      if (name.length < 2) throw new Error(`名冊座號 ${seat} 沒有姓名，名冊格式可能變了`);
      if (code.length < MIN_LEN) throw new Error(`名冊座號 ${seat} 沒有查詢碼，欄位名稱或型別可能變了`);
    }
    // 已轉出的學生也比對：姓名與舊查詢碼一樣不該公開
    if (name.length >= MIN_LEN) { names.push({ name, seat }); count++; }
    if (code.length >= MIN_LEN) {
      if (!/^[0-9A-Za-z]+$/.test(code)) throw new Error(`名冊座號 ${seat} 的查詢碼不是純英數字，比對規則要重寫`);
      if (!codes.has(code)) codes.set(code, []);
      codes.get(code).push({ seat, name, seatRe: seatRegex(seat) });
      count++;
    }
  }
  if (!enrolled) throw new Error("名冊沒有任何在學學生，名冊格式可能變了");
  const alt = [...codes.keys()].sort((a, b) => b.length - a.length).join("|");
  // 第 1 組＝「座號-查詢碼」的座號、第 2 組＝查詢碼、第 3 組＝「查詢碼-座號」的座號（沒有就是 undefined）
  // 左邊：不緊鄰英數字或連字號（可帶「座號-」），或緊鄰的連字號前面不是英數字或連字號
  // 右邊：不緊鄰英數字或連字號，或「-座號」後面不是英數字或連字號，或緊鄰的連字號後面不是英數字或連字號
  const codeRe = new RegExp(`(?:(?<![0-9A-Za-z-])(?:([0-9]{1,2})-)?|(?<=-)(?<![0-9A-Za-z-]-))(${alt})`
    + `(?:(?![0-9A-Za-z-])|(?=-([0-9]{1,2})(?![0-9A-Za-z-]))|(?=-(?![0-9A-Za-z-])))`, "g");
  return { names, codes, codeRe, count };
}

/** 與 git 相同的判法：前 8000 位元組含 NUL 就當二進位檔。 */
export function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

/**
 * 掃一段文字，回傳 { block: [{ pos, seat, kind, why? }], weak: 數量 }。
 * block＝要擋的（姓名、查詢碼強命中、.json 的「查詢碼」欄位）；weak＝查詢碼弱命中，只給數量。
 */
export function classify(text, nd, isJson = false) {
  const block = [];
  let weak = 0;
  for (const { name, seat } of nd.names) {
    for (let i = text.indexOf(name); i !== -1; i = text.indexOf(name, i + 1)) block.push({ pos: i, seat, kind: "姓名" });
  }
  for (const m of text.matchAll(MOBILE_RE)) if (!SAMPLE_OK.has(mobileKey(m[0]))) block.push({ pos: m.index, kind: KIND_MOBILE });
  for (const m of text.matchAll(ID_RE)) if (!SAMPLE_OK.has(m[0]) && idValid(m[0])) block.push({ pos: m.index, kind: KIND_ID });
  const occ = [...text.matchAll(nd.codeRe)].map(m => (
    { start: m.index + m[0].length - m[2].length, end: m.index + m[0].length, code: m[2], seats: [m[1], m[3]] }));
  const listed = new Set();
  occ.forEach((o, i) => {
    const kinds = new Set();
    let j = i;
    while (j < occ.length && occ[j].start - o.start <= LIST_SPAN) kinds.add(occ[j++].code);
    if (kinds.size >= LIST_MIN) for (let k = i; k < j; k++) listed.add(k);
  });
  occ.forEach((o, k) => {
    const ctx = text.slice(Math.max(0, o.start - NEAR), o.end + NEAR);
    const owners = nd.codes.get(o.code);
    let why;
    if (KEYWORDS.some(w => ctx.includes(w))) why = WHY_KEYWORD;
    else if (owners.some(w => (w.name.length >= 2 && ctx.includes(w.name)) || (w.seatRe && w.seatRe.test(ctx))
      || (/^[0-9]+$/.test(w.seat) && o.seats.some(s => s && Number(s) === Number(w.seat))))) why = WHY_OWNER;
    else if (listed.has(k)) why = WHY_LIST;
    else { weak++; return; }
    block.push({ pos: o.start, seat: owners.map(w => w.seat).join("／"), kind: "查詢碼", why });
  });
  if (isJson) for (const m of text.matchAll(FIELD_RE)) block.push({ pos: m.index, kind: "欄位" });
  return { block: block.sort((a, b) => a.pos - b.pos), weak };
}

const describe = h => h.kind === "欄位" ? "出現名為「查詢碼」的欄位"
  : h.seat === undefined ? h.kind // 手機號碼、身分證字號格式：不對名冊，沒有座號
  : `座號 ${h.seat} 的${h.kind}${h.why ? `（${h.why}）` : ""}`;

const isFormat = h => h.kind === KIND_MOBILE || h.kind === KIND_ID;

/** 掃一個檔（路徑＋內容），回傳 { block: 可直接印出的說明（不含姓名與查詢碼）, weak: 弱命中數量, format: 手機與證號格式的數量（只通報不擋） }。 */
export function scanFile(file, buf, nd) {
  const inName = classify(file, nd);
  const out = inName.block.filter(h => !isFormat(h)).map(h => `檔名含${describe(h)}`);
  let weak = inName.weak;
  let format = inName.block.filter(isFormat).length;
  if (!isBinary(buf)) {
    // 原文與反解後的各版本都掃；弱命中取最多的那一份（各份是同一批數字，不重複加）
    let w = 0, f = 0;
    for (const text of variants(buf.toString("utf8"))) {
      const r = classify(text, nd, file.toLowerCase().endsWith(".json"));
      w = Math.max(w, r.weak);
      f = Math.max(f, r.block.filter(isFormat).length);
      for (const h of r.block) if (!isFormat(h)) out.push(`${file}:${text.slice(0, h.pos).split("\n").length}：${describe(h)}`);
    }
    weak += w;
    format += f;
  }
  return { block: [...new Set(out)], weak, format }; // 同一行同一項只報一次
}

async function fetchRoster(token) {
  const rows = [];
  let cursor;
  do {
    let res;
    for (let i = 0; i <= 3; i++) { // 429／5xx 重試（10/27 同步剛跑完額度用盡，掃描連 3 次擋下不提交）；重試完仍失敗照樣 fail-closed
      res = await fetch(`https://api.notion.com/v1/data_sources/${ROSTER_DS}/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
        body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
      });
      if (res.ok || (res.status !== 429 && res.status < 500) || i === 3) break;
      await new Promise(r => setTimeout(r, Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** i));
    }
    if (!res.ok) throw new Error(`Notion API ${res.status}`); // 回應內文可能帶名冊內容，不印
    const json = await res.json();
    rows.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  const val = p => {
    switch (p?.type) {
      case "title": return p.title.map(t => t.plain_text).join("");
      case "rich_text": return p.rich_text.map(t => t.plain_text).join("");
      case "checkbox": return p.checkbox;
      case "number": return p.number ?? "";
      default: return "";
    }
  };
  return rows.map(pg => Object.fromEntries(Object.entries(pg.properties).map(([k, v]) => [k, val(v)])));
}

/** 這次要提交的檔：有變動的追蹤檔＋新增的未追蹤檔。 */
function changedFiles() {
  const out = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "-z", "--modified", "--others", "--exclude-standard", "--", ...SCAN_PATHS],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.toString("utf8").split("\0").filter(Boolean))];
}

/** 掃這次要提交的每個檔，回傳 { scanned, binary, hits, weak, format }。 */
export async function scanChanged(needles) {
  const hits = [];
  let scanned = 0, binary = 0, weak = 0, format = 0;
  for (const f of changedFiles()) {
    let buf;
    try { buf = await readFile(path.join(ROOT, f)); } catch { continue; } // 這次被刪掉的檔，沒有內容可掃
    scanned++;
    if (isBinary(buf)) binary++;
    const r = scanFile(f, buf, needles);
    hits.push(...r.block);
    weak += r.weak;
    format += r.format;
  }
  return { scanned, binary, hits, weak, format };
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  let needles;
  try {
    if (!token) throw new Error("缺少 NOTION_TOKEN 環境變數");
    needles = buildNeedles(await fetchRoster(token));
  } catch (e) {
    console.error(`⛔ pii-scan：讀不到名冊（${e.message}），無法確認有沒有個資，這次不提交。`);
    process.exit(2);
  }
  const { scanned, binary, hits, weak, format } = await scanChanged(needles);
  // 手機、證號格式只通報不擋；紀錄公開，只印筆數（::warning:: 會顯示在該次執行的摘要頁）
  if (format) console.log(`::warning::pii-scan：這次要提交的檔案裡有手機號碼或身分證字號格式 ${format} 處（只通報不擋；明細請在本機 class-website/ 跑 pii-gate.py 看）`);
  // 弱命中只印數量：紀錄公開，印檔名行號等於公告哪個數字是查詢碼
  const weakNote = weak ? `查詢碼弱命中 ${weak} 處（孤零零的同值數字，不擋；明細由每週系統健檢在本機看）` : "查詢碼弱命中 0 處";
  if (hits.length) {
    console.error(`⛔ pii-scan：${hits.length} 處命中，這次不提交（掃了 ${scanned} 個檔；另${weakNote}）：`);
    for (const h of hits.slice(0, 50)) console.error(`  - ${h}`);
    if (hits.length > 50) console.error(`  …另有 ${hits.length - 50} 處`);
    process.exit(1);
  }
  console.log(`✅ pii-scan：0 命中（掃了 ${scanned} 個檔，其中 ${binary} 個二進位檔只比對檔名；${needles.count} 個比對字串）`);
  console.log(`ℹ️ ${weakNote}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
