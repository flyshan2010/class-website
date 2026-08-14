/**
 * 班網本機預覽伺服器（零相依，Node 18+）
 *
 * 用途：改完班網要「線上實測」前，先在本機開起來看。
 * 啟動：node scripts/dev-server.mjs   （或由 .claude/launch.json 的 class-website 設定啟動）
 *
 * 2026-08-14 建立。原本這支放在 Claude 的暫存資料夾，換一次 session 就消失、
 * launch.json 指向的路徑就爛掉；改放進 repo 當版控正本，路徑永遠有效。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8765);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".pdf": "application/pdf", ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(ROOT, rel);
    // 不讓路徑跳出 repo
    if (!file.startsWith(ROOT)) { res.writeHead(403).end("403"); return; }
    const s = await stat(file).catch(() => null);
    const target = s?.isDirectory() ? path.join(file, "index.html") : file;
    const buf = await readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",   // 改完重整就看到新的
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
  }
}).listen(PORT, () => console.log(`班網預覽：http://localhost:${PORT}/`));
