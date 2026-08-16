/**
 * 打掃／午餐／座位表：Notion 列 → 班網公開版 JSON（純函式，無 I/O）
 *
 * 為什麼獨立成模組：這段轉換有兩個容易錯又看不出來的地方——**座號換遮罩姓名**
 * （錯了會把可識別資訊送上公開網頁）與**午餐輪值週期**（錯了會有人值兩次、
 * 有人整學期沒輪到）。抽成純函式才能離線用真實名冊驗證，不必連 Notion。
 * sync-notion.mjs 只負責查詢與寫檔。
 *
 * 輸入的 dutyRows／rosterRows 是 sync-notion.mjs 的 props() 結果（欄名→值）。
 */
import { uniqueMaskNames } from "./mask-name.mjs";

const ZONE_META = {
  "外掃區": { emoji: "🌳" },
  "內掃區": { emoji: "🏫" },
};
const SEAT_COLUMNS = ["六", "五", "四", "三", "二", "一"];

const splitList = s => String(s ?? "").split(/[、,，]/).map(x => x.trim()).filter(Boolean);
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// ISO 版四欄（2026-08-16 起）：職稱／要做的事／能管的事／做好的標準。
// 「升級徽章」刻意不帶出來——那是未來升級制度的內部欄位，班網不顯示。
const isoFields = r => ({
  title: r["職稱"] ?? "",
  work: r["要做的事"] ?? "",
  authority: r["能管的事"] ?? "",
  standard: r["做好的標準"] ?? "",
});

/**
 * @param {object[]} dutyRows  🧹 班級工作分配（已 props()，未過濾）
 * @param {object[]} rosterRows 👥 學生名冊（已 props()，未過濾）
 * @param {Record<string,string>} kv ⚙️ 網站設定的「項目→內容」
 * @returns {{duties:object, lunch:object, seating:object, warnings:string[]}}
 */
export function buildDutyData({ dutyRows, rosterRows, kv = {} }) {
  const warnings = [];
  const roster = rosterRows.filter(r => r["在學"]);
  if (!roster.length) throw new Error("名冊沒有任何在學學生，無法產生工作分配");

  const maskMap = uniqueMaskNames(roster.map(r => r["姓名"]));
  const bySeat = new Map(roster.map(r => [Number(r["座號"]), r]));
  const allSeats = [...bySeat.keys()].sort((a, b) => a - b);
  const nameOf = seat => maskMap.get(String(bySeat.get(seat)["姓名"]).trim());

  // 「16,17,13,15」→ [16,17,13,15]。全形逗號與頓號也接受（從別處貼過來很常見）
  const parseSeats = (raw, where) => splitList(raw).map(s => {
    const n = Number(s);
    if (!Number.isInteger(n) || !bySeat.has(n))
      throw new Error(`「${where}」的座號「${s}」在名冊查無（或不是數字）——請到 Notion「🧹 班級工作分配」修正`);
    return n;
  });

  const rows = dutyRows.filter(r => r["顯示"]).sort((a, b) => (a["排序"] || 0) - (b["排序"] || 0));

  // ── 打掃 ──────────────────────────────────────────────
  const dutyOnly = rows.filter(r => r["類型"] === "打掃");
  const zones = Object.keys(ZONE_META).map(zoneName => {
    const groups = dutyOnly.filter(r => r["區域"] === zoneName).map(r => {
      const seats = parseSeats(r["成員座號"], r["組別"]);
      const support = parseSeats(r["支援座號"], `${r["組別"]}・支援`);
      return { seats, support, group: r["組別"], tools: splitList(r["配置掃具"]), ...isoFields(r) };
    });
    // 人數＝該區實際涵蓋的人；同一人同時是某組主責、另一組支援時不重複計
    const headcount = new Set(groups.flatMap(g => [...g.seats, ...g.support])).size;
    return {
      zone: zoneName, emoji: ZONE_META[zoneName].emoji, headcount,
      groups: groups.map(g => ({
        group: g.group, members: g.seats.map(nameOf), support: g.support.map(nameOf),
        work: g.work, tools: g.tools, title: g.title, authority: g.authority, standard: g.standard,
      })),
    };
  }).filter(z => z.groups.length);

  // 沒被任何一組涵蓋的人：**不中止同步**（會讓整站停在舊版），改在班網標「尚待安排」，
  // 老師看得到、也不會因為一時沒排完就整批資料上不去。
  const covered = new Set(dutyOnly.flatMap(r =>
    [...parseSeats(r["成員座號"], r["組別"]), ...parseSeats(r["支援座號"], `${r["組別"]}・支援`)]));
  const unassigned = allSeats.filter(s => !covered.has(s));
  if (unassigned.length) warnings.push(`打掃分配未涵蓋 ${unassigned.length} 人（班網標「尚待老師安排」）`);

  const duties = {
    _產生自: "sync-notion.mjs ← Notion「🧹 班級工作分配」（勿手改）",
    時段: kv["打掃時間"] || "",
    zones,
    未分配: unassigned.map(nameOf),
    未分配說明: unassigned.length ? "這些同學還沒排到打掃工作，老師確認後會補上。" : "",
  };

  // ── 午餐 ──────────────────────────────────────────────
  const lunchRows = rows.filter(r => r["類型"] === "午餐");
  const fixedRows = lunchRows.filter(r => r["區域"] === "午餐固定崗");
  const rotRows = lunchRows.filter(r => r["區域"] === "午餐輪值崗");
  const fixedSeats = new Set(fixedRows.flatMap(r => parseSeats(r["成員座號"], r["組別"])));
  const pool = allSeats.filter(s => !fixedSeats.has(s));

  // 人數 >1 的崗位拆成「搬餐桶・湯（1）」「（2）」，每個位子各排一個人
  const slots = rotRows.flatMap(r => {
    const n = Math.max(1, Number(r["人數"]) || 1);
    return n === 1 ? [r["組別"]] : Array.from({ length: n }, (_, i) => `${r["組別"]}（${i + 1}）`);
  });

  const lunch = {
    _產生自: "sync-notion.mjs ← Notion「🧹 班級工作分配」（勿手改）",
    規則: String(kv["午餐規則"] ?? "").split(/\n+/).map(s => s.trim()).filter(Boolean),
    posts: rotRows.map(r => ({ post: r["組別"], headcount: Number(r["人數"]) || 1, ...isoFields(r) })),
    fixed: fixedRows.map(r => {
      const seats = parseSeats(r["成員座號"], r["組別"]);
      return {
        post: r["組別"], headcount: Number(r["人數"]) || seats.length,
        members: seats.map(nameOf), isMock: !!r["模擬資料"], ...isoFields(r),
      };
    }),
    rotation: [],
  };

  if (slots.length && pool.length) {
    // 完整輪替週數：位移每週 +slots.length，要回到起點需 pool/gcd(pool, slots) 週。
    // 例：21 人每週 5 人 → gcd=1 → 21 週（每人剛好各 5 次）。
    // 用 ceil(21/5)=5 是錯的：第 5 週會繞回頭跟第 1 週的人重疊，有人值兩次、有人還沒輪到。
    const weeks = pool.length / gcd(pool.length, slots.length);
    Object.assign(lunch, {
      輪值池人數: pool.length,
      每週人數: slots.length,
      完整輪替週數: weeks,
      每人每輪次數: (weeks * slots.length) / pool.length,
      rotation: Array.from({ length: weeks }, (_, w) => ({
        week: w + 1,
        assign: slots.map((slot, i) => ({ slot, name: nameOf(pool[(w * slots.length + i) % pool.length]) })),
      })),
    });
    // 公平性驗證：完整一輪後每人出場次數必須相同，否則輪值規則有 bug
    const times = {};
    for (const wk of lunch.rotation) for (const a of wk.assign) times[a.name] = (times[a.name] || 0) + 1;
    const counts = [...new Set(Object.values(times))];
    if (Object.keys(times).length !== pool.length || counts.length !== 1)
      throw new Error(`午餐輪值不公平：${Object.keys(times).length}/${pool.length} 人出場，次數分布 ${counts.join("/")}`);
  } else if (rotRows.length) {
    warnings.push("午餐輪值崗沒有可排的人（輪值池為空）");
  }

  // ── 座位表 ────────────────────────────────────────────
  // 「⚙️ 網站設定」的「座位表」列：一行一列、逗號分隔座號，- ＝空位
  const grid = String(kv["座位表"] ?? "").split(/\n+/).map(l => l.trim()).filter(Boolean)
    .map(line => line.split(/[,，]/).map(c => c.trim()).map(c => {
      if (!c || c === "-" || c === "－") return null;
      const n = Number(c);
      if (!Number.isInteger(n) || !bySeat.has(n))
        throw new Error(`座位表的「${c}」在名冊查無——請到 Notion「⚙️ 網站設定」的「座位表」列修正`);
      return n;
    }));
  const flat = grid.flat().filter(s => s != null);
  if (new Set(flat).size !== flat.length)
    throw new Error("座位表有重複座號——請到 Notion「⚙️ 網站設定」的「座位表」列修正");
  if (flat.length && flat.length !== allSeats.length)
    warnings.push(`座位表 ${flat.length} 人，名冊 ${allSeats.length} 人（有人沒座位或多排了）`);

  const cols = grid.length ? Math.max(...grid.map(r => r.length)) : 0;
  const seating = {
    _產生自: "sync-notion.mjs ← Notion「⚙️ 網站設定」的「座位表」列（勿手改）",
    說明: "欄由左至右為第六排→第一排，列由上至下為前排→後排，講台在最上方。",
    columns: SEAT_COLUMNS.slice(-cols || SEAT_COLUMNS.length),
    grid: grid.map(row => Array.from({ length: cols }, (_, i) => (row[i] == null ? null : nameOf(row[i])))),
  };

  // 最後一道：公開版不得含座號欄位或完整姓名
  const json = JSON.stringify({ duties, lunch, seating });
  for (const r of roster) {
    const full = String(r["姓名"]).trim();
    if (full.length > 2 && json.includes(full))
      throw new Error(`公開版 JSON 含完整姓名「${full}」——遮罩失效，中止`);
  }
  if (/"座號"/.test(json)) throw new Error("公開版 JSON 含「座號」欄位，中止");

  return { duties, lunch, seating, warnings };
}
