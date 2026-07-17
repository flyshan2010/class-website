/**
 * 班網教師專區代理 v2（Google Apps Script）── ClassOS v3.5 Phase A
 * 取代 apps-script-update-proxy.gs（v1 只有一鍵更新）。
 *
 * 功能（單一 Web App，doPost 依 action 分派）：
 *   - submit_task ：一句話 → 建 Notion「📥 任務收件匣」頁
 *   - upload_file ：base64 檔案 → 存 Google Drive 指定資料夾 → 回傳連結
 *   - list_tasks  ：查收件匣最近 N 筆（教師專區任務狀態清單用）
 *   - trigger_sync：觸發 GitHub Actions repository_dispatch（一鍵更新班網）
 *
 * 資安原則：
 *   - 口令一律放 POST body，禁止放 URL query（doGet 僅保留舊版相容一版後移除）。
 *   - 代理不記錄口令；GitHub/Notion token 只存在指令碼屬性，不進前端。
 *
 * 部署步驟（升級自 v1 約 10 分鐘）：
 * 1. 開 https://script.google.com → 開啟原「一鍵更新」專案（或新增專案）→ 貼上本檔全部內容取代舊碼。
 * 2. 左側「專案設定」→「指令碼屬性」確認／新增五筆：
 *    - PASSWORD        ：教師口令（沿用 v1 的即可）
 *    - GH_TOKEN        ：GitHub fine-grained token（class-website repo、Contents:RW）
 *    - NOTION_TOKEN    ：Notion integration token（需分享「📥 任務收件匣」給此 integration）
 *    - INBOX_DB_ID     ：851b8089cd51471c92632949bfb500db（📥 任務收件匣 DB ID）
 *    - UPLOAD_FOLDER_ID：Google Drive 上傳資料夾 ID（建一個「班網任務附件」資料夾，取網址中 folders/ 後那串）
 * 3. 右上「部署」→「管理部署作業」→ 編輯 → 版本選「新版本」→ 部署
 *    （沿用原部署可保留原網址；新專案則：新增部署作業 → 網頁應用程式 → 執行身分「我」、存取權「任何人」）。
 * 4. 網址（https://script.google.com/macros/s/…/exec）確認已在 Notion「⚙️ 網站設定」
 *    「一鍵更新網址」列（v1 已設過就不用動；教師專區沿用同一網址）。
 *
 * 前端呼叫約定：POST，Content-Type 用 text/plain（避免 CORS preflight），
 * body 為 JSON 字串 { action, pw, ...參數 }。回應一律 JSON { ok, ... } 或 { ok:false, error:"白話訊息" }。
 */

const REPO = "flyshan2010/class-website";
const NOTION_VERSION = "2022-06-28";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB/檔

// ---------- 入口 ----------

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: "資料格式錯誤，請重新整理頁面再試" });
  }

  const props = PropertiesService.getScriptProperties();
  const pw = props.getProperty("PASSWORD");
  if (!pw) return out_({ ok: false, error: "尚未設定指令碼屬性 PASSWORD" });
  if ((body.pw || "") !== pw) return out_({ ok: false, error: "口令錯誤" });

  try {
    switch (body.action) {
      case "submit_task":  return out_(submitTask_(props, body));
      case "upload_file":  return out_(uploadFile_(props, body));
      case "list_tasks":   return out_(listTasks_(props, body));
      case "trigger_sync": return out_(triggerSync_(props));
      default:             return out_({ ok: false, error: "未知的動作：" + (body.action || "(空白)") });
    }
  } catch (err) {
    return out_({ ok: false, error: "系統忙碌或設定有誤，請稍後再試（" + err.message + "）" });
  }
}

// 舊版相容：v1 首頁按鈕用 GET ?pw= 觸發同步。保留一版，前端全面改 POST 後移除本函式。
function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const pw = props.getProperty("PASSWORD");
  if (!pw) return out_({ ok: false, error: "尚未設定指令碼屬性 PASSWORD" });
  if ((e.parameter.pw || "") !== pw) return out_({ ok: false, error: "口令錯誤" });
  return out_(triggerSync_(props));
}

// ---------- 動作 ----------

/** 一句話 → 建收件匣頁（狀態=待處理、來源=教師專區） */
function submitTask_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  const dbId = props.getProperty("INBOX_DB_ID");
  if (!token || !dbId) return { ok: false, error: "尚未設定 NOTION_TOKEN / INBOX_DB_ID" };

  const text = String(body.text || "").trim();
  if (!text) return { ok: false, error: "任務內容是空的，請輸入一句話再送出" };
  if (text.length > 2000) return { ok: false, error: "任務內容太長（上限 2000 字）" };

  const properties = {
    "任務原文": { title: [{ text: { content: text } }] },
    "狀態": { select: { name: "待處理" } },
    "來源": { select: { name: "教師專區" } },
  };
  const urls = (body.attachment_urls || []).filter(u => /^https?:\/\//.test(String(u)));
  if (urls.length) {
    properties["附件"] = {
      files: urls.map((u, i) => ({ name: "附件" + (i + 1), type: "external", external: { url: u } })),
    };
  }

  const res = notion_(token, "pages", "post", { parent: { database_id: dbId }, properties: properties });
  if (res.code !== 200) return { ok: false, error: "寫入收件匣失敗（Notion 回應 " + res.code + "）" };
  return { ok: true, page_url: res.data.url };
}

/** base64 檔案 → Drive 資料夾（設「知道連結者可檢視」）→ 回傳連結 */
function uploadFile_(props, body) {
  const folderId = props.getProperty("UPLOAD_FOLDER_ID");
  if (!folderId) return { ok: false, error: "尚未設定 UPLOAD_FOLDER_ID" };

  const filename = sanitizeFilename_(String(body.filename || "attachment"));
  let bytes;
  try {
    bytes = Utilities.base64Decode(String(body.base64 || ""));
  } catch (err) {
    return { ok: false, error: "檔案內容解析失敗，請重新選擇檔案" };
  }
  if (!bytes.length) return { ok: false, error: "檔案是空的" };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "檔案超過 10MB 上限，請壓縮或改傳較小的檔" };

  const contentType = String(body.content_type || "application/octet-stream");
  const blob = Utilities.newBlob(bytes, contentType, stampName_(filename));
  const file = DriveApp.getFolderById(folderId).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, file_url: file.getUrl() };
}

/** 查收件匣最近 N 筆（預設 20），依建立時間新→舊 */
function listTasks_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  const dbId = props.getProperty("INBOX_DB_ID");
  if (!token || !dbId) return { ok: false, error: "尚未設定 NOTION_TOKEN / INBOX_DB_ID" };

  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 20, 1), 50);
  const res = notion_(token, "databases/" + dbId + "/query", "post", {
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: limit,
  });
  if (res.code !== 200) return { ok: false, error: "查詢收件匣失敗（Notion 回應 " + res.code + "）" };

  const tasks = (res.data.results || []).map(page => {
    const p = page.properties || {};
    return {
      text: ((p["任務原文"] || {}).title || []).map(t => t.plain_text).join(""),
      status: (((p["狀態"] || {}).select) || {}).name || "",
      type: (((p["任務類型"] || {}).select) || {}).name || "",
      output_url: (p["產出連結"] || {}).url || "",
      error: ((p["錯誤訊息"] || {}).rich_text || []).map(t => t.plain_text).join(""),
      page_url: page.url,
      created: page.created_time,
    };
  });
  return { ok: true, tasks: tasks };
}

/** 觸發 GitHub Actions（repository_dispatch: sync-now） */
function triggerSync_(props) {
  const token = props.getProperty("GH_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 GH_TOKEN" };

  const res = UrlFetchApp.fetch("https://api.github.com/repos/" + REPO + "/dispatches", {
    method: "post",
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" },
    payload: JSON.stringify({ event_type: "sync-now" }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  return code === 204 ? { ok: true } : { ok: false, error: "GitHub 回應 " + code + "，請確認 GH_TOKEN 權限" };
}

// ---------- 工具 ----------

function notion_(token, path, method, payload) {
  const res = UrlFetchApp.fetch("https://api.notion.com/v1/" + path, {
    method: method,
    headers: {
      Authorization: "Bearer " + token,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  let data = {};
  try { data = JSON.parse(res.getContentText()); } catch (err) {}
  return { code: code, data: data };
}

function sanitizeFilename_(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "attachment";
}

// 檔名加時戳，避免同名覆蓋且方便辨識批次
function stampName_(name) {
  const ts = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd-HHmmss");
  return ts + "_" + name;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
