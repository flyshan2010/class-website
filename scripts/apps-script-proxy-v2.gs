/**
 * 班網教師專區代理 v2.5（Google Apps Script）── ClassOS v3.5 Phase A＋班級商店兌換＋兌換券執行＋🧪 創造提案＋🔒 兌換條件把關
 * 取代 apps-script-update-proxy.gs（v1 只有一鍵更新）。
 *
 * ── v2.5 升級步驟（2026-09-10，約 2 分鐘）──
 *   本檔全部內容貼到 Apps Script 取代舊碼 →「部署」→「管理部署作業」→ 編輯 → 版本選「新版本」→ 部署（沿用原網址）。
 *   不必新增指令碼屬性；代理 integration 需讀得到「📝 班經與學習紀錄庫」「🧹 班級工作分配」（繼承 🏫 班級經營中心分享即可）。
 *   v2.5 新增把關（SPEC_兌換條件自動把關.md；條件全在伺服器端判斷，force 不能繞過）：
 *     XP 門檻：🏪 商店「解鎖總XP／解鎖貢獻XP」→ redeem_request 拒絕、approve_redeem 再驗、list_redeems 回 blocked/reason
 *     🧹 免打掃一次券：兌換當週打掃未達標不能換；只限核可後下一週用、一人一週一張、同組同一天一人
 *       → use_privilege 擋、list_privileges 回 usable/reason
 *
 * ── v2.4 升級步驟（2026-09-10，約 5 分鐘）──
 *   ① Notion 打開「🏫 班級經營中心 → 🧪 創造提案」→ 右上「…」→「連結」→ 加入代理（與 GitHub 同步）用的 integration。
 *   ② 本檔全部內容貼到 Apps Script 取代舊碼 →「部署」→「管理部署作業」→ 編輯 → 版本選「新版本」→ 部署（沿用原網址）。
 *   ③ 指令碼屬性不必新增。沒做 ① 時：學生頁會顯示「系統忙碌（提案查詢 404）」、教師專區會提示去加連結。
 *   v2.4 新增 action（SPEC_創造提案線上版.md）：
 *     學生（座號＋查詢碼）：proposal_get／proposal_save／proposal_submit
 *     教師（口令）：proposal_list／proposal_review_plan／proposal_review_result
 *
 * 功能（單一 Web App，doPost 依 action 分派）：
 *   - submit_task   ：一句話 → 建 Notion「📥 任務收件匣」頁
 *   - upload_file   ：base64 檔案 → 存 Google Drive 指定資料夾 → 回傳連結
 *   - list_tasks    ：查收件匣最近 N 筆（教師專區任務狀態清單用）
 *   - trigger_sync  ：觸發 GitHub Actions repository_dispatch（一鍵更新班網）
 *   - redeem_request：學生在小小銀行送出商店兌換申請（以座號＋查詢碼驗證，不需教師口令）
 *   - list_redeems  ：查兌換申請（教師專區處理與明細查詢用）
 *   - approve_redeem：核可申請 → 自動建帳本「消費」列扣幣＋商店庫存 −1 ＋申請設「已完成」
 *                     ⚠️ v2.3 起「所有分類」（特權與小物）一律寫「剩餘次數」＝商店「使用次數」
 *                     （空白＝1），該列即成為學生的券，全部出現在教師專區「兌換券執行」。
 *                     v2.2 只發特權類，文具／食物兌換券核可後不會出現，老師無從執行。
 *   - reject_redeem ：駁回申請（填原因）
 *   - list_privileges ：查兌換券（holding＝剩餘>0；history＝已用完/作廢/已退款）
 *   - use_privilege   ：學生執行 → 剩餘 −1、已使用 +1、追加使用紀錄（同日重複扣需 force）
 *   - undo_privilege  ：誤按還原（剩餘 +1、已使用 −1）
 *   - void_privilege  ：作廢（剩餘歸 0，填原因；不退幣）
 *   - refund_privilege：退費（剩餘歸 0＋帳本回補正數＋商店庫存 +1＋狀態改「已退款」）
 *
 * 資安原則：
 *   - 教師動作口令一律放 POST body，禁止放 URL query（doGet 僅保留舊版相容一版後移除）。
 *   - redeem_request 是唯一的學生動作：以 座號＋查詢碼 對名冊驗證，品項與價格一律以
 *     Notion 商店為準（不信任前端送來的價格），且每人同時最多 3 筆待處理申請。
 *   - 代理不記錄口令；GitHub/Notion token 只存在指令碼屬性，不進前端。
 *
 * 部署步驟（升級自 v2 約 5 分鐘）：
 * 0. ⚠️ v2.3 新增：到 Notion「🛒 兌換申請」的「狀態」欄位加一個選項「已退款」（退費用），
 *    沒有這個選項時退費會失敗。
 * 1. 開 https://script.google.com → 開啟原代理專案 → 貼上本檔全部內容取代舊碼。
 * 2. 指令碼屬性維持五筆不變（PASSWORD / GH_TOKEN / NOTION_TOKEN / INBOX_DB_ID / UPLOAD_FOLDER_ID）。
 *    ⚠️ 兌換功能需要 Notion integration 能存取 👥 學生名冊、🏦 班級銀行帳本、🏪 班級商店、
 *    🛒 兌換申請 四個資料庫——若當初只分享了「📥 任務收件匣」，請到 Notion 各資料庫
 *    「…」→「連結」把同一個 integration 加進去（或直接分享「🏫 班級經營中心」整頁）。
 * 3. 「部署」→「管理部署作業」→ 編輯 → 版本選「新版本」→ 部署（沿用原網址）。
 *
 * 前端呼叫約定：POST，Content-Type 用 text/plain（避免 CORS preflight），
 * body 為 JSON 字串 { action, pw, ...參數 }。回應一律 JSON { ok, ... } 或 { ok:false, error:"白話訊息" }。
 */

const REPO = "flyshan2010/class-website";
const NOTION_VERSION = "2022-06-28"; // 收件匣沿用（database_id 端點）
const NOTION_VERSION_DS = "2025-09-03"; // 兌換流用（data_sources 端點，與 sync-notion.mjs 相同）
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB/檔
const MAX_PENDING_PER_SEAT = 3; // 每位學生同時待處理申請上限

// 兌換流相關 data source ID（與 scripts/sync-notion.mjs 的 DS 表一致；非機密）
const DS_ROSTER = "ad232b7a-c7f8-4a68-b224-5b2d5b16599a"; // 👥 學生名冊
const DS_BANK = "1868a25d-f4e8-4952-9181-75bc2e349aa9"; // 🏦 班級銀行帳本
const DS_STORE = "9e421ad0-0312-423d-b870-867b019b23d8"; // 🏪 班級商店
const DS_REDEEM = "f4c697c6-7c27-4d20-b54a-febac0fc5d64"; // 🛒 兌換申請

// ---------- 入口 ----------

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: "資料格式錯誤，請重新整理頁面再試" });
  }

  const props = PropertiesService.getScriptProperties();

  try {
    // 學生動作：不驗教師口令，改以 座號＋查詢碼 對名冊驗證
    if (body.action === "redeem_request") return out_(redeemRequest_(props, body));
    if (body.action === "proposal_get") return out_(proposalGet_(props, body));
    if (body.action === "proposal_save") return out_(proposalWrite_(props, body, false));
    if (body.action === "proposal_submit") return out_(proposalWrite_(props, body, true));

    const pw = props.getProperty("PASSWORD");
    if (!pw) return out_({ ok: false, error: "尚未設定指令碼屬性 PASSWORD" });
    if ((body.pw || "") !== pw) return out_({ ok: false, error: "口令錯誤" });

    switch (body.action) {
      case "submit_task":  return out_(submitTask_(props, body));
      case "upload_file":  return out_(uploadFile_(props, body));
      case "list_tasks":   return out_(listTasks_(props, body));
      case "trigger_sync": return out_(triggerSync_(props));
      case "list_redeems":   return out_(listRedeems_(props, body));
      case "approve_redeem": return out_(approveRedeem_(props, body));
      case "reject_redeem":  return out_(rejectRedeem_(props, body));
      case "list_privileges": return out_(listPrivileges_(props, body));
      case "use_privilege":   return out_(usePrivilege_(props, body));
      case "undo_privilege":  return out_(undoPrivilege_(props, body));
      case "void_privilege":  return out_(voidPrivilege_(props, body));
      case "refund_privilege": return out_(refundPrivilege_(props, body));
      case "proposal_list":          return out_(proposalList_(props, body));
      case "proposal_review_plan":   return out_(proposalReviewPlan_(props, body));
      case "proposal_review_result": return out_(proposalReviewResult_(props, body));
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

// ---------- 動作：Phase A ----------

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
    "學年": { select: { name: schoolYear_() } },
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

/** base64 檔案 → Drive 資料夾（設「知道連結者可檢視」）→ 回傳連結
 *  走 Drive REST API（drive.file 最小權限：只能存取本腳本建立的檔案；
 *  內建 DriveApp 服務不支援小權限，故不使用）。 */
function uploadFile_(props, body) {
  const filename = sanitizeFilename_(String(body.filename || "attachment"));
  const base64 = String(body.base64 || "");
  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (err) {
    return { ok: false, error: "檔案內容解析失敗，請重新選擇檔案" };
  }
  if (!bytes.length) return { ok: false, error: "檔案是空的" };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "檔案超過 10MB 上限，請壓縮或改傳較小的檔" };

  const folderId = getUploadFolderId_(props);
  const contentType = String(body.content_type || "application/octet-stream");
  const boundary = "classosBoundary";
  const payload =
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify({ name: stampName_(filename), parents: [folderId] }) + "\r\n" +
    "--" + boundary + "\r\nContent-Type: " + contentType + "\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
    base64 + "\r\n--" + boundary + "--";

  const res = driveApi_("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    "post", payload, "multipart/related; boundary=" + boundary);
  if (res.code !== 200) return { ok: false, error: "上傳失敗（Drive 回應 " + res.code + "）" };

  // 知道連結者可檢視（讓 Notion 收件匣附件可開）
  driveApi_("https://www.googleapis.com/drive/v3/files/" + res.data.id + "/permissions",
    "post", JSON.stringify({ role: "reader", type: "anyone" }), "application/json");
  return { ok: true, file_url: res.data.webViewLink };
}

/** 取得（必要時建立）腳本自管的「班網任務附件」資料夾 ID，記在 Script Properties */
function getUploadFolderId_(props) {
  const id = props.getProperty("UPLOAD_FOLDER_ID");
  if (id) {
    const chk = driveApi_("https://www.googleapis.com/drive/v3/files/" + id + "?fields=id,trashed", "get", null, null);
    if (chk.code === 200 && !chk.data.trashed) return id; // 舊 ID（手動建或無權限）失效 → 往下重建
  }
  const res = driveApi_("https://www.googleapis.com/drive/v3/files?fields=id", "post",
    JSON.stringify({ name: "班網任務附件", mimeType: "application/vnd.google-apps.folder" }), "application/json");
  if (res.code !== 200) throw new Error("無法建立上傳資料夾（Drive 回應 " + res.code + "）");
  props.setProperty("UPLOAD_FOLDER_ID", res.data.id);
  return res.data.id;
}

function driveApi_(url, method, payload, contentType) {
  const opts = {
    method: method,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  };
  if (payload !== null) { opts.payload = payload; opts.contentType = contentType; }
  const res = UrlFetchApp.fetch(url, opts);
  let data = {};
  try { data = JSON.parse(res.getContentText()); } catch (err) {}
  return { code: res.getResponseCode(), data: data };
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

// ---------- 動作：班級商店兌換 ----------

/** 學生兌換申請：座號＋查詢碼驗證 → 以商店為準寫入「🛒 兌換申請」（不扣款，等老師核可） */
function redeemRequest_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };

  const seat = Math.floor(Number(body.seat));
  const code = String(body.code || "").trim();
  const itemId = String(body.item_id || "").trim();
  if (!(seat >= 1 && seat <= 99) || !code) return { ok: false, error: "座號或查詢碼不正確，請重新登入存摺再試" };
  if (!/^[0-9a-f-]{32,36}$/i.test(itemId)) return { ok: false, error: "商品資料有誤，請重新整理頁面再試" };

  // 1) 驗學生：名冊查座號＋在學，比對查詢碼
  const stu = findStudent_(token, seat);
  if (!stu) return { ok: false, error: "座號或查詢碼不正確，請重新登入存摺再試" };
  const stuCode = ((stu.properties["查詢碼"] || {}).rich_text || []).map(t => t.plain_text).join("").trim();
  if (!stuCode || stuCode !== code) return { ok: false, error: "座號或查詢碼不正確，請重新登入存摺再試" };

  // 2) 防洗版：同座號待處理申請達上限就先擋
  const pending = queryDS_(token, DS_REDEEM, {
    filter: { and: [
      { property: "座號", number: { equals: seat } },
      { property: "狀態", select: { equals: "待處理" } },
    ] },
    page_size: MAX_PENDING_PER_SEAT,
  });
  if (pending.code !== 200) return { ok: false, error: "系統忙碌，請稍後再試（申請查詢 " + pending.code + "）" };
  if ((pending.data.results || []).length >= MAX_PENDING_PER_SEAT) {
    return { ok: false, error: "你已經有 " + MAX_PENDING_PER_SEAT + " 筆申請在等老師確認，先等結果再申請喔！" };
  }

  // 3) 品項與價格以 Notion 商店為準（不信任前端）
  const item = notionV_(token, "pages/" + itemId, "get", null, NOTION_VERSION_DS);
  if (item.code !== 200) return { ok: false, error: "找不到這個商品，可能已下架，請重新整理頁面" };
  const ip = item.data.properties || {};
  const itemName = ((ip["品項"] || {}).title || []).map(t => t.plain_text).join("");
  const price = Math.round(Number((ip["價格"] || {}).number) || 0);
  const stock = Number((ip["庫存"] || {}).number) || 0;
  const listed = !!(ip["上架"] || {}).checkbox;
  const category = (((ip["分類"] || {}).select) || {}).name || "小物";
  if (!itemName || !listed) return { ok: false, error: "這個商品已下架，請重新整理頁面看看還有什麼" };
  if (stock <= 0) return { ok: false, error: "「" + itemName + "」已經售完囉，下次早點來！" };
  // 價格閘門：0 幣是合法設計（例：🧪 創造提案權要達 XP 門檻而非花錢），只有負數才是設定錯誤。
  // 註記寫「不可兌換」的品項是老師頒予的榮譽（榮譽牆／今日之星／命名權…），學生不能自己申請。
  const itemNote = ((ip["說明"] || {}).rich_text || []).map(t => t.plain_text).join("")
    + ((ip["備註"] || {}).rich_text || []).map(t => t.plain_text).join("");
  if (itemNote.indexOf("不可兌換") >= 0) {
    return { ok: false, error: "「" + itemName + "」是老師頒予的榮譽，不能自己兌換喔！" };
  }
  if (price < 0) return { ok: false, error: "商品價格設定有誤，請告訴老師" };

  // 3b) v2.5 資格把關：XP 門檻＋品項條件（前端反灰只是提示，這裡才算數）
  const today = today_();
  const elig = redeemEligibility_(token, stu.id, itemName, unlockOf_(ip), mondayOf_(today), today, null);
  if (elig.reason) return { ok: false, blocked: true, error: "還沒辦法兌換「" + itemName + "」：" + elig.reason };

  // 4) 建申請列（購買明細正本；狀態=待處理）
  const res = notionV_(token, "pages", "post", {
    parent: { type: "data_source_id", data_source_id: DS_REDEEM },
    properties: {
      "申請": { title: [{ text: { content: "座號" + seat + " 兌換 " + itemName } }] },
      "座號": { number: seat },
      "品項": { rich_text: [{ text: { content: itemName } }] },
      "價格": { number: price },
      "商店頁ID": { rich_text: [{ text: { content: itemId } }] },
      "分類": { select: { name: category } },
      "狀態": { select: { name: "待處理" } },
      "學年": { select: { name: schoolYear_() } },
    },
  }, NOTION_VERSION_DS);
  if (res.code !== 200) return { ok: false, error: "申請送出失敗（Notion 回應 " + res.code + "），請稍後再試" };
  return { ok: true, item: itemName, price: price };
}

/** 查兌換申請：status = "待處理"（預設）或 "all"；依申請時間新→舊 */
function listRedeems_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };

  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 30, 1), 100);
  const payload = {
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: limit,
  };
  if (String(body.status || "待處理") !== "all") {
    payload.filter = { property: "狀態", select: { equals: String(body.status || "待處理") } };
  }
  const res = queryDS_(token, DS_REDEEM, payload);
  if (res.code !== 200) return { ok: false, error: "查詢兌換申請失敗（Notion 回應 " + res.code + "）" };

  const today = today_();
  const stores = {}, students = {}, fins = {}; // 同一次清單內快取，避免同品項／同座號重複查
  const items = (res.data.results || []).map(page => {
    const p = page.properties || {};
    const r = {
      page_id: page.id,
      seat: (p["座號"] || {}).number || 0,
      item: ((p["品項"] || {}).rich_text || []).map(t => t.plain_text).join(""),
      price: (p["價格"] || {}).number || 0,
      status: (((p["狀態"] || {}).select) || {}).name || "",
      note: ((p["備註"] || {}).rich_text || []).map(t => t.plain_text).join(""),
      created: page.created_time,
      processed: (((p["處理時間"] || {}).date) || {}).start || "",
    };
    // v2.5：待處理的申請先判資格，教師專區核可鈕據此反灰（核可時伺服器仍會再驗一次）
    if (r.status === "待處理" && r.seat) {
      const storeId = ((p["商店頁ID"] || {}).rich_text || []).map(t => t.plain_text).join("").trim();
      const key = storeId || "name:" + r.item;
      if (!(key in stores)) stores[key] = storePageFor_(token, storeId, r.item);
      const unlock = stores[key] ? unlockOf_(stores[key].properties || {}) : { xp: 0, merit: 0 };
      if (unlock.xp || unlock.merit || REDEEM_RULES[r.item]) {
        if (!(r.seat in students)) students[r.seat] = findStudent_(token, r.seat);
        const stu = students[r.seat];
        if (!stu) { r.blocked = true; r.reason = "名冊查無在學的座號 " + r.seat; }
        else {
          const elig = redeemEligibility_(token, stu.id, r.item, unlock,
            mondayOf_(taipeiDate_(page.created_time)), today, fins[r.seat] || null);
          if (elig.fin) fins[r.seat] = elig.fin;
          if (elig.reason) { r.blocked = true; r.reason = elig.reason; }
        }
      }
    }
    return r;
  });
  return { ok: true, items: items };
}

/** 核可申請：驗餘額（可 force 略過）→ 帳本建「消費」列扣幣 → 商店庫存 −1 → 申請設已完成 */
function approveRedeem_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };
  const pageId = String(body.page_id || "").trim();
  if (!pageId) return { ok: false, error: "缺少申請編號" };

  // 1) 讀申請列；只有「待處理」能核可（防連點重複扣款）
  const req = notionV_(token, "pages/" + pageId, "get", null, NOTION_VERSION_DS);
  if (req.code !== 200) return { ok: false, error: "找不到這筆申請（Notion 回應 " + req.code + "）" };
  const rp = req.data.properties || {};
  const status = (((rp["狀態"] || {}).select) || {}).name || "";
  if (status !== "待處理") return { ok: false, error: "這筆申請已處理過（目前狀態：" + status + "）" };
  const seat = Math.floor(Number((rp["座號"] || {}).number) || 0);
  const itemName = ((rp["品項"] || {}).rich_text || []).map(t => t.plain_text).join("");
  const price = Math.round(Number((rp["價格"] || {}).number) || 0);
  const storePageId = ((rp["商店頁ID"] || {}).rich_text || []).map(t => t.plain_text).join("").trim();
  let category = (((rp["分類"] || {}).select) || {}).name || ""; // 空白＝舊資料，稍後以商店為準補
  if (!seat || !itemName || price < 0) return { ok: false, error: "申請資料不完整，請直接到 Notion 檢查這筆申請" };

  // 2) 名冊找學生
  const stu = findStudent_(token, seat);
  if (!stu) return { ok: false, error: "名冊查無座號 " + seat + "（非在學？），請到 Notion 確認" };

  // 2b) v2.5 商店頁提前讀（門檻、使用次數、分類都在這）；舊申請沒有商店頁ID 就用品項名找
  const storePage = storePageFor_(token, storePageId, itemName);
  const sp = storePage ? (storePage.properties || {}) : null;

  // 2c) v2.5 資格再驗：XP 門檻＋品項條件。申請後 XP 不會變少，這關擋的是舊申請與手動建列；force 不能繞過
  const fin = studentFinance_(token, stu.id);
  if (!fin) return { ok: false, error: "餘額計算失敗，請稍後再試" };
  const elig = redeemEligibility_(token, stu.id, itemName, sp ? unlockOf_(sp) : { xp: 0, merit: 0 },
    mondayOf_(taipeiDate_(req.data.created_time)), today_(), fin);
  if (elig.reason) return { ok: false, blocked: true, error: "座號 " + seat + " 還不能兌換「" + itemName + "」：" + elig.reason };

  // 3) 餘額檢查（帳本該生全部金額加總）；不足時回報，老師可選擇強制核可
  const balance = fin.balance;
  if (balance < price && !body.force) {
    return { ok: false, insufficient: true, balance: balance,
      error: "餘額不足：目前 " + balance + " 幣，需要 " + price + " 幣" };
  }

  // 4) 帳本建「消費」列（扣款正本）；0 幣品項（如 🧪 創造提案權）不建帳本列
  const today = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  const ledger = price === 0 ? { code: 200 } : notionV_(token, "pages", "post", {
    parent: { type: "data_source_id", data_source_id: DS_BANK },
    properties: {
      "事由": { title: [{ text: { content: "兌換 " + itemName } }] },
      "學生": { relation: [{ id: stu.id }] },
      "金額": { number: -price },
      "類型": { select: { name: "消費" } },
      "日期": { date: { start: today } },
      "學年": { select: { name: schoolYear_() } }, // 學年鐵則：空值會讓班網同步標紅中止
    },
  }, NOTION_VERSION_DS);
  if (ledger.code !== 200) return { ok: false, error: "帳本扣款失敗（Notion 回應 " + ledger.code + "），申請未變動" };

  // 5) 商店庫存 −1（失敗不擋流程，回報請老師手動調）；順便取「使用次數」與分類
  let stockMsg = "";
  let uses = 1; // 特權券可用次數：商店「使用次數」空白＝1
  if (sp) {
    uses = Math.max(1, Math.round(Number((sp["使用次數"] || {}).number) || 1));
    if (!category) category = (((sp["分類"] || {}).select) || {}).name || "小物";
    const stock = Number((sp["庫存"] || {}).number) || 0;
    const upd = notionV_(token, "pages/" + storePage.id, "patch", {
      properties: { "庫存": { number: Math.max(0, stock - 1) } },
    }, NOTION_VERSION_DS);
    if (upd.code !== 200) stockMsg = "（庫存未扣成功，請手動 −1）";
  } else stockMsg = storePageId ? "（找不到商店品項，庫存請手動 −1）" : "（此申請無商店頁ID，庫存請手動 −1）";
  if (!category) category = "小物";

  // 6) 申請設已完成＋處理紀錄＋發券
  //    v2.3：不分特權／小物一律發券。文具兌換券、食物兌換券也要老師實際交付，
  //    沒有「剩餘次數」就不會出現在「兌換券執行」，老師看不到也就執行不了。
  const nowIso = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd'T'HH:mm:ss+08:00");
  const newBalance = balance - price;
  const doneProps = {
    "狀態": { select: { name: "已完成" } },
    "分類": { select: { name: category } },
    "處理時間": { date: { start: nowIso } },
    "備註": { rich_text: [{ text: { content:
      (price === 0 ? "0 幣品項未扣款，餘額 " + newBalance + " 幣" : "已扣 " + price + " 幣，餘額 " + newBalance + " 幣")
      + stockMsg } }] },
    "剩餘次數": { number: uses },
    "已使用次數": { number: 0 },
  };
  notionV_(token, "pages/" + pageId, "patch", { properties: doneProps }, NOTION_VERSION_DS);
  return { ok: true, seat: seat, item: itemName, price: price, balance: newBalance, stock_msg: stockMsg,
    category: category, uses: uses };
}

/** 駁回申請：狀態=已駁回＋原因 */
function rejectRedeem_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };
  const pageId = String(body.page_id || "").trim();
  if (!pageId) return { ok: false, error: "缺少申請編號" };
  const reason = String(body.reason || "").trim().slice(0, 200);

  const nowIso = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd'T'HH:mm:ss+08:00");
  const res = notionV_(token, "pages/" + pageId, "patch", {
    properties: {
      "狀態": { select: { name: "已駁回" } },
      "處理時間": { date: { start: nowIso } },
      "備註": { rich_text: [{ text: { content: reason || "老師駁回" } }] },
    },
  }, NOTION_VERSION_DS);
  if (res.code !== 200) return { ok: false, error: "駁回失敗（Notion 回應 " + res.code + "）" };
  return { ok: true };
}

// ---------- 動作：特權執行 ----------
//
// 資料模型：一列「已完成」且「分類＝特權」的兌換申請 ＝ 一張特權券。
//   剩餘次數 > 0 ＝ 學生手上還能用的券；剩餘次數 = 0 ＝ 已用完或已作廢（歷史）。
//   扣次數的正本在 Notion，教師專區按下去即時生效；學生端存摺要等下次同步班網才更新。

const PRIV_PAGE_LIMIT = 300; // 持有中清單最多撈 300 張券（分頁）

/** 讀一張特權券並驗基本狀態；回 { ok:false, error } 或 { ok:true, p, remaining, used, item, seat } */
function readPrivilege_(token, pageId) {
  const res = notionV_(token, "pages/" + pageId, "get", null, NOTION_VERSION_DS);
  if (res.code !== 200) return { ok: false, error: "找不到這張特權券（Notion 回應 " + res.code + "）" };
  const p = res.data.properties || {};
  const status = (((p["狀態"] || {}).select) || {}).name || "";
  const category = (((p["分類"] || {}).select) || {}).name || "";
  if (status !== "已完成") return { ok: false, error: "這筆兌換不是已完成狀態（目前：" + (status || "空白") + "）" };
  return {
    ok: true,
    p: p,
    category: category,
    price: Math.round(Number((p["價格"] || {}).number) || 0),
    storePageId: ((p["商店頁ID"] || {}).rich_text || []).map(t => t.plain_text).join("").trim(),
    seat: Math.floor(Number((p["座號"] || {}).number) || 0),
    item: ((p["品項"] || {}).rich_text || []).map(t => t.plain_text).join(""),
    remaining: Math.round(Number((p["剩餘次數"] || {}).number) || 0),
    used: Math.round(Number((p["已使用次數"] || {}).number) || 0),
    log: ((p["使用紀錄"] || {}).rich_text || []).map(t => t.plain_text).join(""),
    lastUsed: (((p["最近使用"] || {}).date) || {}).start || "",
    got: (((p["處理時間"] || {}).date) || {}).start || res.data.created_time, // v2.5 免打掃券「下一週」起算
  };
}

/** 使用紀錄：新的一行加在最前面，整體上限 1800 字（Notion rich_text 單段 2000 字） */
function appendLog_(oldLog, line) {
  const merged = line + (oldLog ? "\n" + oldLog : "");
  return merged.length > 1800 ? merged.slice(0, 1800) : merged;
}

function today_() { return Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd"); }
function stampMD_() { return Utilities.formatDate(new Date(), "Asia/Taipei", "MM/dd"); }

/** 查特權券：view = "holding"（剩餘>0，預設）或 "history"（剩餘=0，已用完／作廢） */
function listPrivileges_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };

  const holding = String(body.view || "holding") !== "history";
  const limit = holding ? PRIV_PAGE_LIMIT : Math.min(Math.max(parseInt(body.limit, 10) || 50, 1), 100);
  // v2.3：不過濾分類——特權券與小物兌換券（文具／食物）都要讓老師執行。
  const filter = { and: [
    { property: "狀態", select: { equals: "已完成" } },
    holding ? { property: "剩餘次數", number: { greater_than: 0 } }
            : { property: "剩餘次數", number: { equals: 0 } },
  ] };
  const sorts = holding
    ? [{ property: "座號", direction: "ascending" }, { timestamp: "created_time", direction: "ascending" }]
    : [{ property: "最近使用", direction: "descending" }];

  const items = [];
  let cursor = null;
  do {
    const payload = { filter: filter, sorts: sorts, page_size: Math.min(100, limit - items.length) };
    if (cursor) payload.start_cursor = cursor;
    const res = queryDS_(token, DS_REDEEM, payload);
    if (res.code !== 200) return { ok: false, error: "查詢特權券失敗（Notion 回應 " + res.code + "）" };
    for (const page of res.data.results || []) {
      const p = page.properties || {};
      const remaining = Math.round(Number((p["剩餘次數"] || {}).number) || 0);
      const used = Math.round(Number((p["已使用次數"] || {}).number) || 0);
      items.push({
        page_id: page.id,
        seat: Math.floor(Number((p["座號"] || {}).number) || 0),
        item: ((p["品項"] || {}).rich_text || []).map(t => t.plain_text).join(""),
        category: (((p["分類"] || {}).select) || {}).name || "",
        price: Math.round(Number((p["價格"] || {}).number) || 0),
        remaining: remaining,
        used: used,
        total: remaining + used,
        got: (((p["處理時間"] || {}).date) || {}).start || page.created_time,
        last_used: (((p["最近使用"] || {}).date) || {}).start || "",
        log: ((p["使用紀錄"] || {}).rich_text || []).map(t => t.plain_text).join(""),
      });
    }
    cursor = res.data.has_more ? res.data.next_cursor : null;
  } while (cursor && items.length < limit);

  // v2.5：有使用條件的券先判能不能用，教師專區「✅ 使用一次」據此反灰（use_privilege 仍會再驗）
  if (holding && items.some(i => USE_RULES[i.item])) {
    const ctx = useContext_(token);
    for (const i of items) {
      if (!USE_RULES[i.item]) continue;
      const reason = USE_RULES[i.item](i, ctx);
      i.usable = !reason;
      if (reason) i.reason = reason;
    }
  }
  return { ok: true, items: items, today: today_() };
}

/** 使用一次：剩餘 −1、已使用 +1、追加使用紀錄；同一天已扣過需 force（防誤按重複扣） */
function usePrivilege_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };
  const pageId = String(body.page_id || "").trim();
  if (!pageId) return { ok: false, error: "缺少特權券編號" };

  const cur = readPrivilege_(token, pageId);
  if (!cur.ok) return cur;
  if (cur.remaining <= 0) return { ok: false, error: "「" + cur.item + "」已經沒有剩餘次數了" };
  // v2.5 使用條件先於「同日重複」檢查：force 只能略過重複扣，不能略過這裡
  if (USE_RULES[cur.item]) {
    const reason = USE_RULES[cur.item](cur, useContext_(token));
    if (reason) return { ok: false, blocked: true, error: "座號 " + cur.seat + " 的「" + cur.item + "」現在不能用：" + reason };
  }
  if (cur.lastUsed === today_() && !body.force) {
    return { ok: false, duplicate: true,
      error: "座號 " + cur.seat + " 的「" + cur.item + "」今天已經扣過一次了" };
  }

  const note = String(body.note || "").trim().slice(0, 60);
  const res = notionV_(token, "pages/" + pageId, "patch", {
    properties: {
      "剩餘次數": { number: cur.remaining - 1 },
      "已使用次數": { number: cur.used + 1 },
      "最近使用": { date: { start: today_() } },
      "使用紀錄": { rich_text: [{ text: { content:
        appendLog_(cur.log, stampMD_() + " 使用" + (note ? "（" + note + "）" : "")) } }] },
    },
  }, NOTION_VERSION_DS);
  if (res.code !== 200) return { ok: false, error: "扣次數失敗（Notion 回應 " + res.code + "）" };
  return { ok: true, seat: cur.seat, item: cur.item, remaining: cur.remaining - 1, total: cur.remaining + cur.used };
}

/** 誤按還原：剩餘 +1、已使用 −1 */
function undoPrivilege_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };
  const pageId = String(body.page_id || "").trim();
  if (!pageId) return { ok: false, error: "缺少特權券編號" };

  const cur = readPrivilege_(token, pageId);
  if (!cur.ok) return cur;
  if (cur.used <= 0) return { ok: false, error: "「" + cur.item + "」還沒有使用紀錄，不用還原" };

  const res = notionV_(token, "pages/" + pageId, "patch", {
    properties: {
      "剩餘次數": { number: cur.remaining + 1 },
      "已使用次數": { number: cur.used - 1 },
      "使用紀錄": { rich_text: [{ text: { content: appendLog_(cur.log, stampMD_() + " 撤銷一次（老師誤按）") } }] },
    },
  }, NOTION_VERSION_DS);
  if (res.code !== 200) return { ok: false, error: "還原失敗（Notion 回應 " + res.code + "）" };
  return { ok: true, seat: cur.seat, item: cur.item, remaining: cur.remaining + 1 };
}

/** 作廢：剩餘歸 0＋填原因（不退幣；學期末清券或條件未達成時用） */
function voidPrivilege_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };
  const pageId = String(body.page_id || "").trim();
  if (!pageId) return { ok: false, error: "缺少特權券編號" };
  const reason = String(body.reason || "").trim().slice(0, 100) || "老師作廢";

  const cur = readPrivilege_(token, pageId);
  if (!cur.ok) return cur;
  if (cur.remaining <= 0) return { ok: false, error: "「" + cur.item + "」已經沒有剩餘次數，不需作廢" };

  const res = notionV_(token, "pages/" + pageId, "patch", {
    properties: {
      "剩餘次數": { number: 0 },
      "最近使用": { date: { start: today_() } },
      "使用紀錄": { rich_text: [{ text: { content:
        appendLog_(cur.log, stampMD_() + " 作廢 " + cur.remaining + " 次：" + reason) } }] },
    },
  }, NOTION_VERSION_DS);
  if (res.code !== 200) return { ok: false, error: "作廢失敗（Notion 回應 " + res.code + "）" };
  return { ok: true, seat: cur.seat, item: cur.item, voided: cur.remaining };
}

/** 退費（v2.3）：券作廢＋帳本回補正數＋商店庫存 +1＋狀態改「已退款」。
 *  用於「賣錯了／執行不了／學生反悔」——與「作廢」的差別就是這一筆會把幣還回去。
 *  防重複：只有狀態＝已完成的列能退，退完狀態改「已退款」，再按就會被擋下。
 *  ⚠️ Notion「🛒 兌換申請」的「狀態」欄必須先有「已退款」選項，否則會退款失敗（幣不會亂跑，
 *     因為狀態改不成時已寫的帳本列會由本函式自述於回傳訊息，請照訊息處理）。
 */
function refundPrivilege_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };
  const pageId = String(body.page_id || "").trim();
  if (!pageId) return { ok: false, error: "缺少兌換券編號" };
  const reason = String(body.reason || "").trim().slice(0, 100) || "老師退費";

  const cur = readPrivilege_(token, pageId);
  if (!cur.ok) return cur; // 已退款的列狀態不是「已完成」，會在這裡被擋下
  if (!cur.seat) return { ok: false, error: "這筆兌換沒有座號，請到 Notion 檢查" };

  // 1) 帳本回補（0 幣品項不建列）
  let ledgerMsg = "";
  if (cur.price > 0) {
    const stu = findStudent_(token, cur.seat);
    if (!stu) return { ok: false, error: "名冊查無座號 " + cur.seat + "（非在學？），退費中止，帳目未變動" };
    const ledger = notionV_(token, "pages", "post", {
      parent: { type: "data_source_id", data_source_id: DS_BANK },
      properties: {
        "事由": { title: [{ text: { content: "退費 " + cur.item + "（" + reason + "）" } }] },
        "學生": { relation: [{ id: stu.id }] },
        "金額": { number: cur.price },
        "類型": { select: { name: "調整" } },
        "日期": { date: { start: today_() } },
        "學年": { select: { name: schoolYear_() } }, // 學年鐵則：空值會讓班網同步標紅中止
      },
    }, NOTION_VERSION_DS);
    if (ledger.code !== 200) {
      return { ok: false, error: "退幣失敗（Notion 回應 " + ledger.code + "），兌換券未變動，請重試" };
    }
  } else ledgerMsg = "（0 幣品項，沒有幣可退）";

  // 2) 商店庫存 +1（失敗不擋流程）
  let stockMsg = "";
  if (cur.storePageId) {
    const store = notionV_(token, "pages/" + cur.storePageId, "get", null, NOTION_VERSION_DS);
    if (store.code === 200) {
      const stock = Number(((store.data.properties || {})["庫存"] || {}).number) || 0;
      const upd = notionV_(token, "pages/" + cur.storePageId, "patch", {
        properties: { "庫存": { number: stock + 1 } },
      }, NOTION_VERSION_DS);
      if (upd.code !== 200) stockMsg = "（庫存未加回，請手動 +1）";
    } else stockMsg = "（找不到商店品項，庫存請手動 +1）";
  } else stockMsg = "（此申請無商店頁ID，庫存請手動 +1）";

  // 3) 券收回＋狀態改已退款（幣已經退了，這步失敗要明講，不能靜默）
  const res = notionV_(token, "pages/" + pageId, "patch", {
    properties: {
      "狀態": { select: { name: "已退款" } },
      "剩餘次數": { number: 0 },
      "最近使用": { date: { start: today_() } },
      "使用紀錄": { rich_text: [{ text: { content:
        appendLog_(cur.log, stampMD_() + " 退費 " + cur.price + " 幣（" + reason + "）") } }] },
      "備註": { rich_text: [{ text: { content: "已退 " + cur.price + " 幣：" + reason } }] },
    },
  }, NOTION_VERSION_DS);
  if (res.code !== 200) {
    return { ok: false, error: "幣已經退給座號 " + cur.seat + "（" + cur.price + " 幣），"
      + "但兌換券狀態沒改成功（Notion 回應 " + res.code + "）。"
      + "請到 Notion「🛒 兌換申請」把這一列狀態改成「已退款」、剩餘次數改 0，"
      + "否則券還在學生手上。（若下拉沒有「已退款」選項，請先新增這個選項）" };
  }
  return { ok: true, seat: cur.seat, item: cur.item, refunded: cur.price,
    msg: ledgerMsg + stockMsg };
}

// ---------- 動作：🧪 創造提案（v2.4）----------
//
// 資料模型：一列「🧪 創造提案」＝一件提案；一張「創造提案權」兌換券（🛒 兌換申請 已完成列）＝一件提案，
//   兩者以「兌換申請」relation 綁定——沒被任何提案綁走的券才算「還能用」。
// 存取方案 A（老師 2026-09-10 選定）：沿用同一個 Notion integration，只多分享這一個 DB。
//   補償護欄：學生動作只能讀寫「學生＝本人」且確實位在本 DB 的列、只能寫白名單欄位；
//   狀態、老師意見、XP 勾選一律由伺服器依流程推進，學生送什麼都不會被寫進去。
// 防重複發放（U44）：「計畫XP已發／成果XP已發／命名權已頒」三個勾選＋狀態必須在審核中，
//   先改狀態與勾選、再寫帳本；帳本失敗就把狀態與勾選改回去，老師可以重按。

const DS_PROPOSAL = "35cb027e-1465-47a2-ad91-e66fb5e83c7a"; // 🧪 創造提案
const PROPOSAL_TICKET = "創造提案權"; // 🛒 兌換申請「品項」字串（與 🏪 商店品項名一致）
const NAMING_TICKET = "命名權";
const PROPOSAL_XP_PLAN = 10;   // 計畫通過：帳本「獎勵金」+10（＝貢獻 XP +10，也是 +10 幣）
const PROPOSAL_XP_RESULT = 20; // 成果通過：+20，並頒命名權
const PROPOSAL_TEXT_MAX = 800; // Notion rich_text 單段 2000 字元硬限，留足餘裕
const PROPOSAL_READS_PER_MIN = 30;  // 每座號每分鐘查詢上限（也拖慢猜查詢碼）
const PROPOSAL_WRITES_PER_MIN = 8;  // 每座號每分鐘暫存／送出上限

const PROPOSAL_TYPES = ["新常規", "修改常規", "新班規", "修改班規", "新商店品項", "修改商店品項"];
const PROPOSAL_RECORD = ["次數表", "照片（不拍臉）", "訪問同學", "其他"];
const PROPOSAL_GUARDS = ["沒有違反校規", "不用花錢不用買東西", "不會增加同學的負擔", "不是花幣就不用負責", "沒有其他進行中的提案"];
const PROPOSAL_ACHIEVE = ["達到", "部分達到", "沒達到"];
const PROPOSAL_TEXT_PLAN = ["問題", "點子", "好處", "困難與解決", "成功標準", "需要協助"];
const PROPOSAL_TEXT_RESULT = ["實際做法", "試行前", "試行後", "同學回饋", "反思", "命名候選"];
const PROPOSAL_ACTIVE = ["草稿", "計畫審核中", "計畫需修改", "試行中", "成果審核中", "延長試行"];
const PLAN_EDITABLE = ["草稿", "計畫需修改"];
const RESULT_EDITABLE = ["試行中", "延長試行"];
const PLAN_REQUIRED = ["提案名稱", "類型", "問題", "點子", "好處", "困難與解決", "成功標準", "試行起", "試行迄"];
const RESULT_REQUIRED = ["實際做法", "試行前", "試行後", "同學回饋", "反思", "達成"];

// 白名單：學生能寫的欄位與型別（plan＝表一、result＝表二；不在這裡的一律忽略）
const PROPOSAL_SPEC = {
  plan: { "提案名稱": ["title"], "類型": ["select", PROPOSAL_TYPES], "試行起": ["date"], "試行迄": ["date"],
          "記錄方式": ["multi", PROPOSAL_RECORD], "護欄自檢": ["multi", PROPOSAL_GUARDS] },
  result: { "達成": ["select", PROPOSAL_ACHIEVE] },
};
PROPOSAL_TEXT_PLAN.forEach(k => { PROPOSAL_SPEC.plan[k] = ["text"]; });
PROPOSAL_TEXT_RESULT.forEach(k => { PROPOSAL_SPEC.result[k] = ["text"]; });

/** 學生：查自己的提案與資格 */
function proposalGet_(props, body) {
  if (overLimit_("pr:" + Math.floor(Number(body.seat)), PROPOSAL_READS_PER_MIN)) {
    return { ok: false, error: "操作太頻繁了，請等一分鐘再試" };
  }
  const who = proposalStudent_(props, body);
  if (who.error) return { ok: false, error: who.error };
  const list = studentProposals_(who.token, who.stu.id);
  if (!list.ok) return list;
  const tickets = proposalTickets_(who.token, who.seat);
  if (!tickets.ok) return tickets;
  const active = list.items.filter(x => PROPOSAL_ACTIVE.indexOf(x.status) >= 0);
  const free = freeTicket_(tickets.items, list.items);
  return { ok: true, seat: who.seat, proposals: list.items.map(studentView_),
    has_ticket: !!free, can_start: !active.length && !!free, today: today_() };
}

/** 學生：暫存（submit=false）或送出（submit=true）。送出＝先暫存、再以伺服器端讀回的內容驗必填 */
function proposalWrite_(props, body, submit) {
  if (overLimit_("pw:" + Math.floor(Number(body.seat)), PROPOSAL_WRITES_PER_MIN)) {
    return { ok: false, error: "按得太頻繁了，請等一分鐘再按" };
  }
  const who = proposalStudent_(props, body);
  if (who.error) return { ok: false, error: who.error };
  const token = who.token;
  const part = body.part === "result" ? "result" : "plan";
  const fields = (body.fields && typeof body.fields === "object") ? body.fields : {};
  if (part === "result" && nameLeak_(String(fields["命名候選"] || ""), who.name)) {
    return { ok: false, error: "命名不能放自己的姓名或座號，換一個大家看得懂的名字吧！" };
  }
  const writeProps = proposalProps_(part, fields);
  const pid = String(body.proposal_id || "").trim();
  let page;

  if (!pid) {
    // 新提案：只能從表一開始；一人同時一件；要有一張沒被綁走的提案權
    if (part !== "plan") return { ok: false, error: "要先寫計畫書（表一）喔" };
    const list = studentProposals_(token, who.stu.id);
    if (!list.ok) return list;
    if (list.items.some(x => PROPOSAL_ACTIVE.indexOf(x.status) >= 0)) {
      return { ok: false, error: "你已經有一件提案在進行中，一次只能做一件喔！請重新整理頁面" };
    }
    const tickets = proposalTickets_(token, who.seat);
    if (!tickets.ok) return tickets;
    const free = freeTicket_(tickets.items, list.items);
    if (!free) return { ok: false, error: "你目前沒有可以用的 🧪 創造提案權。先到小小銀行兌換，老師核可後再來寫。" };
    writeProps["狀態"] = { select: { name: "草稿" } };
    writeProps["學生"] = { relation: [{ id: who.stu.id }] };
    writeProps["座號"] = { number: who.seat };
    writeProps["兌換申請"] = { relation: [{ id: free.id }] };
    writeProps["學年"] = { select: { name: schoolYear_() } }; // 學年鐵則
    const res = notionV_(token, "pages", "post", {
      parent: { type: "data_source_id", data_source_id: DS_PROPOSAL }, properties: writeProps,
    }, NOTION_VERSION_DS);
    if (res.code !== 200) return { ok: false, error: "暫存失敗（Notion 回應 " + res.code + "），請稍後再試" };
    page = res.data;
    markTicketUsed_(token, free); // 券移出「持有中」；失敗不擋——綁定關係才是正本
  } else {
    const cur = readProposalPage_(token, pid);
    if (!cur.ok || !sameId_(cur.view.student_id, who.stu.id)) {
      return { ok: false, error: "找不到這件提案，請重新整理頁面" };
    }
    const editable = part === "plan" ? PLAN_EDITABLE : RESULT_EDITABLE;
    if (editable.indexOf(cur.view.status) < 0) {
      return { ok: false, locked: true, status: cur.view.status,
        error: "這件提案目前是「" + cur.view.status + "」，" + (part === "plan" ? "計畫書" : "成果回報") + "現在不能修改。請重新整理頁面看最新狀態。" };
    }
    if (Object.keys(writeProps).length) {
      const res = notionV_(token, "pages/" + pid, "patch", { properties: writeProps }, NOTION_VERSION_DS);
      if (res.code !== 200) return { ok: false, error: "暫存失敗（Notion 回應 " + res.code + "），請稍後再試" };
      page = res.data;
    } else page = cur.page;
  }

  let view = proposalView_(page);
  if (!submit) return { ok: true, proposal: studentView_(view), saved_at: nowIso_() };

  const miss = proposalMissing_(part, view);
  if (miss.length) {
    return { ok: false, missing: miss, proposal: studentView_(view), saved_at: nowIso_(),
      error: "還有這些沒完成（內容已先幫你暫存）：" + miss.join("、") };
  }
  const next = part === "plan" ? "計畫審核中" : "成果審核中";
  const res = notionV_(token, "pages/" + view.id, "patch", { properties: {
    "狀態": { select: { name: next } },
    "最後送出": { date: { start: nowIso_() } },
  } }, NOTION_VERSION_DS);
  if (res.code !== 200) return { ok: false, error: "送出失敗（Notion 回應 " + res.code + "），內容已暫存，請稍後再按送出" };
  view = proposalView_(res.data);
  return { ok: true, submitted: true, proposal: studentView_(view), saved_at: nowIso_() };
}

/** 教師：列出本學年所有提案（前端再把審核中的排前面） */
function proposalList_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };
  const items = [];
  let cursor = null;
  do {
    const payload = {
      filter: { property: "學年", select: { equals: schoolYear_() } },
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: 100,
    };
    if (cursor) payload.start_cursor = cursor;
    const res = queryDS_(token, DS_PROPOSAL, payload);
    if (res.code !== 200) {
      return { ok: false, error: "查詢創造提案失敗（Notion 回應 " + res.code + "）"
        + (res.code === 404 ? "：請到 Notion「🧪 創造提案」→「…」→「連結」加入代理用的 integration" : "") };
    }
    (res.data.results || []).forEach(page => items.push(proposalView_(page)));
    cursor = res.data.has_more ? res.data.next_cursor : null;
  } while (cursor && items.length < 300);
  return { ok: true, items: items, xp_plan: PROPOSAL_XP_PLAN, xp_result: PROPOSAL_XP_RESULT };
}

/** 教師：審核表一。通過→試行中＋帳本獎勵金 +10（恰一次） */
function proposalReviewPlan_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };
  const MAP = { "通過": "試行中", "修改": "計畫需修改", "不通過": "計畫不通過" };
  const decision = String(body.decision || "");
  const comment = String(body.comment || "").trim().slice(0, PROPOSAL_TEXT_MAX);
  if (!MAP[decision]) return { ok: false, error: "審核結果只能是 通過／修改／不通過" };
  if (decision !== "通過" && !comment) return { ok: false, error: "「" + decision + "」要寫理由，學生才知道怎麼改" };

  const cur = readProposalPage_(token, String(body.page_id || "").trim());
  if (!cur.ok) return cur;
  const v = cur.view;
  if (v.status !== "計畫審核中") {
    return { ok: false, error: "這件提案目前是「" + v.status + "」，不在計畫審核階段（可能已經審過，請重新整理）" };
  }
  const pay = decision === "通過" && !v.xp_plan;
  const upd = { "狀態": { select: { name: MAP[decision] } }, "計畫審核意見": rt_(comment), "計畫審核日": { date: { start: today_() } } };
  if (pay) upd["計畫XP已發"] = { checkbox: true };
  const res = notionV_(token, "pages/" + v.id, "patch", { properties: upd }, NOTION_VERSION_DS);
  if (res.code !== 200) return { ok: false, error: "審核失敗（Notion 回應 " + res.code + "），沒有任何變動" };

  if (pay) {
    const led = proposalReward_(token, v, PROPOSAL_XP_PLAN, "創造提案計畫通過：" + (v.plan["提案名稱"] || "未命名"));
    if (!led.ok) {
      notionV_(token, "pages/" + v.id, "patch", { properties: {
        "狀態": { select: { name: "計畫審核中" } }, "計畫XP已發": { checkbox: false } } }, NOTION_VERSION_DS);
      return { ok: false, error: "帳本沒寫成功（" + led.error + "），已把提案改回「計畫審核中」，請稍後再按一次通過" };
    }
  }
  return { ok: true, seat: v.seat, status: MAP[decision], xp: pay ? PROPOSAL_XP_PLAN : 0,
    note: decision === "通過" && !pay ? "（這件提案之前已發過計畫 XP，這次不重複發）" : "" };
}

/** 教師：裁決表二。通過→成果通過＋帳本 +20＋頒命名權券（各恰一次）；延長→可再改表二重送 */
function proposalReviewResult_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { ok: false, error: "尚未設定 NOTION_TOKEN" };
  const MAP = { "通過": "成果通過", "延長": "延長試行", "未通過": "成果未通過" };
  const decision = String(body.decision || "");
  const comment = String(body.comment || "").trim().slice(0, PROPOSAL_TEXT_MAX);
  if (!MAP[decision]) return { ok: false, error: "裁決結果只能是 通過／延長／未通過" };
  if (decision !== "通過" && !comment) return { ok: false, error: "「" + decision + "」要寫理由或回饋，學生才知道下一步" };

  const cur = readProposalPage_(token, String(body.page_id || "").trim());
  if (!cur.ok) return cur;
  const v = cur.view;
  if (v.status !== "成果審核中") {
    return { ok: false, error: "這件提案目前是「" + v.status + "」，不在成果審核階段（可能已經裁決過，請重新整理）" };
  }
  const pay = decision === "通過" && !v.xp_result;
  const award = decision === "通過" && !v.naming;
  const upd = { "狀態": { select: { name: MAP[decision] } }, "成果裁決意見": rt_(comment), "成果裁決日": { date: { start: today_() } } };
  if (pay) upd["成果XP已發"] = { checkbox: true };
  if (award) upd["命名權已頒"] = { checkbox: true };
  const res = notionV_(token, "pages/" + v.id, "patch", { properties: upd }, NOTION_VERSION_DS);
  if (res.code !== 200) return { ok: false, error: "裁決失敗（Notion 回應 " + res.code + "），沒有任何變動" };

  const name = v.plan["提案名稱"] || "未命名";
  if (pay) {
    const led = proposalReward_(token, v, PROPOSAL_XP_RESULT, "創造提案成果通過：" + name);
    if (!led.ok) {
      const back = { "狀態": { select: { name: "成果審核中" } }, "成果XP已發": { checkbox: false } };
      if (award) back["命名權已頒"] = { checkbox: false };
      notionV_(token, "pages/" + v.id, "patch", { properties: back }, NOTION_VERSION_DS);
      return { ok: false, error: "帳本沒寫成功（" + led.error + "），已把提案改回「成果審核中」，請稍後再按一次通過" };
    }
  }
  let warn = "";
  if (award) {
    const nowIso = nowIso_();
    const ticket = notionV_(token, "pages", "post", {
      parent: { type: "data_source_id", data_source_id: DS_REDEEM },
      properties: {
        "申請": { title: [{ text: { content: "座號" + v.seat + " 獲頒 " + NAMING_TICKET } }] },
        "座號": { number: v.seat },
        "品項": rt_(NAMING_TICKET),
        "價格": { number: 0 },
        "分類": { select: { name: "特權" } },
        "狀態": { select: { name: "已完成" } },
        "處理時間": { date: { start: nowIso } },
        "剩餘次數": { number: 1 },
        "已使用次數": { number: 0 },
        "備註": rt_("創造提案成果通過頒予：" + name),
        "學年": { select: { name: schoolYear_() } },
      },
    }, NOTION_VERSION_DS);
    if (ticket.code !== 200) {
      notionV_(token, "pages/" + v.id, "patch", { properties: { "命名權已頒": { checkbox: false } } }, NOTION_VERSION_DS);
      warn = "⚠️ " + (pay ? "XP 已發，" : "") + "但命名權券沒建成功（Notion 回應 " + ticket.code + "），"
        + "請到 Notion「🛒 兌換申請」手動新增一列：座號 " + v.seat + "、品項「命名權」、價格 0、狀態已完成、剩餘次數 1、學年必填。";
    }
  }
  return { ok: true, seat: v.seat, status: MAP[decision], xp: pay ? PROPOSAL_XP_RESULT : 0,
    naming: award && !warn, warn: warn,
    note: decision === "通過" && !pay ? "（這件提案之前已發過成果 XP，這次不重複發）" : "" };
}

// ---- 創造提案：工具 ----

/** 座號＋查詢碼驗證；回 { token, seat, stu, name } 或 { error } */
function proposalStudent_(props, body) {
  const token = props.getProperty("NOTION_TOKEN");
  if (!token) return { error: "尚未設定 NOTION_TOKEN" };
  const bad = { error: "座號或查詢碼不正確，請再試一次" };
  const seat = Math.floor(Number(body.seat));
  const code = String(body.code || "").trim();
  if (!(seat >= 1 && seat <= 99) || !code) return bad;
  const stu = findStudent_(token, seat);
  if (!stu) return bad;
  const sp = stu.properties || {};
  const stuCode = ((sp["查詢碼"] || {}).rich_text || []).map(t => t.plain_text).join("").trim();
  if (!stuCode || stuCode !== code) return bad;
  return { token: token, seat: seat, stu: stu, name: ((sp["姓名"] || {}).title || []).map(t => t.plain_text).join("").trim() };
}

/** 讀一件提案並確認它真的在「🧪 創造提案」DB（防止拿別的 DB 的頁 ID 來改） */
function readProposalPage_(token, pageId) {
  if (!/^[0-9a-f-]{32,36}$/i.test(pageId)) return { ok: false, error: "提案編號有誤，請重新整理頁面" };
  const res = notionV_(token, "pages/" + pageId, "get", null, NOTION_VERSION_DS);
  if (res.code !== 200) return { ok: false, error: "找不到這件提案（Notion 回應 " + res.code + "）" };
  const parent = res.data.parent || {};
  if (!sameId_(parent.data_source_id || "", DS_PROPOSAL) || res.data.in_trash || res.data.archived) {
    return { ok: false, error: "找不到這件提案，請重新整理頁面" };
  }
  return { ok: true, page: res.data, view: proposalView_(res.data) };
}

function studentProposals_(token, stuId) {
  const res = queryDS_(token, DS_PROPOSAL, {
    filter: { property: "學生", relation: { contains: stuId } },
    sorts: [{ timestamp: "created_time", direction: "ascending" }],
    page_size: 100,
  });
  if (res.code !== 200) return { ok: false, error: "系統忙碌，請稍後再試（提案查詢 " + res.code + "）" };
  return { ok: true, items: (res.data.results || []).map(proposalView_) };
}

/** 該座號已核可的「創造提案權」券 */
function proposalTickets_(token, seat) {
  const res = queryDS_(token, DS_REDEEM, {
    filter: { and: [
      { property: "座號", number: { equals: seat } },
      { property: "狀態", select: { equals: "已完成" } },
      { property: "品項", rich_text: { equals: PROPOSAL_TICKET } },
    ] },
    page_size: 100,
  });
  if (res.code !== 200) return { ok: false, error: "系統忙碌，請稍後再試（提案權查詢 " + res.code + "）" };
  return { ok: true, items: (res.data.results || []).map(page => {
    const p = page.properties || {};
    return {
      id: page.id,
      remaining: Math.round(Number((p["剩餘次數"] || {}).number) || 0),
      used: Math.round(Number((p["已使用次數"] || {}).number) || 0),
      log: ((p["使用紀錄"] || {}).rich_text || []).map(t => t.plain_text).join(""),
    };
  }) };
}

/** 還沒被任何提案綁走、也沒被作廢（剩餘與已使用都是 0＝作廢）的券 */
function freeTicket_(tickets, proposals) {
  const bound = proposals.map(x => normId_(x.ticket_id)).filter(Boolean);
  return tickets.find(t => bound.indexOf(normId_(t.id)) < 0 && (t.remaining > 0 || t.used > 0)) || null;
}

function markTicketUsed_(token, t) {
  if (t.remaining <= 0) return;
  notionV_(token, "pages/" + t.id, "patch", { properties: {
    "剩餘次數": { number: t.remaining - 1 },
    "已使用次數": { number: t.used + 1 },
    "最近使用": { date: { start: today_() } },
    "使用紀錄": rt_(appendLog_(t.log, stampMD_() + " 開始填寫線上創造提案")),
  } }, NOTION_VERSION_DS);
}

function proposalReward_(token, v, amount, reason) {
  let stuId = v.student_id;
  if (!stuId) {
    const stu = findStudent_(token, v.seat);
    if (!stu) return { ok: false, error: "名冊查無座號 " + v.seat };
    stuId = stu.id;
  }
  const res = notionV_(token, "pages", "post", {
    parent: { type: "data_source_id", data_source_id: DS_BANK },
    properties: {
      "事由": { title: [{ text: { content: reason.slice(0, 120) } }] },
      "學生": { relation: [{ id: stuId }] },
      "金額": { number: amount },
      "類型": { select: { name: "獎勵金" } }, // 獎勵金＝貢獻 XP（sync-notion.mjs XP_MERIT_TYPES）
      "日期": { date: { start: today_() } },
      "學年": { select: { name: schoolYear_() } },
    },
  }, NOTION_VERSION_DS);
  return res.code === 200 ? { ok: true } : { ok: false, error: "Notion 回應 " + res.code };
}

function proposalView_(page) {
  const p = page.properties || {};
  const txt = k => ((p[k] || {}).rich_text || []).map(t => t.plain_text).join("");
  const sel = k => (((p[k] || {}).select) || {}).name || "";
  const multi = k => ((p[k] || {}).multi_select || []).map(o => o.name);
  const date = k => ((((p[k] || {}).date) || {}).start || "").slice(0, 10);
  const rel = k => ((((p[k] || {}).relation || [])[0]) || {}).id || "";
  const out = {
    id: page.id,
    seat: Math.floor(Number((p["座號"] || {}).number) || 0),
    student_id: rel("學生"),
    ticket_id: rel("兌換申請"),
    status: sel("狀態") || "草稿",
    created: page.created_time || "",
    edited: page.last_edited_time || "",
    submitted: ((((p["最後送出"] || {}).date) || {}).start) || "",
    plan: {
      "提案名稱": ((p["提案名稱"] || {}).title || []).map(t => t.plain_text).join(""),
      "類型": sel("類型"), "試行起": date("試行起"), "試行迄": date("試行迄"),
      "記錄方式": multi("記錄方式"), "護欄自檢": multi("護欄自檢"),
    },
    result: { "達成": sel("達成") },
    plan_comment: txt("計畫審核意見"), plan_reviewed: date("計畫審核日"),
    result_comment: txt("成果裁決意見"), result_reviewed: date("成果裁決日"),
    xp_plan: !!(p["計畫XP已發"] || {}).checkbox,
    xp_result: !!(p["成果XP已發"] || {}).checkbox,
    naming: !!(p["命名權已頒"] || {}).checkbox,
  };
  PROPOSAL_TEXT_PLAN.forEach(k => { out.plan[k] = txt(k); });
  PROPOSAL_TEXT_RESULT.forEach(k => { out.result[k] = txt(k); });
  return out;
}

/** 回給學生的版本：拿掉內部關聯 ID */
function studentView_(v) {
  const o = JSON.parse(JSON.stringify(v));
  delete o.student_id; delete o.ticket_id;
  return o;
}

/** 前端欄位 → Notion properties（只收白名單、型別與選項不符就清空、文字截斷） */
function proposalProps_(part, fields) {
  const spec = PROPOSAL_SPEC[part];
  const out = {};
  Object.keys(spec).forEach(k => {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) return;
    const kind = spec[k][0], opts = spec[k][1], v = fields[k];
    if (kind === "text") out[k] = rt_(String(v == null ? "" : v).trim().slice(0, PROPOSAL_TEXT_MAX));
    else if (kind === "title") {
      const s = String(v == null ? "" : v).trim().slice(0, 60);
      out[k] = { title: s ? [{ text: { content: s } }] : [] };
    } else if (kind === "select") {
      const s = String(v == null ? "" : v);
      out[k] = { select: opts.indexOf(s) >= 0 ? { name: s } : null };
    } else if (kind === "multi") {
      const arr = (Array.isArray(v) ? v : []).map(String).filter((x, i, a) => opts.indexOf(x) >= 0 && a.indexOf(x) === i);
      out[k] = { multi_select: arr.map(n => ({ name: n })) };
    } else if (kind === "date") {
      const s = String(v == null ? "" : v);
      out[k] = { date: /^\d{4}-\d{2}-\d{2}$/.test(s) ? { start: s } : null };
    }
  });
  return out;
}

/** 送出前的必填檢查（以伺服器讀回的內容為準，不信任前端） */
function proposalMissing_(part, v) {
  const miss = [];
  if (part === "plan") {
    const pl = v.plan;
    PLAN_REQUIRED.forEach(k => { if (!String(pl[k] || "").trim()) miss.push(k); });
    if (!pl["記錄方式"].length) miss.push("記錄方式");
    if (pl["試行起"] && pl["試行迄"] && pl["試行迄"] < pl["試行起"]) miss.push("試行迄（不能早於試行起）");
    const lack = PROPOSAL_GUARDS.filter(g => pl["護欄自檢"].indexOf(g) < 0);
    if (lack.length) miss.push("護欄自我檢查（還差 " + lack.length + " 項）");
  } else {
    RESULT_REQUIRED.forEach(k => { if (!String(v.result[k] || "").trim()) miss.push(k); });
  }
  return miss;
}

/** 命名不能帶自己的姓名（全名或名字）或「N號」 */
function nameLeak_(text, fullName) {
  if (!text) return false;
  if (/\d+\s*號/.test(text)) return true;
  if (fullName && text.indexOf(fullName) >= 0) return true;
  if (fullName && fullName.length >= 3 && text.indexOf(fullName.slice(1)) >= 0) return true;
  return false;
}

/** 每座號每分鐘次數上限（CacheService，不需額外授權） */
function overLimit_(key, max) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 60);
  return n > max;
}

function rt_(s) { return { rich_text: s ? [{ text: { content: String(s) } }] : [] }; }
function normId_(id) { return String(id || "").replace(/-/g, "").toLowerCase(); }
function sameId_(a, b) { return !!a && normId_(a) === normId_(b); }
function nowIso_() { return Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd'T'HH:mm:ss+08:00"); }

// 名冊：座號＋在學 → 學生頁（含 properties）；查無回 null
function findStudent_(token, seat) {
  const res = queryDS_(token, DS_ROSTER, {
    filter: { and: [
      { property: "座號", number: { equals: seat } },
      { property: "在學", checkbox: { equals: true } },
    ] },
    page_size: 1,
  });
  if (res.code !== 200) return null;
  return (res.data.results || [])[0] || null;
}

// 帳本該生財務：餘額（全部金額加總）＋XP（含分頁）；失敗回 null
// XP 算法與 sync-notion.mjs bankFinanceBySeat 一致：總 XP＝「薪水」＋「獎勵金」正數；貢獻 XP＝「獎勵金」正數。
const XP_DUTY_TYPES = ["薪水"];
const XP_MERIT_TYPES = ["獎勵金"];
function studentFinance_(token, studentPageId) {
  const fin = { balance: 0, xp: 0, xpMerit: 0 };
  let cursor = null;
  do {
    const payload = {
      filter: { property: "學生", relation: { contains: studentPageId } },
      page_size: 100,
    };
    if (cursor) payload.start_cursor = cursor;
    const res = queryDS_(token, DS_BANK, payload);
    if (res.code !== 200) return null;
    for (const page of res.data.results || []) {
      const p = page.properties || {};
      const amt = Math.round(Number((p["金額"] || {}).number) || 0);
      const type = (((p["類型"] || {}).select) || {}).name || "";
      fin.balance += amt;
      if (amt > 0 && XP_DUTY_TYPES.indexOf(type) >= 0) fin.xp += amt;
      if (amt > 0 && XP_MERIT_TYPES.indexOf(type) >= 0) { fin.xp += amt; fin.xpMerit += amt; }
    }
    cursor = res.data.has_more ? res.data.next_cursor : null;
  } while (cursor);
  return fin;
}

// ═══ v2.5 兌換條件自動把關（SPEC_兌換條件自動把關.md）══════════════════════
// 原則：條件全在這裡判，前端反灰只是提示；判不出來（Notion 查詢失敗）一律當作「不通過」並說明原因。
const DS_LOG = "eb529fa1-59e5-45ef-bfb4-79fc30de79e4";    // 📝 班經與學習紀錄庫
const DS_DUTIES = "ccd4b894-5455-49f9-97e7-d56b42b51713"; // 🧹 班級工作分配
const FREE_CLEAN_TICKET = "免打掃一次券";

// 日期工具：一律用 yyyy-MM-dd 字串（台北日期）運算，以 UTC 午夜承載，避免時區漂移
function addDays_(ymd, n) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf_(ymd) { return addDays_(ymd, -((new Date(ymd + "T00:00:00Z").getUTCDay() + 6) % 7)); }
function taipeiDate_(iso) {
  if (!iso) return "";
  return iso.length === 10 ? iso : Utilities.formatDate(new Date(iso), "Asia/Taipei", "yyyy-MM-dd");
}
function md_(ymd) { return ymd.slice(5).replace("-", "/"); }

// 商店頁：優先用申請列的商店頁ID，沒有（舊申請／手動建列）就用品項名找；找不到回 null
function storePageFor_(token, storePageId, itemName) {
  if (storePageId) {
    const r = notionV_(token, "pages/" + storePageId, "get", null, NOTION_VERSION_DS);
    if (r.code === 200) return r.data;
  }
  if (!itemName) return null;
  const q = queryDS_(token, DS_STORE, { filter: { property: "品項", title: { equals: itemName } }, page_size: 1 });
  return q.code === 200 ? ((q.data.results || [])[0] || null) : null;
}

// 機讀門檻：🏪 商店「解鎖總XP」「解鎖貢獻XP」（空白＝沒有門檻）
function unlockOf_(storeProps) {
  const n = k => Math.max(0, Math.round(Number((storeProps[k] || {}).number) || 0));
  return { xp: n("解鎖總XP"), merit: n("解鎖貢獻XP") };
}

// XP 門檻：通過回 ""，否則回「還差總 XP N／貢獻 XP M」
function xpBlockReason_(fin, unlock) {
  const lackXp = Math.max(0, unlock.xp - fin.xp);
  const lackMerit = Math.max(0, unlock.merit - fin.xpMerit);
  if (!lackXp && !lackMerit) return "";
  const parts = [];
  if (lackXp) parts.push("總 XP " + lackXp);
  if (lackMerit) parts.push("貢獻 XP " + lackMerit);
  return "還差" + parts.join("／") + "（目前總 XP " + fin.xp + "、貢獻 XP " + fin.xpMerit + "）";
}

// 兌換資格規則：REDEEM_RULES[品項] = fn(token, { stuId, from, to }) → "" 通過／原因。
// 之後別的品項要加兌換條件，只加一條規則。
const REDEEM_RULES = {};
REDEEM_RULES[FREE_CLEAN_TICKET] = function (token, ctx) {
  // 兌換當週（申請日所在週一 ～ 今天）紀錄庫事件描述逐字＝「打掃未達標」（與 f24 tallyBySeat 同撈法）
  const res = queryDS_(token, DS_LOG, { filter: { and: [
    { property: "事件描述", title: { equals: "打掃未達標" } },
    { property: "學生", relation: { contains: ctx.stuId } },
    { property: "日期", date: { on_or_after: ctx.from } },
    { property: "日期", date: { on_or_before: ctx.to } },
  ] }, page_size: 1 });
  if (res.code !== 200) return "查不到打掃紀錄（紀錄庫回應 " + res.code + "），請稍後再試";
  return (res.data.results || []).length ? "這週打掃被登記「需改進（未達標）」，下週再來換喔" : "";
};

// 兌換資格總檢：XP 門檻 → 品項規則。fin 可傳入已算好的財務（省一次帳本查詢）
function redeemEligibility_(token, stuId, itemName, unlock, from, to, fin) {
  if ((unlock.xp || unlock.merit) && !fin) fin = studentFinance_(token, stuId);
  if ((unlock.xp || unlock.merit) && !fin) return { reason: "XP 計算失敗，請稍後再試", fin: null };
  let reason = (unlock.xp || unlock.merit) ? xpBlockReason_(fin, unlock) : "";
  if (!reason && REDEEM_RULES[itemName]) reason = REDEEM_RULES[itemName](token, { stuId: stuId, from: from, to: to });
  return { reason: reason, fin: fin || null };
}

// 使用條件：USE_RULES[品項] = fn(券, ctx) → "" 可用／原因。券需有 seat、got（核可時間）。
// ctx 由 useContext_ 一次撈好，清單裡每張券共用，不必各查一次。
const USE_RULES = {};
USE_RULES[FREE_CLEAN_TICKET] = function (t, ctx) {
  if (ctx.error) return ctx.error;
  const got = taipeiDate_(t.got);
  if (!got) return "查不到核可日，無法判斷哪一週能用";
  const allowMon = addDays_(mondayOf_(got), 7);
  if (ctx.monday < allowMon) return "兌換後的下一週才能用（" + md_(allowMon) + " 起）";
  if (ctx.monday > allowMon) return "只能在兌換後的下一週（" + md_(allowMon) + "～" + md_(addDays_(allowMon, 6)) + "）使用，已過期，可作廢或退費";
  if (ctx.freeCleanUses.some(u => u.seat === t.seat)) return "這週已經用過一張免打掃券（一週限用一張）";
  const mates = {};
  for (const g of ctx.cleanGroups) {
    if (g.indexOf(t.seat) < 0) continue;
    for (const s of g) if (s !== t.seat) mates[s] = true;
  }
  const clash = ctx.freeCleanUses.find(u => u.date === ctx.today && mates[u.seat]);
  if (clash) return "同組的座號 " + clash.seat + " 今天已經用了免打掃券（同組同一天限一人）";
  return "";
};

// 使用條件共用資料：本週用過的免打掃券＋打掃組成員
function useContext_(token) {
  const today = today_();
  const ctx = { today: today, monday: mondayOf_(today), freeCleanUses: [], cleanGroups: [], error: "" };
  // 本週用過的免打掃券：「已使用次數」>0 才算（老師撤銷後會變 0，不算）
  let cursor = null;
  do {
    const payload = { filter: { and: [
      { property: "品項", rich_text: { equals: FREE_CLEAN_TICKET } },
      { property: "已使用次數", number: { greater_than: 0 } },
      { property: "最近使用", date: { on_or_after: ctx.monday } },
    ] }, page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    const res = queryDS_(token, DS_REDEEM, payload);
    if (res.code !== 200) { ctx.error = "查不到本週使用紀錄（兌換申請回應 " + res.code + "），請稍後再試"; return ctx; }
    for (const page of res.data.results || []) {
      const p = page.properties || {};
      ctx.freeCleanUses.push({
        seat: Math.floor(Number((p["座號"] || {}).number) || 0),
        date: (((p["最近使用"] || {}).date) || {}).start || "",
      });
    }
    cursor = res.data.has_more ? res.data.next_cursor : null;
  } while (cursor);
  // 打掃組：類型＝打掃、有勾顯示；成員座號半形逗號分隔（與 f24 seatsOf 同規則，濾掉空字串以免變成座號 0）
  const duty = queryDS_(token, DS_DUTIES, { filter: { and: [
    { property: "類型", select: { equals: "打掃" } },
    { property: "顯示", checkbox: { equals: true } },
  ] }, page_size: 100 });
  if (duty.code !== 200) { ctx.error = "查不到打掃分組（工作分配回應 " + duty.code + "），請稍後再試"; return ctx; }
  for (const page of duty.data.results || []) {
    const raw = (((page.properties || {})["成員座號"] || {}).rich_text || []).map(t => t.plain_text).join("");
    const seats = raw.split(/[,、，\s]+/).map(x => x.trim()).filter(Boolean).map(Number)
      .filter(n => Number.isInteger(n) && n > 0);
    if (seats.length) ctx.cleanGroups.push(seats);
  }
  return ctx;
}

function queryDS_(token, dsId, payload) {
  return notionV_(token, "data_sources/" + dsId + "/query", "post", payload, NOTION_VERSION_DS);
}

// ---------- 工具 ----------

function notion_(token, path, method, payload) {
  return notionV_(token, path, method, payload, NOTION_VERSION);
}

function notionV_(token, path, method, payload, version) {
  const opts = {
    method: method,
    headers: {
      Authorization: "Bearer " + token,
      "Notion-Version": version,
      "Content-Type": "application/json",
    },
    muteHttpExceptions: true,
  };
  if (payload !== null && payload !== undefined) opts.payload = JSON.stringify(payload);
  const res = UrlFetchApp.fetch("https://api.notion.com/v1/" + path, opts);
  const code = res.getResponseCode();
  let data = {};
  try { data = JSON.parse(res.getContentText()); } catch (err) {}
  return { code: code, data: data };
}

// 學年欄位鐵則：西元年 − 1911 −（月份 < 8 ? 1 : 0）；以寫入當下的台北時間為準
function schoolYear_() {
  const now = new Date();
  const y = Number(Utilities.formatDate(now, "Asia/Taipei", "yyyy"));
  const m = Number(Utilities.formatDate(now, "Asia/Taipei", "MM"));
  return String(y - 1911 - (m < 8 ? 1 : 0));
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

// 換權限後在編輯器手動執行一次，完成授權（之後不會再用到）
function authorize() {
  Logger.log("授權完成");
}
