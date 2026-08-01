/**
 * 班網教師專區代理 v2.2（Google Apps Script）── ClassOS v3.5 Phase A＋班級商店兌換＋特權執行
 * 取代 apps-script-update-proxy.gs（v1 只有一鍵更新）。
 *
 * 功能（單一 Web App，doPost 依 action 分派）：
 *   - submit_task   ：一句話 → 建 Notion「📥 任務收件匣」頁
 *   - upload_file   ：base64 檔案 → 存 Google Drive 指定資料夾 → 回傳連結
 *   - list_tasks    ：查收件匣最近 N 筆（教師專區任務狀態清單用）
 *   - trigger_sync  ：觸發 GitHub Actions repository_dispatch（一鍵更新班網）
 *   - redeem_request：學生在小小銀行送出商店兌換申請（以座號＋查詢碼驗證，不需教師口令）
 *   - list_redeems  ：查兌換申請（教師專區處理與明細查詢用）
 *   - approve_redeem：核可申請 → 自動建帳本「消費」列扣幣＋商店庫存 −1 ＋申請設「已完成」
 *                     特權類另寫「剩餘次數」＝商店「使用次數」（空白＝1），該列即成為學生的特權券
 *   - reject_redeem ：駁回申請（填原因）
 *   - list_privileges ：查特權券（holding＝剩餘>0；history＝已用完/作廢）
 *   - use_privilege   ：學生執行特權 → 剩餘 −1、已使用 +1、追加使用紀錄（同日重複扣需 force）
 *   - undo_privilege  ：誤按還原（剩餘 +1、已使用 −1）
 *   - void_privilege  ：作廢（剩餘歸 0，填原因；不退幣）
 *
 * 資安原則：
 *   - 教師動作口令一律放 POST body，禁止放 URL query（doGet 僅保留舊版相容一版後移除）。
 *   - redeem_request 是唯一的學生動作：以 座號＋查詢碼 對名冊驗證，品項與價格一律以
 *     Notion 商店為準（不信任前端送來的價格），且每人同時最多 3 筆待處理申請。
 *   - 代理不記錄口令；GitHub/Notion token 只存在指令碼屬性，不進前端。
 *
 * 部署步驟（升級自 v2 約 5 分鐘）：
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
  if (price <= 0) return { ok: false, error: "商品價格設定有誤，請告訴老師" };

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

  const items = (res.data.results || []).map(page => {
    const p = page.properties || {};
    return {
      page_id: page.id,
      seat: (p["座號"] || {}).number || 0,
      item: ((p["品項"] || {}).rich_text || []).map(t => t.plain_text).join(""),
      price: (p["價格"] || {}).number || 0,
      status: (((p["狀態"] || {}).select) || {}).name || "",
      note: ((p["備註"] || {}).rich_text || []).map(t => t.plain_text).join(""),
      created: page.created_time,
      processed: (((p["處理時間"] || {}).date) || {}).start || "",
    };
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
  if (!seat || !itemName || price <= 0) return { ok: false, error: "申請資料不完整，請直接到 Notion 檢查這筆申請" };

  // 2) 名冊找學生
  const stu = findStudent_(token, seat);
  if (!stu) return { ok: false, error: "名冊查無座號 " + seat + "（非在學？），請到 Notion 確認" };

  // 3) 餘額檢查（帳本該生全部金額加總）；不足時回報，老師可選擇強制核可
  const balance = studentBalance_(token, stu.id);
  if (balance === null) return { ok: false, error: "餘額計算失敗，請稍後再試" };
  if (balance < price && !body.force) {
    return { ok: false, insufficient: true, balance: balance,
      error: "餘額不足：目前 " + balance + " 幣，需要 " + price + " 幣" };
  }

  // 4) 帳本建「消費」列（扣款正本）
  const today = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  const ledger = notionV_(token, "pages", "post", {
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
  if (storePageId) {
    const store = notionV_(token, "pages/" + storePageId, "get", null, NOTION_VERSION_DS);
    if (store.code === 200) {
      const sp = store.data.properties || {};
      uses = Math.max(1, Math.round(Number((sp["使用次數"] || {}).number) || 1));
      if (!category) category = (((sp["分類"] || {}).select) || {}).name || "小物";
      const stock = Number((sp["庫存"] || {}).number) || 0;
      const upd = notionV_(token, "pages/" + storePageId, "patch", {
        properties: { "庫存": { number: Math.max(0, stock - 1) } },
      }, NOTION_VERSION_DS);
      if (upd.code !== 200) stockMsg = "（庫存未扣成功，請手動 −1）";
    } else stockMsg = "（找不到商店品項，庫存請手動 −1）";
  } else stockMsg = "（此申請無商店頁ID，庫存請手動 −1）";
  if (!category) category = "小物";

  // 6) 申請設已完成＋處理紀錄；特權類同時發券（剩餘次數＝可用次數）
  const nowIso = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd'T'HH:mm:ss+08:00");
  const newBalance = balance - price;
  const isPrivilege = category === "特權";
  const doneProps = {
    "狀態": { select: { name: "已完成" } },
    "分類": { select: { name: category } },
    "處理時間": { date: { start: nowIso } },
    "備註": { rich_text: [{ text: { content: "已扣 " + price + " 幣，餘額 " + newBalance + " 幣" + stockMsg } }] },
  };
  if (isPrivilege) {
    doneProps["剩餘次數"] = { number: uses };
    doneProps["已使用次數"] = { number: 0 };
  }
  notionV_(token, "pages/" + pageId, "patch", { properties: doneProps }, NOTION_VERSION_DS);
  return { ok: true, seat: seat, item: itemName, price: price, balance: newBalance, stock_msg: stockMsg,
    category: category, uses: isPrivilege ? uses : 0 };
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
  if (category !== "特權") return { ok: false, error: "這筆兌換不是特權類，沒有次數可以扣" };
  return {
    ok: true,
    p: p,
    seat: Math.floor(Number((p["座號"] || {}).number) || 0),
    item: ((p["品項"] || {}).rich_text || []).map(t => t.plain_text).join(""),
    remaining: Math.round(Number((p["剩餘次數"] || {}).number) || 0),
    used: Math.round(Number((p["已使用次數"] || {}).number) || 0),
    log: ((p["使用紀錄"] || {}).rich_text || []).map(t => t.plain_text).join(""),
    lastUsed: (((p["最近使用"] || {}).date) || {}).start || "",
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
  const filter = { and: [
    { property: "狀態", select: { equals: "已完成" } },
    { property: "分類", select: { equals: "特權" } },
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

// 帳本該生餘額（全部交易金額加總，含分頁）；失敗回 null
function studentBalance_(token, studentPageId) {
  let balance = 0;
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
      balance += Math.round(Number(((page.properties || {})["金額"] || {}).number) || 0);
    }
    cursor = res.data.has_more ? res.data.next_cursor : null;
  } while (cursor);
  return balance;
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
