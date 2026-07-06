/**
 * 班網「一鍵更新」代理（Google Apps Script）
 * 用途：讓班網首頁按鈕能觸發 GitHub Actions 同步，而 GitHub token 不暴露在前端。
 *
 * 部署步驟（只需做一次，約 5 分鐘）：
 * 1. 開 https://script.google.com → 新增專案 → 貼上本檔全部內容。
 * 2. 左側「專案設定」→「指令碼屬性」新增兩筆：
 *    - GH_TOKEN：你的 GitHub fine-grained token（只需 class-website repo 的 Contents:RW 權限）
 *    - PASSWORD：自訂一組簡單口令（例如 4~8 位數字），按按鈕時要輸入
 * 3. 右上「部署」→「新增部署作業」→ 類型「網頁應用程式」：
 *    - 執行身分：我　　- 存取權：任何人
 * 4. 複製部署後的網址（https://script.google.com/macros/s/…/exec），
 *    貼到 Notion「⚙️ 網站設定與關於我們」新增一列：項目＝一鍵更新網址、內容＝該網址。
 * 5. 等下次同步（或 GitHub Actions 手動 Run 一次）後，班網首頁就會出現「⚡ 立即更新班網」按鈕。
 */

const REPO = "flyshan2010/class-website";

function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const pw = props.getProperty("PASSWORD");
  const token = props.getProperty("GH_TOKEN");
  if (!pw || !token) return out_({ ok: false, error: "尚未設定指令碼屬性 GH_TOKEN / PASSWORD" });
  if ((e.parameter.pw || "") !== pw) return out_({ ok: false, error: "口令錯誤" });

  const res = UrlFetchApp.fetch("https://api.github.com/repos/" + REPO + "/dispatches", {
    method: "post",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
    },
    payload: JSON.stringify({ event_type: "sync-now" }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  return out_(code === 204 ? { ok: true } : { ok: false, error: "GitHub 回應 " + code });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
