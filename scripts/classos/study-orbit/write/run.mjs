/**
 * 自學星圖題本寫入｜GitHub Actions 入口（.github/workflows/so-write.yml 呼叫）
 *
 * 環境變數：PAYLOAD（so-payload 分支的 payload.bin 路徑）、SO_PAYLOAD_KEY（私鑰，Secret）、NOTION_TOKEN（Secret）、
 *   MODE（dry-run｜execute，預設 dry-run）、FINGERPRINT（execute 必填，＝dry-run 印出的資料包指紋）、OUT_DIR（預設 out/so-write）
 * 產出：OUT_DIR/ids-new.json（本次新建＋補記的 id，本機 local.mjs merge 併回 ids.json）、OUT_DIR/summary.json
 * 公開 log 只印筆數與代碼，不印題目內容（本 repo 公開）。
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { api, isExecute } from "../../lib/notion.mjs";
import { unseal, fingerprint } from "./seal.mjs";
import { runWrite } from "./writer.mjs";

const execute = isExecute();
const outDir = process.env.OUT_DIR || "out/so-write";
mkdirSync(outDir, { recursive: true });
const newIds = {};
let result = null;
let failed = null;

try {
  const key = process.env.SO_PAYLOAD_KEY;
  if (!key) throw new Error("缺少 SO_PAYLOAD_KEY（GitHub Secret）");
  const plain = unseal(readFileSync(process.env.PAYLOAD), key);
  const fp = fingerprint(plain);
  const payload = JSON.parse(plain.toString("utf8"));
  console.log(`📦 資料包指紋 ${fp}｜封裝 ${payload.createdAt}｜來源 ${payload.source?.commit ?? "?"}${payload.source?.dirty ? "（有未 commit 改動）" : ""}`);
  console.log(`   關卡範圍 ${payload.levels.join(",")}｜卡片 ${payload.cards?.length ?? 0} 張｜結構 ${(payload.structure ?? []).join(",") || "無"}｜模式 ${execute ? "execute" : "dry-run"}`);
  if (execute && (process.env.FINGERPRINT ?? "").trim() !== fp) {
    throw new Error(`execute 必須填這個資料包的指紋 ${fp}（先跑 dry-run 確認筆數）；實際填的是「${process.env.FINGERPRINT ?? ""}」`);
  }

  // gen.py 正本隨資料包帶來，在暫存資料夾原樣執行（欄位對應不另寫一套）
  const work = mkdtempSync(path.join(tmpdir(), "so-write-"));
  writeFileSync(path.join(work, "gen.py"), payload.genPy);
  writeFileSync(path.join(work, "bundle.json"), JSON.stringify(payload.bundle));
  const gen = (what, ids, code) => {
    writeFileSync(path.join(work, "ids.json"), JSON.stringify(ids));
    const r = spawnSync("python3", ["gen.py", what, "--levels", code ?? payload.levels.join(",")], { cwd: work, encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`gen.py ${what} 失敗：${(r.stderr || "").slice(0, 300)}`);
    return JSON.parse(r.stdout.split("\n")[0]);
  };

  result = await runWrite({ payload, ids: payload.ids, gen, api, execute, newIds });
  result.fingerprint = fp;
  if (!execute) console.log(`\n👉 筆數確認無誤後，以 mode=execute、fingerprint=${fp} 再跑一次。`);
} catch (e) {
  failed = e.message;
  console.error(`❌ ${e.message}`);
} finally {
  writeFileSync(path.join(outDir, "ids-new.json"), JSON.stringify(execute ? newIds : {}, null, 1));
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ mode: execute ? "execute" : "dry-run", failed, ...result }, null, 1));
  const n = Object.values(newIds).reduce((a, t) => a + Object.keys(t).length, 0);
  if (execute) console.log(`🧾 ids-new.json：${n} 筆（含補記），下載 artifact 後在本機 local.mjs merge 併回 ids.json`);
}
if (failed) process.exit(1);
