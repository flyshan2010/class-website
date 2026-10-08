/**
 * Google 相簿「分享相簿」→ 照片清單（零相依，Node 18+）
 * Google 沒有可讀分享相簿的官方 API，這裡解析分享頁 HTML 內嵌的資料（非官方做法）：
 * 每張照片長成 ["AF1Qip…（照片 id）",["https://lh3.googleusercontent.com/pw/…",寬,高,…
 * Google 改版時 parseSharedAlbum 會回空陣列——呼叫端（sync-drive.mjs）會沿用上一次的照片並示警，不會把相簿洗成空的。
 */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export const isGooglePhotosUrl = url =>
  /^https:\/\/(photos\.app\.goo\.gl\/|photos\.google\.com\/(u\/\d+\/)?share\/)/.test(String(url || "").trim());

// 老師從自己帳號複製的網址常帶 /u/1/（帳號序號），未登入的訪客與同步機器人要拿掉才開得了。
export const normalizeShareUrl = url =>
  String(url || "").trim().replace(/photos\.google\.com\/u\/\d+\//, "photos.google.com/");

export function parseSharedAlbum(html) {
  const re = /\["(AF1Qip[A-Za-z0-9_-]+)",\["(https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+)",(\d+),(\d+)/g;
  const seen = new Set();
  const photos = [];
  for (const [, id, base] of String(html || "").matchAll(re)) {
    if (seen.has(id)) continue; // 封面會在資料裡出現兩次
    seen.add(id);
    photos.push({ thumb: `${base}=w400-h400-c`, full: `${base}=w1600` });
  }
  return photos;
}

export async function fetchSharedAlbum(url) {
  const res = await fetch(normalizeShareUrl(url), { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseSharedAlbum(await res.text());
}
