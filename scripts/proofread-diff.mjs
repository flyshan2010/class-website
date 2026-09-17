#!/usr/bin/env node
// 文字校對第三層的輸入抽取（SPEC_文字校對 §2 第三層；週五收尾第 3 支呼叫）
// 取「基準點以來 data/*.json 新出現的中文字串」，只讀不改，輸出給 AI 語意校對用。
// 用法：node scripts/proofread-diff.mjs [--since "7 days ago"] [--out 檔案]
//   基準點＝早於 --since 的最後一個 commit（無狀態檔：週五跑就是「上週五以來」）。
//   --out 省略時只印統計；有給才寫出 JSON（放 scratchpad，不進 repo）。
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const since = arg("--since") ?? "7 days ago";
const out = arg("--out");

// 排除：加密檔（reports／bank）、上傳檔、校網轉載（不是我們寫的，改不了）
const SKIP_DIRS = new Set(["reports", "bank", "uploads"]);
const SKIP_FILES = new Set(["school-news.json", "synced-at.json"]);
const HAS_CJK = /[一-鿿]/;

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });

function collect(value, set) {
  if (typeof value === "string") {
    const s = value.trim();
    if (s.length >= 2 && HAS_CJK.test(s) && !/^https?:\/\//.test(s)) set.add(s);
  } else if (Array.isArray(value)) value.forEach(v => collect(v, set));
  else if (value && typeof value === "object") Object.values(value).forEach(v => collect(v, set));
}

async function listJson(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) files.push(...await listJson(path.join(dir, e.name))); continue; }
    if (e.name.endsWith(".json") && !SKIP_FILES.has(e.name)) files.push(path.join(dir, e.name));
  }
  return files;
}

const base = git("rev-list", "-1", `--before=${since}`, "HEAD").trim();
if (!base) { console.error(`找不到早於「${since}」的 commit，無法定基準點`); process.exit(1); }

const result = [];
let total = 0;
for (const full of await listJson(path.join(ROOT, "data"))) {
  const rel = path.relative(ROOT, full).split(path.sep).join("/");
  const now = new Set(), old = new Set();
  collect(JSON.parse(await readFile(full, "utf8")), now);
  try { collect(JSON.parse(git("show", `${base}:${rel}`)), old); } catch { /* 基準點沒有此檔＝全部算新增 */ }
  const added = [...now].filter(s => !old.has(s));
  if (added.length) { result.push({ file: rel, strings: added }); total += added.length; }
}

const payload = { base: base.slice(0, 8), since, total, files: result };
if (out) await writeFile(out, JSON.stringify(payload, null, 1));
console.log(`基準點 ${payload.base}（早於 ${since}）：${result.length} 檔、${total} 條新字串${out ? ` → ${out}` : ""}`);
