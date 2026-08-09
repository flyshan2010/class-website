/**
 * ClassOS 系統健檢（唯讀，零相依，Node 18+）
 * 用法：node scripts/health-check.mjs            （全部檢查）
 *       node scripts/health-check.mjs --local    （跳過連線檢查，離線可跑）
 *
 * 設計原則（2026-08-10 首次全系統健檢的教訓，詳見 RUNBOOK_系統健檢.md §1）：
 * 這支腳本**只做零誤報的機器判定**。那場健檢跑出 4 個真問題、卻連帶製造了 16 次誤報，
 * 結論是：一份每週寄來、裡面混著假警報的報告，三週後就沒有人會看。所以
 *   ① 判不準的檢查一律不寫進來（廢掉哪些、為什麼，記在 health-check.config.json 的「_不做的檢查」）
 *   ② 誤報一次就往 config 加一條白名單，不改判準本身
 *   ③ 需要判斷力的（說明能不能合併、小字要不要放大、空分頁要不要隱藏）不歸這裡管，
 *      那些是 Claude 帶著老師做的季度工作，不是排程做得了的事
 *
 * 全綠時只印一行。有異常才印細節並以 exit 1 收場（給 CI 標紅用）。
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const OFFLINE = process.argv.includes("--local");
const cfg = JSON.parse(await readFile(path.join(ROOT, "scripts/health-check.config.json"), "utf8"));

const findings = [];   // { level: "red"|"warn", area, msg, hint }
const passed = [];
const skipped = [];
const red = (area, msg, hint) => findings.push({ level: "red", area, msg, hint });
const warn = (area, msg, hint) => findings.push({ level: "warn", area, msg, hint });
const ok = msg => passed.push(msg);

const readJSON = async (f, fallback = null) => {
  try { return JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8")); }
  catch { return fallback; }
};
const mtime = async p => { try { return (await stat(p)).mtimeMs; } catch { return null; } };

// ── A1 線上頁面全部回得了 200 ────────────────────────────────────────────
// 班網是家長與學生的對外窗口，任何一頁 404 都是「他們點進來看到錯誤畫面」。
async function checkPagesLive() {
  if (OFFLINE) { skipped.push("A1 線上頁面（--local）"); return; }
  const files = (await readdir(ROOT)).filter(f => f.endsWith(".html")).sort();
  const bad = [];
  await Promise.all(files.map(async f => {
    try {
      const res = await fetch(`${cfg.site}/${f}`, { method: "GET", signal: AbortSignal.timeout(20000) });
      if (!res.ok) bad.push(`${f} → HTTP ${res.status}`);
    } catch (e) { bad.push(`${f} → ${String(e).slice(0, 40)}`); }
  }));
  if (bad.length) red("前台", `${bad.length} 個分頁沒回 200：${bad.join("、")}`, "先看 GitHub Actions 的 pages build 有沒有失敗");
  else ok(`線上 ${files.length} 頁全部 200`);
}

// ── A2 同步有沒有斷 ─────────────────────────────────────────────────────
// 同步斷掉不會有任何人通知你，班網就停在舊資料上——聯絡簿一直是前天的功課。
async function checkSyncFresh() {
  const s = await readJSON("synced-at.json");
  if (!s?.at) { red("後台", "data/synced-at.json 讀不到或沒有 at 欄位", "sync-notion.mjs 收尾沒跑完"); return; }
  const hours = (Date.now() - new Date(s.at).getTime()) / 36e5;
  if (hours > cfg.syncMaxAgeHours)
    red("後台", `距離上次同步已 ${hours.toFixed(1)} 小時（門檻 ${cfg.syncMaxAgeHours}）`,
      "到 GitHub Actions 看「同步 Notion 資料到班網」最近一次是成功還是失敗");
  else ok(`同步新鮮度 ${hours.toFixed(1)} 小時內`);
}

// ── A3 空分頁有沒有乖乖收起來 ────────────────────────────────────────────
// sync-notion.mjs 收尾會依實際資料維護 nav 的 autoHidden；這裡是防它壞掉的哨兵：
// 資料全空卻還掛在導覽列 = 家長點進去只看到一句「還沒有…」。
async function checkEmptyPagesHidden() {
  const site = await readJSON("site-config.json");
  if (!site?.nav) { red("前台", "data/site-config.json 讀不到 nav", null); return; }
  const problems = [];
  for (const [id, sources] of Object.entries(cfg.emptyDataPages)) {
    const counts = await Promise.all(sources.map(async f => (await readJSON(f, []))?.length ?? 0));
    const isEmpty = counts.every(n => n === 0);
    const nav = site.nav.find(n => n.id === id);
    if (!nav) continue;
    const hidden = Boolean(nav.hidden || nav.autoHidden);
    if (isEmpty && !hidden) problems.push(`${nav.icon} ${nav.label}（無內容卻仍在導覽列）`);
    if (!isEmpty && nav.autoHidden) problems.push(`${nav.icon} ${nav.label}（已有內容卻仍被自動收起）`);
  }
  if (problems.length) warn("前台", `空分頁狀態與資料對不上：${problems.join("；")}`,
    "跑一次同步即會自動修正（applyAutoHiddenNav）；若沒修正代表該函式壞了");
  else ok("空分頁自動收起狀態正確");
}

// ── A4 頁面引用的本地檔案存不存在 ────────────────────────────────────────
// 改檔名忘了改引用，畫面上就是「某一區整塊不見了」而沒有任何錯誤訊息。
async function checkLocalAssets() {
  const files = (await readdir(ROOT)).filter(f => f.endsWith(".html"));
  const missing = new Set();
  for (const f of files) {
    const html = await readFile(path.join(ROOT, f), "utf8");
    for (const m of html.matchAll(/(?:src|href)="(?!https?:|\/\/|#|mailto:)([^"?#]+)/g)) {
      const rel = m[1];
      if (!/\.(js|css|json|png|jpg|svg|webp)$/i.test(rel)) continue;
      if (await mtime(path.join(ROOT, rel)) === null) missing.add(`${f} → ${rel}`);
    }
  }
  if (missing.size) red("前台", `${missing.size} 個引用指向不存在的檔案：${[...missing].join("、")}`, "改檔名時漏改引用");
  else ok("頁面引用的本地檔案都在");
}

// ── C1 藍圖總覽有沒有落後同層文件 ────────────────────────────────────────
// 藍圖是「單一事實來源」，它落後就等於新來的人（或換一台電腦的 AI）照著舊事實施工。
async function checkBlueprintDrift() {
  const dir = path.join(ROOT, cfg.blueprintDir);
  const readme = path.join(dir, cfg.blueprintIndexFile);
  const readmeAt = await mtime(readme);
  if (readmeAt === null) { skipped.push("C1 藍圖漂移（讀不到藍圖資料夾，可能是 Drive 未同步）"); return; }
  const eol = new Set(cfg.eolDocs.map(p => path.basename(p)));
  const newer = [];
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".md") || f === cfg.blueprintIndexFile || eol.has(f)) continue;
    const at = await mtime(path.join(dir, f));
    if (at > readmeAt) newer.push(`${f}（${new Date(at).toISOString().slice(0, 10)}）`);
  }
  if (newer.length) red("藍圖",
    `README 停在 ${new Date(readmeAt).toISOString().slice(0, 10)}，但 ${newer.length} 個檔案更新：${newer.join("、")}`,
    "在 README 版本紀錄補一則，並更新檔頭的版本與最後更新日期");
  else ok("藍圖 README 沒有落後同層文件");
}

// ── C2 藍圖索引表有沒有漏列檔案 ─────────────────────────────────────────
async function checkBlueprintIndex() {
  const dir = path.join(ROOT, cfg.blueprintDir);
  const readme = await readFile(path.join(dir, cfg.blueprintIndexFile), "utf8").catch(() => null);
  if (readme === null) { skipped.push("C2 藍圖索引（讀不到藍圖資料夾）"); return; }
  const listed = new Set([...readme.matchAll(/\[([^\]]+\.md)\]/g)].map(m => path.basename(m[1])));
  const exempt = new Set(cfg.blueprintIndexExempt);
  const actual = (await readdir(dir)).filter(f => f.endsWith(".md") && !exempt.has(f));
  const orphan = actual.filter(f => !listed.has(f));
  if (orphan.length) warn("藍圖", `${orphan.length} 個檔案沒出現在索引表：${orphan.join("、")}`,
    "在 README「檔案索引」補一列，否則等於這份規則不存在");
  else ok("藍圖索引表與實際檔案一致");
}

// ── C3 第五同步有沒有欠 ─────────────────────────────────────────────────
// 改了登記簿卻沒改雲端 routine 的 prompt，排程就會照舊規則跑——而且不會有人發現。
async function checkFifthSync() {
  const dir = path.join(ROOT, cfg.blueprintDir);
  const problems = [];
  for (const [target, sources] of Object.entries(cfg.fifthSyncNewerThan)) {
    const tAt = await mtime(path.join(dir, target));
    if (tAt === null) { skipped.push(`C3 第五同步（讀不到 ${target}）`); return; }
    for (const s of sources) {
      const sAt = await mtime(path.join(dir, s));
      if (sAt !== null && sAt > tAt)
        problems.push(`${s}（${new Date(sAt).toISOString().slice(0, 10)}）比 ${target}（${new Date(tAt).toISOString().slice(0, 10)}）新`);
    }
  }
  if (problems.length) red("藍圖", `第五同步可能沒做：${problems.join("；")}`,
    "改 07 檔並用 RemoteTrigger 更新雲端 routine 的 prompt（作法見 07 檔頭）");
  else ok("第五同步順序正確");
}

// ── C4 同一件事寫在兩個檔案、只改了一個 ─────────────────────────────────
// 只掃「現況」段落：版本紀錄與裁示紀錄寫的是當時的事實，改掉那些是竄改歷史。
const currentSectionOnly = text => {
  let end = text.length;
  for (const h of cfg.historySections ?? []) {
    const i = text.indexOf(`\n${h}`);
    if (i !== -1 && i < end) end = i;
  }
  return text.slice(0, end);
};

async function checkCrossFile() {
  const dir = path.join(ROOT, cfg.blueprintDir);
  for (const rule of cfg.crossFileConsistency ?? []) {
    const hits = [];
    for (const f of rule.檔案) {
      const raw = await readFile(path.join(dir, f), "utf8").catch(() => null);
      if (raw === null) continue;
      const text = currentSectionOnly(raw);
      for (const bad of rule.禁止字串) if (text.includes(bad)) hits.push(`${f} 仍寫著「${bad}」`);
    }
    if (hits.length) red("藍圖", `${rule.名稱}：${hits.join("；")}`, rule.說明);
    else ok(`跨檔一致性：${rule.名稱}`);
  }
}

// ── 執行與輸出 ──────────────────────────────────────────────────────────
await checkPagesLive();
await checkSyncFresh();
await checkEmptyPagesHidden();
await checkLocalAssets();
await checkBlueprintDrift();
await checkBlueprintIndex();
await checkFifthSync();
await checkCrossFile();

const reds = findings.filter(f => f.level === "red");
const warns = findings.filter(f => f.level === "warn");
const stamp = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });

if (!findings.length) {
  console.log(`✅ ClassOS 健檢全綠（${passed.length} 項通過${skipped.length ? `，${skipped.length} 項略過` : ""}）｜${stamp}`);
  if (skipped.length) console.log(`   略過：${skipped.join("、")}`);
} else {
  console.log(`\n🩺 ClassOS 健檢｜${stamp}`);
  console.log(`   ${reds.length} 紅　${warns.length} 黃　${passed.length} 綠${skipped.length ? `　${skipped.length} 略過` : ""}\n`);
  for (const f of findings) {
    console.log(`${f.level === "red" ? "❌" : "⚠️ "} [${f.area}] ${f.msg}`);
    if (f.hint) console.log(`     → ${f.hint}`);
  }
  console.log("");
  if (passed.length) console.log(`✅ 通過：${passed.join("、")}`);
  if (skipped.length) console.log(`⏭️  略過：${skipped.join("、")}`);
  console.log("\n⚠️ 誤報是白名單的問題，不是判準的問題——確認某條是誤報就往 scripts/health-check.config.json 加一行，別把檢查關掉。");
}

// 需要判斷力的部分不歸腳本管，提醒 Claude 接手（季度健檢才做，見 RUNBOOK_系統健檢 §3）
console.log("\n🧑 需人判斷、腳本不做的：Notion 說明數字核對／說明能否合併／手機小字／空分頁去留／雲端 routine 狀態");

process.exit(reds.length ? 1 : 0);
