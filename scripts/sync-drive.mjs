/**
 * Google Drive 相簿 → data/gallery.json（零相依，Node 18+）
 * 讀 data/gallery-index.json（由 sync-notion.mjs 產出），
 * 用 Drive API key 列出各公開資料夾的照片，組出縮圖清單。
 * 用法：DRIVE_API_KEY=xxx node scripts/sync-drive.mjs
 * 沒有 DRIVE_API_KEY 時：保留相簿清單但照片為空（班網仍可顯示 Drive 連結）。
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const KEY = process.env.DRIVE_API_KEY;
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

const folderIdFrom = url => {
  const m = String(url || "").match(/folders\/([A-Za-z0-9_-]+)/) || String(url || "").match(/[?&]id=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
};

async function listPhotos(folderId) {
  const photos = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: "nextPageToken, files(id, name, createdTime)",
      orderBy: "createdTime",
      pageSize: "100",
      key: KEY,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    if (!res.ok) {
      console.warn(`⚠️ Drive 資料夾 ${folderId} 讀取失敗（${res.status}），略過`);
      return photos;
    }
    const json = await res.json();
    for (const f of json.files || []) {
      photos.push({
        thumb: `https://drive.google.com/thumbnail?id=${f.id}&sz=w400`,
        full: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1600`,
      });
    }
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return photos;
}

const index = JSON.parse(await readFile(path.join(DATA_DIR, "gallery-index.json"), "utf8"));
const albums = [];
for (const album of index) {
  const folderId = folderIdFrom(album.folderUrl);
  const photos = KEY && folderId ? await listPhotos(folderId) : [];
  albums.push({
    title: album.title,
    date: album.date,
    folderUrl: album.folderUrl || "",
    cover: photos[0]?.thumb || "",
    photos,
  });
  console.log(`📷 ${album.title}：${photos.length} 張`);
}
await writeFile(path.join(DATA_DIR, "gallery.json"), JSON.stringify(albums, null, 2) + "\n", "utf8");
console.log("🎉 相簿同步完成");
