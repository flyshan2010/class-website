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
- `scripts/sync-notion.mjs`：Notion → JSON（需 `NOTION_TOKEN`）。
- `scripts/sync-drive.mjs`：Drive 相簿 → `gallery.json`（需 `DRIVE_API_KEY`，選用）。
- `.github/workflows/sync.yml`：排程與手動同步。
- `docs/老師操作手冊.md`：日常操作說明（含初次設定）。

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
