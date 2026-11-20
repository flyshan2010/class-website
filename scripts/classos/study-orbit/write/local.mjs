/**
 * 自學星圖題本寫入｜本機端（老師的 Mac／Windows 都可，只需 node＋python3＋gh 已登入，不需任何祕密）
 *
 * 用法（在 class-website/ 底下）：
 *   node scripts/classos/study-orbit/write/local.mjs pack --levels c-h-4a-7,c-h-4a-8 --cards content_國L7.py,content_國L8.py --structure c-h-4a
 *       讀 自學星圖_P1試點/ 的 bundle.json、ids.json、gen.py＋cards.py 輸出 → 加密 → 強制推到 so-payload 分支（只有一個 commit，不留歷史）
 *       --no-push：只產 payload.bin 到 --out（測試用）
 *   node scripts/classos/study-orbit/write/local.mjs merge <ids-new.json>
 *       把 workflow artifact 的新 id 併回 ids.json（同鍵不同 id＝衝突，整批不寫）
 *   node scripts/classos/study-orbit/write/local.mjs keygen
 *       產新金鑰：私鑰直接經 stdin 交給 gh secret set SO_PAYLOAD_KEY（不落地），公鑰寫進 so-payload.pub.pem
 * 選項：--dir 換題本資料夾（預設 ../ClassOS_v3.5_藍圖/自學星圖_P1試點）
 */
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seal, fingerprint } from "./seal.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const PUB = path.join(HERE, "so-payload.pub.pem");
const GH_REPO = "flyshan2010/class-website";
const BRANCH = "so-payload";

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
  const noPush = flag("no-push");
  const out = opt("out", path.join(mkdtempSync(path.join(tmpdir(), "so-pack-")), "payload.bin"));
  if (!levels.length) throw new Error("--levels 必填（不給範圍會把舊批沒記 id 的子題重建一次）");
  let cards = [];
  if (cardFiles.length) {
    const r = spawnSync("python3", ["cards.py", ...cardFiles], { cwd: DIR, encoding: "utf8", maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`cards.py 失敗：${r.stderr}`);
    cards = JSON.parse(r.stdout.split("\n")[0]);
  }
  const read = (f) => readFileSync(path.join(DIR, f), "utf8");
  let commit = "?", dirty = false;
  try { commit = git(["rev-parse", "--short", "HEAD"], undefined, DIR); dirty = !!git(["status", "--porcelain", "--", "."], undefined, DIR); } catch { /* 不是 git 也能封 */ }
  const payload = { version: 1, createdAt: new Date().toISOString(), source: { commit, dirty }, levels, structure, cards,
    ids: JSON.parse(read("ids.json")), bundle: JSON.parse(read("bundle.json")), genPy: read("gen.py") };
  const plain = Buffer.from(JSON.stringify(payload));
  const fp = fingerprint(plain);
  const bin = seal(plain, readFileSync(PUB, "utf8"));
  writeFileSync(out, bin);
  console.log(`📦 指紋 ${fp}｜明文 ${(plain.length / 1024).toFixed(0)}KB → 密文 ${(bin.length / 1024).toFixed(0)}KB｜卡片 ${cards.length} 張｜來源 ${commit}${dirty ? "（⚠️ 題本資料夾有未 commit 改動）" : ""}`);
  if (noPush) { console.log(`（--no-push）payload：${out}`); process.exit(0); }
  const blob = git(["hash-object", "-w", out]);
  const tree = git(["mktree"], `100644 blob ${blob}\tpayload.bin\n`);
  const c = git(["commit-tree", tree, "-m", `so-payload ${fp}（加密資料包，勿合併進 main）`]);
  git(["push", "--force", "origin", `${c}:refs/heads/${BRANCH}`]);
  console.log(`⬆️ 已推到 ${BRANCH}（${c.slice(0, 7)}）。接著：`);
  console.log(`   gh workflow run so-write.yml --ref main -f mode=dry-run`);
  console.log(`   筆數無誤 → gh workflow run so-write.yml --ref main -f mode=execute -f fingerprint=${fp}`);
} else if (cmd === "merge") {
  const file = argv[0];
  if (!file) throw new Error("用法：merge <ids-new.json>");
  const idsPath = path.join(DIR, "ids.json");
  const ids = JSON.parse(readFileSync(idsPath, "utf8"));
  const { conflicts, added } = mergeIds(ids, JSON.parse(readFileSync(file, "utf8")));
  if (conflicts.length) { console.error(`❌ 衝突 ${conflicts.length} 筆，ids.json 未寫入：${conflicts.slice(0, 20).join("、")}`); process.exit(1); }
  writeFileSync(idsPath, JSON.stringify(ids, null, 1)); // 與 python json.dump(indent=1, ensure_ascii=False) 同格式
  console.log(`✅ ids.json 新增：${Object.entries(added).map(([t, n]) => `${t} ${n}`).join("、") || "無"}`);
} else if (cmd === "keygen") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  execFileSync("gh", ["secret", "set", "SO_PAYLOAD_KEY", "-R", GH_REPO], { input: privateKey, stdio: ["pipe", "inherit", "inherit"] });
  writeFileSync(PUB, publicKey);
  console.log(`🔑 私鑰已設為 ${GH_REPO} 的 Secret SO_PAYLOAD_KEY（未落地）；公鑰寫入 ${path.relative(REPO, PUB)}，記得 commit`);
} else if (cmd) {
  console.error(`不認得的指令：${cmd}（pack｜merge｜keygen）`);
  process.exit(1);
}
