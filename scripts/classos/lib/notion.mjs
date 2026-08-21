/**
 * ClassOS Phase F｜Notion 官方 API 共用引擎（零相依 Node 18+）
 *
 * SPEC_學年升級 §3：Phase F 所有批次操作一律走此模組，禁止走 MCP。
 * MCP 無 SQL、單次 25 筆、不能刪，在 11 庫數千筆面前不成立。
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀。
 *    本模組一律不印任何頁面內容；呼叫端也不得印標題或 rich_text（可能含學生姓名）。
 */

const NV = "2025-09-03";
const API = "https://api.notion.com/v1";

// Notion 官方限速約 3 req/s，寫入迴圈一律節流。
const THROTTLE_MS = 350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function token() {
  const t = process.env.NOTION_TOKEN;
  if (!t) {
    console.error("缺少 NOTION_TOKEN 環境變數");
    process.exit(1);
  }
  return t;
}

/** 低階呼叫。回傳 { status, ok, json }，不丟例外，由呼叫端判斷。 */
export async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Notion-Version": NV,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 回應 */ }
  return { status: res.status, ok: res.ok, json };
}

/** 同上但失敗即丟例外，供「不該失敗」的步驟使用。 */
export async function apiOrThrow(method, path, body) {
  const r = await api(method, path, body);
  if (!r.ok) {
    throw new Error(`Notion API ${method} ${path} → ${r.status} ${r.json?.code ?? ""} ${r.json?.message ?? ""}`);
  }
  return r.json;
}

/** 撈整個 data source（自動分頁，突破 MCP 25 筆上限）。 */
export async function queryAll(dsId, body = {}) {
  const results = [];
  let cursor;
  do {
    const json = await apiOrThrow("POST", `/data_sources/${dsId}/query`, {
      ...body,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    results.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return results;
}

/** 取得 data source schema。 */
export async function getSchema(dsId) {
  const json = await apiOrThrow("GET", `/data_sources/${dsId}`);
  return json.properties ?? {};
}

/**
 * 把任意型別的屬性值正規化成可比對的字串。
 * 用途：以 JS 端判斷取代 API filter 語法，避免因型別猜錯而靜默比對不到。
 */
export function propText(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case "title": return (p.title ?? []).map((t) => t.plain_text).join("");
    case "rich_text": return (p.rich_text ?? []).map((t) => t.plain_text).join("");
    case "select": return p.select?.name ?? "";
    case "multi_select": return (p.multi_select ?? []).map((o) => o.name).join(",");
    case "status": return p.status?.name ?? "";
    case "date": return p.date?.start ?? "";
    case "number": return p.number === null ? "" : String(p.number);
    case "checkbox": return p.checkbox ? "true" : "false";
    case "formula": return String(p.formula?.string ?? p.formula?.number ?? p.formula?.boolean ?? "");
    case "created_time": return p.created_time ?? "";
    default: return "";
  }
}

/** 封存頁面（＝丟進 Notion 垃圾桶，30 天內可還原）。 */
export async function archivePage(pageId) {
  return api("PATCH", `/pages/${pageId}`, { archived: true });
}

/** 更新頁面屬性。 */
export async function updatePage(pageId, properties) {
  return api("PATCH", `/pages/${pageId}`, { properties });
}

/** 對一批頁面逐一執行動作，含節流與逐筆結果統計。 */
export async function forEachThrottled(items, fn) {
  const ok = [];
  const fail = [];
  for (let i = 0; i < items.length; i++) {
    try {
      const r = await fn(items[i], i);
      (r?.ok === false ? fail : ok).push({ item: items[i], r });
    } catch (e) {
      fail.push({ item: items[i], error: e.message });
    }
    if (i < items.length - 1) await sleep(THROTTLE_MS);
  }
  return { ok, fail };
}

/** 頁面 id 去識別化短碼——夠辨識、不洩內容。 */
export function shortId(id) {
  return String(id).replace(/-/g, "").slice(0, 8);
}

/** 解析 workflow 傳入的執行模式。預設一律 dry-run。 */
export function isExecute() {
  return (process.env.MODE ?? "dry-run").trim() === "execute";
}

export const DS = {
  roster:      "ad232b7a-c7f8-4a68-b224-5b2d5b16599a", // 👥 學生名冊
  log:         "eb529fa1-59e5-45ef-bfb4-79fc30de79e4", // 📝 班經與學習紀錄庫
  termGrades:  "55bec7ab-a4f2-430c-8649-b4ec14ac9d18", // 📚 學期成績庫
  bank:        "1868a25d-f4e8-4952-9181-75bc2e349aa9", // 🏦 班級銀行帳本
  redeem:      "f4c697c6-7c27-4d20-b54a-febac0fc5d64", // 🛒 兌換申請
  counsel:     "2ed53a28-1cad-4aed-a028-a72dc21422af", // 🧭 學生輔導紀錄
  portfolio:   "8eb38e48-334b-45b1-ad0a-7d720782d15a", // 🎨 學生作品集
  reports:     "10dbe7ca-291b-4501-a2b4-2ac30f53a7f1", // 📊 學生學習報告
  weekly:      "dcb8db22-0533-4ffc-8662-a9a9eef22eda", // 📰 班級週報
  inbox:       "786b7b36-7361-4277-90a5-ac1818dce3b1", // 📥 任務收件匣
  lessons:     "d28efc6b-3f34-4a97-b72b-ddeb5ec51147", // 🚀 教學單元
  dailyPlan:   "81515593-4d79-4b09-84a5-709628d7b58e", // 📅 每日課程進度（一列＝一個上課日）
  // 以下無「學年」欄（SPEC §2 不加欄位的 3 庫），但升級精靈要改設定值，故一併列出
  settings:    "166cce91-e6f1-456e-9275-097d71207b9b", // ⚙️ 網站設定（學年度／班級）
  store:       "9e421ad0-0312-423d-b870-867b019b23d8", // 🏪 班級商店（跨學年資產）
};
