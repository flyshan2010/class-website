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

// 「2:北側；3:南側」→ { 2: "北側", 3: "南側" }。分號／換行分隔，冒號全半形都收。
// 紙本檢核表是逐人一列的，組層級的 work 撐不起「你負責哪一塊」——這欄才是。
const parsePersonal = raw => {
  const out = {};
  String(raw ?? "").split(/[;；\n]+/).map(x => x.trim()).filter(Boolean).forEach(part => {
    const m = part.match(/^(\d+)\s*[:：]\s*(.+)$/);
    if (m) out[Number(m[1])] = m[2].trim();
  });
  return out;
};

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
 * @returns {{duties:object, lunch:object, seating:object, dutiesSeats:object, seatingSeats:object, lunchSeats:object, warnings:string[]}}
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
      // 固定支援 2026-09-10 廢止（實際沒有固定支援）：改由 class-manager 當天指派「打掃支援」，
      // 有支援才加發當次薪水。欄位還留在 Notion，但填了一律不採計，並在同步警告提醒清空。
      if (String(r["支援座號"] ?? "").trim())
        warnings.push(`「${r["組別"]}」的支援座號已停用（改當天浮動支援），請到 Notion 清空；本次不採計`);
      const sup = String(r["監督座號"] ?? "").trim();
      return {
        seats, group: r["組別"], tools: splitList(r["配置掃具"]),
        personal: parsePersonal(r["個人責任範圍"]),
        supervisor: sup && Number.isInteger(Number(sup)) ? Number(sup) : null,
        ...isoFields(r),
      };
    });
    // 人數＝該區實際涵蓋的人（同一座號出現在兩組時不重複計）
    const headcount = new Set(groups.flatMap(g => g.seats)).size;
    return {
      zone: zoneName, emoji: ZONE_META[zoneName].emoji, headcount, _raw: groups,
      groups: groups.map(g => ({
        group: g.group, members: g.seats.map(nameOf),
        work: g.work, tools: g.tools, title: g.title, authority: g.authority, standard: g.standard,
      })),
    };
  }).filter(z => z.groups.length);

  // 沒被任何一組涵蓋的人：**不中止同步**（會讓整站停在舊版），改在班網標「尚待安排」，
  // 老師看得到、也不會因為一時沒排完就整批資料上不去。
  const covered = new Set(dutyOnly.flatMap(r => parseSeats(r["成員座號"], r["組別"])));
  const unassigned = allSeats.filter(s => !covered.has(s));
  if (unassigned.length) warnings.push(`打掃分配未涵蓋 ${unassigned.length} 人（班網標「尚待老師安排」）`);

  const duties = {
    _產生自: "sync-notion.mjs ← Notion「🧹 班級工作分配」（勿手改）",
    時段: kv["打掃時間"] || "",
    // _raw 帶的是座號，**公開版一律剝掉**（只有下方 dutiesSeats 才用得到）
    zones: zones.map(({ _raw, ...z }) => z),
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

  // rotationSeats：與 lunch.rotation 同一份輪值，只是留座號（class-manager 用）。
  // 兩份必須由**同一次計算**產出，分開算兩次就是兩份會各自漂移的正本。
  let rotationSeats = [];
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
      rotation: [],
    });
    rotationSeats = Array.from({ length: weeks }, (_, w) => ({
      week: w + 1,
      assign: slots.map((slot, i) => ({ slot, seat: pool[(w * slots.length + i) % pool.length] })),
    }));
    lunch.rotation = rotationSeats.map(wk => ({
      week: wk.week,
      assign: wk.assign.map(a => ({ slot: a.slot, name: nameOf(a.seat) })),
    }));
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

  // ── 座號版兩份（class-manager 常規檢核台專用・2026-09-06 Phase 2-2）────────
  // 為什麼要另外一份：class-manager 一個字都不存姓名（該站硬規則 2），
  // 拿遮罩姓名版對不回座號；而檢核台要點得到「人」，還要顯示「你負責哪一塊」。
  // ⚠️ 這兩份與 duties/seating 一樣是公開檔，**只帶座號、絕不帶姓名**，下方有護欄擋。
  const dutiesSeats = {
    _產生自: "sync-notion.mjs ← Notion「🧹 班級工作分配」（勿手改）",
    _用途: "class-manager 環境晨掃檢核台（純座號版，不含姓名）",
    時段: kv["打掃時間"] || "",
    zones: zones.map(z => ({
      zone: z.zone, emoji: z.emoji, headcount: z.headcount,
      groups: z._raw.map(g => ({
        group: g.group, seats: g.seats,
        personal: g.personal, supervisor: g.supervisor,
        work: g.work, tools: g.tools, title: g.title, authority: g.authority, standard: g.standard,
      })),
    })),
    未分配: unassigned,
  };
  // 三區監督人：由各組的「監督座號」彙整，同一位監督的組全掛在他名下。
  // 零事件的監督生 ≠ 不存在（U41）：有欄位就出現，沒排到組也留一個空陣列。
  const supervisors = {};
  for (const z of dutiesSeats.zones) for (const g of z.groups) {
    if (g.supervisor == null) continue;
    (supervisors[g.supervisor] = supervisors[g.supervisor] || []).push(`${z.zone}・${g.group}`);
  }
  dutiesSeats.supervisors = supervisors;
  if (!Object.keys(supervisors).length)
    warnings.push("「🧹 班級工作分配」沒有任何一列填「監督座號」——檢核台會退回「老師自己點」模式");

  const seatingSeats = {
    _產生自: "sync-notion.mjs ← Notion「⚙️ 網站設定」的「座位表」列（勿手改）",
    _用途: "class-manager 座位加分板（純座號版，不含姓名）",
    說明: seating.說明,
    columns: seating.columns,
    grid,
  };

  // ── 午餐座號版（class-manager 午餐工作檢核台・2026-09-06 Phase 3-2）────────
  // 固定崗（午餐長／打飯班）直接給座號；輪值崗給整份 rotation（座號版）＋輪替週數，
  // 由 class-manager 依 weeks.json 的本學期週次自己算「這週輪到誰」
  // （公式與班網 about.js 同一條：((週次-1) % 完整輪替週數) + 1，不寫死週數）。
  const lunchSeats = {
    _產生自: "sync-notion.mjs ← Notion「🧹 班級工作分配」（勿手改）",
    _用途: "class-manager 午餐工作檢核台（純座號版，不含姓名）",
    規則: lunch.規則,
    輪值池人數: lunch.輪值池人數 ?? 0,
    每週人數: lunch.每週人數 ?? 0,
    完整輪替週數: lunch.完整輪替週數 ?? 0,
    fixed: fixedRows.map(r => ({
      post: r["組別"], headcount: Number(r["人數"]) || parseSeats(r["成員座號"], r["組別"]).length,
      seats: parseSeats(r["成員座號"], r["組別"]), ...isoFields(r),
    })),
    posts: rotRows.map(r => ({ post: r["組別"], headcount: Number(r["人數"]) || 1, ...isoFields(r) })),
    rotation: rotationSeats,
  };

  // 座號版的護欄：可以有座號（本來就是為此而生），但**一個姓名都不准有**
  const seatsJson = JSON.stringify({ dutiesSeats, seatingSeats, lunchSeats });
  for (const r of roster) {
    const full = String(r["姓名"]).trim();
    if (full.length >= 2 && seatsJson.includes(full))
      throw new Error(`座號版 JSON 含姓名「${full}」——中止（class-manager 不得存姓名）`);
  }

  // 最後一道：公開版不得含座號欄位或完整姓名
  const json = JSON.stringify({ duties, lunch, seating });
  for (const r of roster) {
    const full = String(r["姓名"]).trim();
    if (full.length > 2 && json.includes(full))
      throw new Error(`公開版 JSON 含完整姓名「${full}」——遮罩失效，中止`);
  }
  if (/"座號"/.test(json)) throw new Error("公開版 JSON 含「座號」欄位，中止");

  return { duties, lunch, seating, dutiesSeats, seatingSeats, lunchSeats, warnings };
}
