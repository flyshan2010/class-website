// 執行：node scripts/build-so-proxy.mjs          → 把 rules.mjs、classview.mjs 寫進代理 .gs 的標記區塊
//       node scripts/build-so-proxy.mjs --check  → 只比對，不一致就失敗（測試用）
// 自學星圖規則一支三用（P2 SPEC §8、U83）：正本 scripts/classos/study-orbit/rules.mjs，
// 代理不准手改規則；改規則只改正本，再跑本腳本。Apps Script 不支援 import/export，這裡去掉 export 後原樣貼入。
import { readFileSync, writeFileSync } from "node:fs";

const GS = new URL("./apps-script-proxy-v2.gs", import.meta.url);
// 一支三用的正本（依序貼進代理各自的標記區塊）：rules.mjs（v2.21 起）、classview.mjs（v2.27 起，只准 import rules.mjs）
const SRCS = [
  { name: "rules.mjs", url: new URL("./classos/study-orbit/rules.mjs", import.meta.url), imports: [] },
  { name: "classview.mjs", url: new URL("./classos/study-orbit/classview.mjs", import.meta.url), imports: ["./rules.mjs"] },
];
const BEGIN = (n) => `// ===== BEGIN ${n}（自動產生）=====`;
const END = (n) => `// ===== END ${n}（自動產生）=====`;

export function srcBlock(name, src, imports = []) {
  const kept = src.replace(/^import\s+\{[^}]*\}\s+from\s+"([^"]+)";\s*$/gm, (line, from) => {
    if (!imports.includes(from)) throw new Error(`${name} 不可以 import ${from}（代理沒有模組）`);
    return "";
  });
  const body = kept.replace(/^export\s+/gm, "").trimEnd();
  if (/^\s*import\s/m.test(body)) throw new Error(`${name} 不可以 import 其他檔（代理沒有模組）`);
  return `${BEGIN(name)}\n// 來源：scripts/classos/study-orbit/${name}（自動複製，勿手改；改正本後跑 node scripts/build-so-proxy.mjs）\n${body}\n${END(name)}`;
}
export function rulesBlock(src = readFileSync(SRCS[0].url, "utf8")) { return srcBlock("rules.mjs", src); }

const names = (code) => [...code.matchAll(/^(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);

/** 回 {out:新 .gs, blocks:[{name, current, block}]}；任一區塊找不到或撞名就丟錯 */
export function build(gs = readFileSync(GS, "utf8")) {
  let out = gs;
  const blocks = SRCS.map((s) => ({ name: s.name, block: srcBlock(s.name, readFileSync(s.url, "utf8"), s.imports) }));
  for (const b of blocks) {
    const i = out.indexOf(BEGIN(b.name)), j = out.indexOf(END(b.name));
    if (i < 0 || j < i) throw new Error(`代理 .gs 找不到 ${b.name} 標記區塊`);
    b.current = out.slice(i, j + END(b.name).length);
    out = out.slice(0, i) + b.block + out.slice(j + END(b.name).length);
  }
  let rest = out;
  for (const b of blocks) rest = rest.replace(b.block, "");
  const all = blocks.flatMap((b) => names(b.block));
  const dup = all.filter((n, k) => all.indexOf(n) !== k);
  const clash = all.filter((n) => names(rest).includes(n)).concat(dup);
  if (clash.length) throw new Error("自動產生區塊與代理撞名：" + [...new Set(clash)].join("、"));
  const r = blocks[0];
  return { out, blocks, current: r.current, block: r.block }; // current／block＝rules 區塊（舊測試沿用）
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { // 路徑含中文，要用 pathToFileURL 比
  const { out, blocks } = build();
  if (process.argv.includes("--check")) {
    const bad = blocks.filter((b) => b.current !== b.block).map((b) => b.name);
    if (bad.length) { console.error(`❌ 代理 .gs 的 ${bad.join("、")} 區塊與正本不一致，請跑 node scripts/build-so-proxy.mjs`); process.exit(1); }
    console.log("✅ 代理自動產生區塊與正本一致（" + blocks.map((b) => b.name).join("、") + "）");
  } else { writeFileSync(GS, out); console.log("✅ 已寫入代理區塊（" + blocks.map((b) => b.name).join("、") + "）"); }
}
