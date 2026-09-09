# 班級網站（班網）

公開班網＋班級經營前後台：前台是 GitHub Pages 靜態網站，後台資料全部在 Notion「🏫 班級經營中心」，GitHub Actions 定時把 Notion 資料同步成 `data/*.json`。

## 架構

```
Notion（聯絡簿/公告/行事曆/週報/常用網站/相簿索引）
   │  GitHub Actions（每日 3 次＋手動）
   ▼
data/*.json  ──►  GitHub Pages 靜態班網（index.html 等 9 頁）
   ▲
Google Drive 活動照片資料夾（sync-drive.mjs 產生縮圖清單）
```

## 檔案說明

- `index.html` 等 9 頁：前台頁面，讀 `data/*.json` 渲染。
- `data/site-config.json`：校名、班級、導覽、模組色彩。
- `data/schedule.json`、`data/about.json`：日課表與關於我們（手動維護）。
- `data/class-rules.json`：班規與獎懲、一日作息與上課常規、抽獎池（由 Notion「📋 班規與獎懲」
  「🕗 作息與常規」與「🏪 班級商店」的抽獎池勾選同步產生，**勿手改**）。
- `scripts/bump-assets.mjs`：把每個 html 的 `assets/**` 引用蓋上 `?v=` 版本號（見下方「改前端一定要 bump」）。
- `scripts/build-schedule-overrides.mjs`：行事曆的單日調課 → `data/schedule-overrides.json`（勿手改該檔）。
- `scripts/sync-notion.mjs`：Notion → JSON（需 `NOTION_TOKEN`）。
- `scripts/sync-drive.mjs`：Drive 相簿 → `gallery.json`（需 `DRIVE_API_KEY`，選用）。
- `.github/workflows/sync.yml`：排程與手動同步。
- `docs/老師操作手冊.md`：日常操作說明（含初次設定）。

## 改前端一定要 bump 版本號（2026-09-09 起）

**只要動到 `assets/` 底下任何 css／js，commit 前跑一次：**

```bash
node scripts/bump-assets.mjs
```

同一天多次改動會自動遞增（`20260909-1` → `-2` → …）；要指定就 `node scripts/bump-assets.mjs 20260909-7`。

**為什麼不能省**：沒有版本號時，瀏覽器會拿**快取的舊 JS** 配**新的 HTML**，
函式簽名對不起來 → 按鈕按下去什麼都不發生、畫面空白，而**主控台以外看不到任何錯誤**。
家長只會覺得「這個網站壞了」，而重新整理一次不一定救得回來（要強制重新整理）。

⚠️ **`?v=` 只換得掉 JS／CSS，HTML 本身也會被瀏覽器與 GitHub Pages 快取**——
線上驗證時網址一律另外加 `?t=<時間戳>`（`curl` 與瀏覽器都要），
**不要只 bump 完就以為驗到新版**；「改了沒效」常常是驗到舊 HTML 的假象。

## 本機預覽

```bash
npx http-server . -p 8890 -c-1
# 或任何靜態伺服器；直接開 file:// 會因 fetch 被擋而無法載入資料
```

## 本機手動同步

```bash
NOTION_TOKEN=ntn_xxx node scripts/sync-notion.mjs
DRIVE_API_KEY=xxx node scripts/sync-drive.mjs
```

## 隱私提醒

- 本站完全公開：不放學生全名、個資、成績。
- 照片需有肖像權同意書，避免特寫＋全名同框。
- 未來「學生學習狀況查詢」屬個資，將另以私有通道實作（見規劃藍圖第三階段）。
