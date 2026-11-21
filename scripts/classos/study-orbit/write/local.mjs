/**
 * 自學星圖題本寫入｜資料包封裝與 id 合併（不需任何祕密）
 *
 * 執行位置：私有 repo classos-private 的 .github/workflows/so-write.yml（題本內容不進公開 repo，U42）。
 *   該 workflow 同時 checkout 本公開 repo 的 scripts/classos 取程式，題本資料讀私有 repo 的 自學星圖_P1試點/。
 * 用法（工作目錄＝Project 根，或在 class-website/ 底下）：
 *   node <本檔> pack --levels c-h-4a-7,c-h-4a-8 --cards content_國L7.py,content_國L8.py --structure c-h-4a --out payload.json
 *       讀 自學星圖_P1試點/ 的 bundle.json、ids.json、gen.py＋cards.py 輸出 → 明文資料包（不含時間戳，指紋可重現）
 *   node <本檔> merge <ids-new.json>
 *       把 workflow artifact 的新 id 併回 ids.json（同鍵不同 id＝衝突，整批不寫）
 * 選項：--dir 換題本資料夾（預設 ../ClassOS_v3.5_藍圖/自學星圖_P1試點）
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprint } from "./fingerprint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");

const argv = process.argv.slice(2);
const cmd = argv.shift();
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i < 0 ? dflt : argv.splice(i, 2)[1]; };
const flag = (name) => { const i = argv.indexOf(`--${name}`); if (i < 0) return false; argv.splice(i, 1); return true; };
const DIR = path.resolve(opt("dir", path.resolve(REPO, "../ClassOS_v3.5_藍圖/自學星圖_P1試點")));
const git = (args, input, cwd = REPO) => execFileSync("git", args, { cwd, input, encoding: "utf8" }).trim();

/** 合併新 id：同鍵同 id 略過、同鍵不同 id 算衝突（回傳衝突清單，不寫檔） */
export function mergeIds(ids, fresh) {
  const conflicts = [], added = {};
  for (const [t, m] of Object.entries(fresh)) {
    for (const [k, v] of Object.entries(m)) {
      const cur = ids[t]?.[k];
      if (cur === undefined) { (ids[t] ??= {})[k] = v; added[t] = (added[t] ?? 0) + 1; }
      else if (cur.replace(/-/g, "") !== v.replace(/-/g, "")) conflicts.push(`${t}:${k}`);
    }
  }
  return { conflicts, added };
}

if (cmd === "pack") {
  const levels = (opt("levels", "") || "").split(",").filter(Boolean);
  const cardFiles = (opt("cards", "") || "").split(",").filter(Boolean);
  const structure = (opt("structure", "") || "").split(",").filter(Boolean);
  const out = opt("out", "");
  if (!out) throw new Error("--out 必填（資料包輸出路徑）");
  if (!levels.length) throw new Error("--levels 必填（不給範圍會把舊批沒記 id 的子題重建一次）");
  let cards = [];
  if (cardFiles.length) {
    const r = spawnSync("python3", ["cards.py", ...cardFiles], { cwd: DIR, encoding: "utf8", maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`cards.py 失敗：${r.stderr}`);
    cards = JSON.parse(r.stdout.split("\n")[0]);
  }
  const read = (f) => readFileSync(path.join(DIR, f), "utf8");
  // 來源＝題本資料夾最後變動的 commit：改 handoff 等別處不影響指紋
  let commit = "?", dirty = false;
  try { commit = git(["log", "-1", "--format=%h", "--", "."], undefined, DIR); dirty = !!git(["status", "--porcelain", "--", "."], undefined, DIR); } catch { /* 不是 git 也能封 */ }
  const payload = { version: 2, source: { commit, dirty }, levels, structure, cards,
    ids: JSON.parse(read("ids.json")), bundle: JSON.parse(read("bundle.json")), genPy: read("gen.py") };
  const plain = Buffer.from(JSON.stringify(payload));
  const fp = fingerprint(plain);
  writeFileSync(out, plain);
  console.log(`📦 指紋 ${fp}｜${(plain.length / 1024).toFixed(0)}KB｜卡片 ${cards.length} 張｜來源 ${commit}${dirty ? "（⚠️ 題本資料夾有未 commit 改動）" : ""}`);
} else if (cmd === "merge") {
  const file = argv[0];
  if (!file) throw new Error("用法：merge <ids-new.json>");
  const idsPath = path.join(DIR, "ids.json");
  const ids = JSON.parse(readFileSync(idsPath, "utf8"));
  const { conflicts, added } = mergeIds(ids, JSON.parse(readFileSync(file, "utf8")));
  if (conflicts.length) { console.error(`❌ 衝突 ${conflicts.length} 筆，ids.json 未寫入：${conflicts.slice(0, 20).join("、")}`); process.exit(1); }
  writeFileSync(idsPath, JSON.stringify(ids, null, 1)); // 與 python json.dump(indent=1, ensure_ascii=False) 同格式
  console.log(`✅ ids.json 新增：${Object.entries(added).map(([t, n]) => `${t} ${n}`).join("、") || "無"}`);
} else if (cmd) {
  console.error(`不認得的指令：${cmd}（pack｜merge）`);
  process.exit(1);
}
