// 執行：node scripts/build-so-proxy.mjs          → 把 rules.mjs 寫進代理 .gs 的標記區塊
//       node scripts/build-so-proxy.mjs --check  → 只比對，不一致就失敗（測試用）
// 自學星圖規則一支三用（P2 SPEC §8、U83）：正本 scripts/classos/study-orbit/rules.mjs，
// 代理不准手改規則；改規則只改正本，再跑本腳本。Apps Script 不支援 import/export，這裡去掉 export 後原樣貼入。
import { readFileSync, writeFileSync } from "node:fs";

const GS = new URL("./apps-script-proxy-v2.gs", import.meta.url);
const RULES = new URL("./classos/study-orbit/rules.mjs", import.meta.url);
const BEGIN = "// ===== BEGIN rules.mjs（自動產生）=====";
const END = "// ===== END rules.mjs（自動產生）=====";

export function rulesBlock(src = readFileSync(RULES, "utf8")) {
  const body = src.replace(/^export\s+/gm, "").trimEnd();
  if (/^\s*import\s/m.test(body)) throw new Error("rules.mjs 不可以 import 其他檔（代理沒有模組）");
  return `${BEGIN}\n// 來源：scripts/classos/study-orbit/rules.mjs（自動複製，勿手改；改正本後跑 node scripts/build-so-proxy.mjs）\n${body}\n${END}`;
}

const names = (code) => [...code.matchAll(/^(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);

export function build(gs = readFileSync(GS, "utf8")) {
  const i = gs.indexOf(BEGIN), j = gs.indexOf(END);
  if (i < 0 || j < i) throw new Error("代理 .gs 找不到 rules.mjs 標記區塊");
  const block = rulesBlock();
  const rest = gs.slice(0, i) + gs.slice(j + END.length);
  const clash = names(block).filter((n) => names(rest).includes(n));
  if (clash.length) throw new Error("rules.mjs 與代理撞名：" + clash.join("、"));
  return { out: gs.slice(0, i) + block + gs.slice(j + END.length), current: gs.slice(i, j + END.length), block };
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { // 路徑含中文，要用 pathToFileURL 比
  const { out, current, block } = build();
  if (process.argv.includes("--check")) {
    if (current !== block) { console.error("❌ 代理 .gs 的 rules 區塊與 rules.mjs 不一致，請跑 node scripts/build-so-proxy.mjs"); process.exit(1); }
    console.log("✅ 代理 rules 區塊與正本一致");
  } else { writeFileSync(GS, out); console.log("✅ 已寫入代理 rules 區塊"); }
}
