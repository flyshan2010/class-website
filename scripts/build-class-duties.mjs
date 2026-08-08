/**
 * 打掃／午餐／座位表 → 公開版 JSON 產生器（零相依，Node 18+）
 *
 * 為什麼要有這一層：class-website 整個 repo 都發布到 GitHub Pages，
 * `data/*.json` 任何人都下載得到。座號在班內等同完整識別資訊（鐵則 10：
 * 班網公開頁不得出現姓名／座號），所以**座號只存在 repo 外的原始資料檔**，
 * 本腳本負責把它換成遮罩姓名（陳○佑）後才寫進 data/。
 * → 公開的 data/duties.json、lunch.json、seating.json 一律不含座號。
 *
 * 輸入（皆在 班級事務/，不在 repo 內）：
 *   ../../班級工作分配_原始資料.json   分配正本（要改分配改這裡）
 *   ../../名冊對照表.json              座號 → 姓名
 * 輸出：
 *   data/duties.json  data/lunch.json  data/seating.json
 *
 * 用法：
 *   node scripts/build-class-duties.mjs          # 產生並寫入
 *   node scripts/build-class-duties.mjs --dry    # 只檢查、印摘要，不寫入
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { uniqueMaskNames } from "./lib/mask-name.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLASSDIR = path.join(ROOT, "..");                       // 班級事務/
const SRC = path.join(CLASSDIR, "班級工作分配_原始資料.json");
const ROSTER = path.join(CLASSDIR, "名冊對照表.json");
const DATA = path.join(ROOT, "data");
const DRY = process.argv.includes("--dry");

const src = JSON.parse(await readFile(SRC, "utf8"));
const roster = JSON.parse(await readFile(ROSTER, "utf8"))["學生"];

const seatCount = Object.keys(roster).length;
// 遮罩姓名一次算完整班，保證班內唯一（見 lib/mask-name.mjs 的撞名說明）
const maskMap = uniqueMaskNames(Object.values(roster).map(r => r["姓名"]));
const nameOf = seat => {
  const row = roster[String(seat)];
  if (!row) throw new Error(`名冊查無座號 ${seat}（原始資料與名冊對照表不一致，請先修正）`);
  return maskMap.get(String(row["姓名"]).trim());
};
const namesOf = seats => (seats || []).map(nameOf);

// ── 打掃 ──────────────────────────────────────────────
const duties = {
  _產生自: "scripts/build-class-duties.mjs（勿手改，改 班級事務/班級工作分配_原始資料.json）",
  時段: src.duties._時段,
  zones: src.duties.zones.map(z => ({
    zone: z.zone,
    emoji: z.emoji,
    headcount: z.headcount,
    groups: z.groups.map(g => ({
      group: g.group,
      members: namesOf(g.seats),
      support: g.support ? namesOf(g.support) : [],
      work: g.work,
      tools: g.tools,
    })),
  })),
  未分配: namesOf(src.duties._未分配座號),
  未分配說明: src.duties._未分配說明,
};

// ── 午餐 ──────────────────────────────────────────────
// 輪值池＝全班扣掉固定崗（午餐長、打飯班），依座號排序後每週取 5 人接續輪替。
const fixedSeats = new Set(src.lunch.fixed.flatMap(f => f.seats));
const poolSeats = Object.keys(roster).map(Number).sort((a, b) => a - b).filter(s => !fixedSeats.has(s));

const ROTATING_SLOTS = src.lunch.posts.flatMap(p =>
  p.headcount === 1 ? [p.post] : Array.from({ length: p.headcount }, (_, i) => `${p.post}（${i + 1}）`));
const PER_WEEK = ROTATING_SLOTS.length;

// 第 n 週（1-based）的值週生：從輪值池位移 (n-1)*PER_WEEK，循環取用
function weekAssign(week) {
  const offset = ((week - 1) * PER_WEEK) % poolSeats.length;
  return ROTATING_SLOTS.map((slot, i) => ({
    slot,
    name: nameOf(poolSeats[(offset + i) % poolSeats.length]),
  }));
}

// 完整輪替週數：位移每週 +PER_WEEK，要回到起點需 pool/gcd(pool, PER_WEEK) 週。
// 例：21 人每週 5 人 → gcd=1 → 21 週（每人剛好各值 5 次）。用 ceil(21/5)=5 是錯的，
// 第 5 週會繞回頭跟第 1 週的人重疊，有人值兩次、有人還沒輪到。
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const WEEKS = poolSeats.length / gcd(poolSeats.length, PER_WEEK);
const lunch = {
  _產生自: "scripts/build-class-duties.mjs（勿手改，改 班級事務/班級工作分配_原始資料.json）",
  規則: src.lunch._規則,
  posts: src.lunch.posts,
  fixed: src.lunch.fixed.map(f => ({
    post: f.post,
    headcount: f.headcount,
    members: namesOf(f.seats),
    isMock: !!f.seatsMock,
    work: f.work,
  })),
  輪值池人數: poolSeats.length,
  每週人數: PER_WEEK,
  完整輪替週數: WEEKS,
  每人每輪次數: (WEEKS * PER_WEEK) / poolSeats.length,
  rotation: Array.from({ length: WEEKS }, (_, i) => ({ week: i + 1, assign: weekAssign(i + 1) })),
};

// ── 座位表 ────────────────────────────────────────────
const seating = {
  _產生自: "scripts/build-class-duties.mjs（勿手改，改 班級事務/班級工作分配_原始資料.json）",
  說明: src.seating._說明,
  columns: src.seating.columns,
  grid: src.seating.grid.map(row => row.map(seat => (seat == null ? null : nameOf(seat)))),
};

// ── 檢查：全班每人都有著落，且沒有人名外洩座號 ──────────
const covered = new Set([
  ...src.duties.zones.flatMap(z => z.groups.flatMap(g => [...g.seats, ...(g.support || [])])),
  ...src.duties._未分配座號,
]);
const missing = Object.keys(roster).map(Number).filter(s => !covered.has(s));
if (missing.length) throw new Error(`有人沒被打掃分配涵蓋：座號 ${missing.join(", ")}`);

const seatingFlat = src.seating.grid.flat().filter(s => s != null);
if (seatingFlat.length !== seatCount) throw new Error(`座位表 ${seatingFlat.length} 人 ≠ 名冊 ${seatCount} 人`);
if (new Set(seatingFlat).size !== seatingFlat.length) throw new Error("座位表有重複座號");

const leak = JSON.stringify({ duties, lunch, seating }).match(/"座號"|\b座號\s*[:：]\s*\d/);
if (leak) throw new Error(`公開版 JSON 疑似含座號欄位：${leak[0]}`);

console.log(`打掃：${duties.zones.map(z => `${z.zone} ${z.groups.length} 組`).join("、")}｜未分配 ${duties.未分配.length} 人`);
console.log(`午餐：固定 ${lunch.fixed.reduce((s, f) => s + f.headcount, 0)} 人、輪值池 ${poolSeats.length} 人、每週 ${PER_WEEK} 人、${WEEKS} 週輪完一圈（每人各 ${lunch.每人每輪次數} 次）`);

// 公平性驗證：完整一輪後每人出場次數必須相同，否則輪值規則有 bug
const times = {};
for (const w of lunch.rotation) for (const a of w.assign) times[a.name] = (times[a.name] || 0) + 1;
const counts = [...new Set(Object.values(times))];
if (Object.keys(times).length !== poolSeats.length || counts.length !== 1)
  throw new Error(`輪值不公平：${Object.keys(times).length}/${poolSeats.length} 人出場，次數分布 ${counts.join("/")}`);
console.log(`座位：${src.seating.grid.length} 列 × ${src.seating.columns.length} 排、${seatingFlat.length} 人`);

if (DRY) { console.log("\n--dry：未寫入檔案"); process.exit(0); }
for (const [file, obj] of [["duties.json", duties], ["lunch.json", lunch], ["seating.json", seating]]) {
  await writeFile(path.join(DATA, file), JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log(`已寫入 data/${file}`);
}
