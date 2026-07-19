/**
 * 班級工作台匯出檔 → class-log 回流清單（零相依，Node 18+）
 *
 * 為什麼是這條路：工作台（CLASSROOM HUB，crimson-wind-7a22.changsheng0612.workers.dev）
 * 的資料放在 Firebase 專案 `classhubgame`，但**該專案屬工作台作者「方方老師」所有**，
 * 老師的資料只是掛在 `users/{uid}/` 底下。直讀他人 Firebase 會牴觸 AGENTS.md 鐵則 7
 * （憑證不進本資料夾）、消耗作者頻寬、並有條款風險，故改走工作台內建「匯出本機資料」。
 *
 * 本腳本只做「解析＋出清單」，**不寫 Notion**：
 * 產出的一句話清單交給 skill class-log 入庫，維持單一寫入口徑（金幣／程度規則只維護一份）。
 *
 * 增量安全：工作台的 student.score 是**累計值**，重跑會重複計算，故一律不採用；
 * 只取有穩定事件鍵的三種來源（代幣流水 / 出勤 / 作業），以事件鍵去重。
 *
 * 用法：
 *   node scripts/parse-workbench-export.mjs <匯出檔.json>              # 產生待審清單
 *   node scripts/parse-workbench-export.mjs <匯出檔.json> --class C123 # 指定班級
 *   node scripts/parse-workbench-export.mjs --commit                   # class-log 寫入後才標記已處理
 *
 * 把關：批次變動停「待審」——本腳本產出 pending 批次檔，老師確認、class-log 實際寫入後，
 * 再跑 --commit 才會更新已處理狀態。中途放棄不會讓事件被永久跳過。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_PATH = path.join(ROOT, "..", "名冊對照表.json");        // 班級事務/名冊對照表.json
const STATE_DIR = path.join(ROOT, "data", "workbench");
const STATE_PATH = path.join(STATE_DIR, "processed.json");        // 已回流的事件鍵
const PENDING_PATH = path.join(STATE_DIR, "pending.json");        // 待審批次

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const classFlagIdx = args.indexOf("--class");
const WANT_CLASS = classFlagIdx >= 0 ? args[classFlagIdx + 1] : null;
const INPUT = args.find((a) => !a.startsWith("--") && a !== WANT_CLASS);

/** 出勤狀態 → 是否值得回流（正常出席不記錄，避免洗版） */
const ATTENDANCE_LOG = { late: "遲到", absent: "缺席", leave: "請假" };
/** 作業狀態 → 是否值得回流（已完成不記錄） */
const HOMEWORK_LOG = { needs_correction: "待訂正", pending: "未繳交" };

async function readJson(p) {
  return JSON.parse(await readFile(p, "utf8"));
}

async function loadState() {
  if (!existsSync(STATE_PATH)) return { 已處理事件: [] };
  return readJson(STATE_PATH);
}

/**
 * 建立「工作台學生 → 座號」對應。
 * 以名冊對照表的姓名為準（權威來源）；對不到的一律標記需人工，絕不猜測。
 */
function buildSeatResolver(roster) {
  const nameToSeat = new Map();
  for (const [seat, info] of Object.entries(roster.學生)) {
    nameToSeat.set(String(info.姓名).trim(), seat);
  }
  return (student) => {
    const byName = nameToSeat.get(String(student.name || "").trim());
    if (byName) return { seat: byName, 依據: "姓名" };
    // 備援：工作台 student.id 若剛好是名冊內的座號，仍需人工確認才採用
    const id = String(student.id || "").trim();
    if (/^\d+$/.test(id) && roster.學生[id]) {
      return { seat: id, 依據: "id推測", 需確認: true };
    }
    return { seat: null, 依據: "無法對應" };
  };
}

/** 從一個班級抽出所有可回流事件（帶穩定去重鍵） */
function extractEvents(cls, resolveSeat) {
  const events = [];
  const unresolved = [];
  const studentsById = new Map();

  for (const s of cls.students || []) {
    const r = resolveSeat(s);
    studentsById.set(String(s.id), r);
    if (!r.seat) {
      // 只記 id，不外流姓名
      unresolved.push({ 工作台id: String(s.id), 原因: r.依據 });
      continue;
    }

    // ── 代幣流水：唯一有 id 的事件流，最適合增量回流 ──
    for (const entry of s.tokenLedger || []) {
      if (!entry || entry.delta == null) continue;
      const key = `tok:${cls.id}:${entry.id}`;
      const delta = Number(entry.delta);
      if (!Number.isFinite(delta) || delta === 0) continue;
      events.push({
        鍵: key,
        座號: r.seat,
        來源: "代幣",
        日期: entry.at ? String(entry.at).slice(0, 10) : null,
        事由: String(entry.reason || "").trim() || "（工作台未填事由）",
        正負向: delta > 0 ? "讚賞" : "糾正",
        工作台幣值: delta,
        需確認: r.需確認 || false,
      });
    }
  }

  // ── 出勤：以 日期＋學生 為鍵 ──
  for (const [dateKey, byStudent] of Object.entries(cls.attendanceByDate || {})) {
    for (const [sid, rec] of Object.entries(byStudent || {})) {
      const label = ATTENDANCE_LOG[rec?.status];
      if (!label) continue;
      const r = studentsById.get(String(sid));
      if (!r?.seat) continue;
      events.push({
        鍵: `att:${cls.id}:${dateKey}:${sid}`,
        座號: r.seat,
        來源: "出勤",
        日期: dateKey,
        事由: rec.note ? `${label}（${rec.note}）` : label,
        正負向: "中性",
        工作台幣值: null,
        需確認: r.需確認 || false,
      });
    }
  }

  // ── 作業：以 作業＋學生 為鍵 ──
  for (const hw of cls.homeworks || []) {
    for (const st of hw.studentStatus || []) {
      const label = HOMEWORK_LOG[st?.status];
      if (!label) continue;
      const r = studentsById.get(String(st.id));
      if (!r?.seat) continue;
      events.push({
        鍵: `hw:${cls.id}:${hw.id}:${st.id}`,
        座號: r.seat,
        來源: "作業",
        日期: hw.date ? String(hw.date).slice(0, 10) : null,
        事由: `${hw.title || "作業"} ${label}`,
        正負向: "中性",
        工作台幣值: null,
        需確認: r.需確認 || false,
      });
    }
  }

  return { events, unresolved };
}

/**
 * 產生給 class-log 的一句話。
 * 程度刻意不由工作台幣值換算——兩套幣制不同，硬換算會失真；
 * 一律附原始幣值供老師在待審階段裁定，未裁定則走 class-log 預設（程度 1）。
 */
function toSentence(ev) {
  const 日期 = ev.日期 ? `${ev.日期} ` : "";
  if (ev.正負向 === "中性") return `${日期}座號${ev.座號} ${ev.事由}`;
  const 符號 = ev.正負向 === "讚賞" ? "+" : "-";
  return `${日期}座號${ev.座號} ${ev.事由} ${符號}1`;
}

async function main() {
  const roster = await readJson(MAP_PATH);
  const state = await loadState();
  const processed = new Set(state.已處理事件 || []);

  if (COMMIT) {
    if (!existsSync(PENDING_PATH)) {
      console.error("找不到待審批次（data/workbench/pending.json）；請先跑一次解析。");
      process.exit(1);
    }
    const pending = await readJson(PENDING_PATH);
    for (const ev of pending.事件 || []) processed.add(ev.鍵);
    await writeFile(
      STATE_PATH,
      JSON.stringify({ _說明: "已回流至紀錄庫的工作台事件鍵，用於增量去重。", 更新時間: pending.產生時間, 已處理事件: [...processed] }, null, 2),
      "utf8"
    );
    console.log(`✅ 已標記 ${pending.事件.length} 筆為已處理（累計 ${processed.size} 筆）。`);
    return;
  }

  if (!INPUT) {
    console.error("用法：node scripts/parse-workbench-export.mjs <工作台匯出檔.json> [--class <班級id>]");
    process.exit(1);
  }

  const dump = await readJson(INPUT);
  const classes = dump.classes || [];
  if (!classes.length) {
    console.error("匯出檔中沒有 classes；請確認這是工作台「匯出本機資料」產生的檔案。");
    process.exit(1);
  }

  const targetId = WANT_CLASS || dump.currentClassId || classes[0].id;
  const cls = classes.find((c) => c.id === targetId) || classes[0];
  const resolveSeat = buildSeatResolver(roster);
  const { events, unresolved } = extractEvents(cls, resolveSeat);

  const fresh = events.filter((e) => !processed.has(e.鍵));
  fresh.sort((a, b) => (a.日期 || "").localeCompare(b.日期 || "") || Number(a.座號) - Number(b.座號));

  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    PENDING_PATH,
    JSON.stringify({ _說明: "待審回流批次；老師確認並由 class-log 寫入後，再跑 --commit。", 班級: cls.name, 產生時間: new Date().toISOString(), 事件: fresh }, null, 2),
    "utf8"
  );

  // ── 待審預覽（只出座號，不出姓名）──
  console.log(`\n📋 工作台回流待審清單｜班級「${cls.name}」`);
  console.log(`   全部事件 ${events.length} 筆，其中新增 ${fresh.length} 筆（已回流 ${events.length - fresh.length} 筆自動略過）\n`);

  const bySource = fresh.reduce((acc, e) => ((acc[e.來源] = (acc[e.來源] || 0) + 1), acc), {});
  console.log(`   來源分布：${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join("／") || "（無）"}\n`);

  for (const ev of fresh) {
    const 註 = ev.工作台幣值 != null ? `   〔工作台代幣 ${ev.工作台幣值 > 0 ? "+" : ""}${ev.工作台幣值}〕` : "";
    const 旗 = ev.需確認 ? " ⚠️需確認座號" : "";
    console.log(`   ${toSentence(ev)}${註}${旗}`);
  }

  if (unresolved.length) {
    console.log(`\n⚠️ 需人工：${unresolved.length} 位工作台學生對不到名冊（工作台 id：${unresolved.map((u) => u.工作台id).join("、")}）`);
    console.log("   請確認名冊對照表姓名是否與工作台一致，或該生是否已轉出。");
  }

  console.log(`\n下一步：確認上列無誤 → 交給 class-log 入庫 → 回頭跑 \`--commit\` 標記已處理。`);
  console.log(`待審批次檔：${path.relative(process.cwd(), PENDING_PATH)}\n`);
}

main().catch((err) => {
  console.error("解析失敗：", err.message);
  process.exit(1);
});
