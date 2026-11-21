/**
 * 自學星圖題本寫入｜GitHub Actions 入口（私有 repo classos-private 的 .github/workflows/so-write.yml 呼叫）
 *
 * 環境變數：PAYLOAD（local.mjs pack 產的明文資料包路徑）、NOTION_TOKEN（私有 repo 的 Secret）、
 *   ACTION（write＝建頁，預設｜promote＝把該批待審改可用、卡片草稿改上架，見 promote.mjs）、
 *   MODE（dry-run｜execute，預設 dry-run）、FINGERPRINT（execute 必填，＝dry-run 印出的資料包指紋）、OUT_DIR（預設 out/so-write）
 * 產出：OUT_DIR/ids-new.json（本次新建＋補記的 id，本機 local.mjs merge 併回 ids.json）、OUT_DIR/summary.json
 * log 只印筆數與代碼，不印題目內容（log 在私有 repo，仍維持此原則）。
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { api, isExecute } from "../../lib/notion.mjs";
import { fingerprint } from "./fingerprint.mjs";
import { runWrite } from "./writer.mjs";
import { runPromote } from "./promote.mjs";

const execute = isExecute();
const action = (process.env.ACTION || "write").trim();
if (!["write", "promote"].includes(action)) throw new Error(`ACTION 只能是 write 或 promote，實際是「${action}」`);
const outDir = process.env.OUT_DIR || "out/so-write";
mkdirSync(outDir, { recursive: true });
const newIds = {};
let result = null;
let failed = null;

try {
  const plain = readFileSync(process.env.PAYLOAD);
  // promote 的指紋另算（混入動作名）：寫入的 dry-run 指紋不能拿來直接改狀態
  const fp = action === "promote" ? fingerprint(Buffer.concat([plain, Buffer.from("|promote")])) : fingerprint(plain);
  const payload = JSON.parse(plain.toString("utf8"));
  console.log(`📦 資料包指紋 ${fp}｜來源 ${payload.source?.commit ?? "?"}${payload.source?.dirty ? "（有未 commit 改動）" : ""}`);
  console.log(`   關卡範圍 ${payload.levels.join(",")}｜卡片 ${payload.cards?.length ?? 0} 張｜結構 ${(payload.structure ?? []).join(",") || "無"}｜動作 ${action}｜模式 ${execute ? "execute" : "dry-run"}`);
  if (execute && (process.env.FINGERPRINT ?? "").trim() !== fp) {
    throw new Error(`execute 必須填這個資料包的指紋 ${fp}（先跑 dry-run 確認筆數）；實際填的是「${process.env.FINGERPRINT ?? ""}」`);
  }

  // gen.py 正本隨資料包帶來，在暫存資料夾原樣執行（欄位對應不另寫一套）
  const work = mkdtempSync(path.join(tmpdir(), "so-write-"));
  writeFileSync(path.join(work, "gen.py"), payload.genPy);
  writeFileSync(path.join(work, "bundle.json"), JSON.stringify(payload.bundle));
  const gen = (what, ids, code, all = false) => {
    writeFileSync(path.join(work, "ids.json"), JSON.stringify(ids));
    const r = spawnSync("python3", ["gen.py", what, "--levels", code ?? payload.levels.join(","), ...(all ? ["--all"] : [])], { cwd: work, encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`gen.py ${what} 失敗：${(r.stderr || "").slice(0, 300)}`);
    return JSON.parse(r.stdout.split("\n")[0]);
  };

  result = action === "promote"
    ? await runPromote({ payload, ids: payload.ids, gen, api, execute })
    : await runWrite({ payload, ids: payload.ids, gen, api, execute, newIds });
  result.fingerprint = fp;
  if (!execute) console.log(`\n👉 筆數確認無誤後，以 action=${action}、mode=execute、fingerprint=${fp} 再跑一次。`);
} catch (e) {
  failed = e.message;
  console.error(`❌ ${e.message}`);
} finally {
  writeFileSync(path.join(outDir, "ids-new.json"), JSON.stringify(execute ? newIds : {}, null, 1));
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ action, mode: execute ? "execute" : "dry-run", failed, ...result }, null, 1));
  const n = Object.values(newIds).reduce((a, t) => a + Object.keys(t).length, 0);
  if (execute && action === "write") console.log(`🧾 ids-new.json：${n} 筆（含補記），下載 artifact 後在本機 local.mjs merge 併回 ids.json`);
}
if (failed) process.exit(1);
