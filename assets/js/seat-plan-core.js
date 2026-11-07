/* 座位編排建議——共用計算程式（DJ 線 P1，SPEC：ClassOS_v3.5_藍圖/SPEC_座位編排.md）
 *
 * 純函式、無 I/O：瀏覽器 window.SeatPlan、node require。排座頁 seat-plan.js 與測試都只用這一支（U83）。
 * 規則與罰分照範本 `座位編排建議_精簡版.html` 的 evaluate()／optimize()（SPEC §4），沒列在 SPEC 的考量一律不做。
 *
 * 資料形狀：
 *   grid      = { rows, cols, assign }，assign 長度 rows*cols，第 i 格＝第 floor(i/cols)+1 排、第 i%cols+1 欄，值＝座號或 null（空位）
 *   input     = { rows, cols, students:[{seat, sex:"男"|"女"|"", tags:["front","distract","tall","needhelp","tutor"]}],
 *                 relations:[{a, b, k:"chat"|"conflict"|"pos"}], current: grid|null（目前座位，用來算「不和上次同座」）}
 *   locks     = { 桌位 index: 座號 }（🔒 固定，只存在本次頁面）
 *   空位一律排在後排（optimize 的結構限制，不是計分規則；老師手動互換仍可移動空位）
 *
 * 執行測試：node --test scripts/seat-plan.test.mjs
 */
(function (root) {
  "use strict";

  // ═════════ 教室常數（換教室只改這裡，SPEC §3） ═════════
  // 第 1 排靠黑板（index 0）。靠窗（走廊）＝最左、最右欄。
  // 門邊＝(第 1–2 排, 最左或最右欄)、(最後兩排, 最右欄)。
  const ROOM = {
    FRONT_ROWS: 2,                                          // 「需坐前面」＝前兩排
    isWindow: (c, cols) => c === 0 || c === cols - 1,
    isDoor: (r, c, rows, cols) => (r <= 1 && (c === 0 || c === cols - 1)) || (r >= rows - 2 && c === cols - 1),
  };
  const ADJ_LR = 1, ADJ_FB = 0.7, ADJ_DIAG = 0.35;          // 相鄰程度：左右、前後、斜角
  const CLOSE_MIN = 0.7;                                    // 「前後左右」＝程度 ≥ 0.7

  const TAGS = ["front", "distract", "tall", "needhelp", "tutor"];
  const KINDS = ["chat", "conflict", "pos"];
  const TIER = { must: "必須", pri: "優先", soft: "盡量" };
  const RULES = {
    front:    { tier: "must", label: "👁️ 需坐前面 → 前兩排" },
    conflict: { tier: "must", label: "⚡ 易衝突 → 隔開" },
    chat:     { tier: "must", label: "🗣️ 愛聊天 → 不相鄰" },
    distract: { tier: "pri",  label: "🌀 易分心 → 中間偏前，避開門窗" },
    helper:   { tier: "pri",  label: "🙋 需協助 → 旁邊有小老師" },
    tall:     { tier: "pri",  label: "📏 身高高 → 不坐第一排" },
    pos:      { tier: "soft", label: "💚 能互助 → 坐近" },
    gender:   { tier: "soft", label: "男女梅花座" },
    history:  { tier: "soft", label: "不和上次同座" },
    spread:   { tier: "soft", label: "🎓 小老師分散" },
  };
  const PEN = { must: 100, pri: 20, soft: 3 };              // 內部用，畫面不顯示數字
  const SA = { RUNS: 3, STEPS: 6000, T0: 60, T_END_RATIO: 0.001 };

  const key2 = (a, b) => Math.min(a, b) + "-" + Math.max(a, b);
  const adjWord = v => v >= ADJ_LR ? "左右相鄰" : v >= ADJ_FB ? "前後相鄰" : v > 0 ? "斜角相鄰" : "只隔一個位子";

  // ═════════ 座位表文字 ⇄ grid（格式同 build-duties.mjs：一行一排、逗號分隔、- ＝空位） ═════════
  function parseGrid(text) {
    const lines = String(text ?? "").split(/\r?\n+/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error("座位表是空的");
    const rowsArr = lines.map((line, r) => line.split(/[,，]/).map(c => c.trim()).map(c => {
      if (!c || c === "-" || c === "－") return null;
      const n = Number(c);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`座位表第${r + 1}排的「${c}」不是座號`);
      return n;
    }));
    const rows = rowsArr.length, cols = Math.max(...rowsArr.map(r => r.length));
    const assign = [];
    rowsArr.forEach(r => { for (let c = 0; c < cols; c++) assign.push(r[c] ?? null); });
    const flat = assign.filter(s => s != null);
    const dup = flat.find((s, i) => flat.indexOf(s) !== i);
    if (dup != null) throw new Error(`座位表的座號${dup} 重複`);
    return { rows, cols, assign };
  }

  function formatGrid(grid) {
    const { rows, cols, assign } = grid;
    if (assign.length !== rows * cols) throw new Error("座位格數與排數×欄數不符");
    const out = [];
    for (let r = 0; r < rows; r++)
      out.push(assign.slice(r * cols, r * cols + cols).map(s => (s == null ? "-" : String(s))).join(","));
    return out.join("\n");
  }

  // ═════════ 前置計算：相鄰表、去重的人際、上次同座 ═════════
  function adjacency(rows, cols) {
    const D = rows * cols;
    const ADJ = Array.from({ length: D }, () => new Float32Array(D));
    const NEAR2 = Array.from({ length: D }, () => new Uint8Array(D));  // 列差²＋欄差² ≤ 4（隔一個位子以內）
    const CLOSE = [];                                                 // 前後左右的桌位對 [i, j, 程度]
    for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) {
      if (i === j) continue;
      const dr = Math.abs(Math.floor(i / cols) - Math.floor(j / cols)), dc = Math.abs(i % cols - j % cols);
      ADJ[i][j] = dr === 0 && dc === 1 ? ADJ_LR : dc === 0 && dr === 1 ? ADJ_FB : dr === 1 && dc === 1 ? ADJ_DIAG : 0;
      NEAR2[i][j] = dr * dr + dc * dc <= 4 ? 1 : 0;
      if (i < j && ADJ[i][j] >= CLOSE_MIN) CLOSE.push([i, j, ADJ[i][j]]);
    }
    return { ADJ, NEAR2, CLOSE };
  }

  function prepare(input) {
    if (input && input.__prepared) return input;
    const rows = Number(input.rows), cols = Number(input.cols);
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) throw new Error("教室排數／欄數不正確");
    const students = (input.students || []).map(s => {
      const tags = new Set(s.tags || []);
      for (const t of tags) if (!TAGS.includes(t)) throw new Error(`座號${s.seat} 有不認得的個人狀況「${t}」`);
      return { seat: Number(s.seat), sex: s.sex || "", tags };
    });
    const bySeat = new Map(students.map(s => [s.seat, s]));
    if (bySeat.size !== students.length) throw new Error("學生名單有重複座號");
    // 同一對只留一筆（後寫蓋前寫，SPEC §2.2）
    const relMap = new Map();
    for (const rl of input.relations || []) {
      const a = Number(rl.a), b = Number(rl.b);
      if (!KINDS.includes(rl.k)) throw new Error(`不認得的人際關係「${rl.k}」`);
      if (a === b) throw new Error(`座號${a} 不能和自己配對`);
      if (!bySeat.has(a) || !bySeat.has(b)) throw new Error(`人際「座號${a}↔${b}」有人不在名單`);
      relMap.set(key2(a, b), { a, b, k: rl.k });
    }
    const adj = adjacency(rows, cols);
    // 目前座位的前後左右（以目前座位表自己的大小算）
    const histPairs = new Set();
    if (input.current) {
      const cur = input.current, cc = adjacency(cur.rows, cur.cols).CLOSE;
      for (const [i, j] of cc) if (cur.assign[i] != null && cur.assign[j] != null) histPairs.add(key2(cur.assign[i], cur.assign[j]));
    }
    return { __prepared: true, rows, cols, D: rows * cols, students, bySeat, relations: [...relMap.values()], histPairs, ...adj };
  }

  // ═════════ 評分（範本 evaluate() 為正本） ═════════
  // 回傳 { total, items, counts }；items 只在 detail=true 時產生：{rule, tier, ok, seats, text}
  function evaluate(input, assign, opts) {
    const ctx = prepare(input), detail = !!(opts && opts.detail);
    const { rows, cols, students, bySeat, relations, histPairs, ADJ, NEAR2, CLOSE } = ctx;
    let total = 0;
    const items = detail ? [] : null, counts = { must: 0, pri: 0, soft: 0 };
    const add = (rule, ok, seats, text, w = 1) => {
      const tier = RULES[rule].tier;
      if (!ok) { total += PEN[tier] * w; counts[tier]++; }
      if (items) items.push({ rule, tier, ok, seats, text: text() });
    };
    const pos = new Map();
    assign.forEach((s, i) => { if (s != null) pos.set(s, i); });
    for (const s of students) {
      const i = pos.get(s.seat); if (i == null) continue;
      const r = Math.floor(i / cols), c = i % cols, n = s.seat, t = s.tags;
      if (t.has("front")) {
        const ok = r < ROOM.FRONT_ROWS;
        add("front", ok, [n], () => ok ? `座號${n} 需坐前面，在第${r + 1}排` : `座號${n} 需坐前面，現在第${r + 1}排`, r - (ROOM.FRONT_ROWS - 1));
      }
      if (t.has("distract")) {
        const door = ROOM.isDoor(r, c, rows, cols), ok = !ROOM.isWindow(c, cols) && !door;
        total += r * 2;                                     // 越前面越好（小扣分，不算違規）
        add("distract", ok, [n], () => ok ? `座號${n} 易分心，坐中間第${r + 1}排` : `座號${n} 易分心，現在靠${door ? "門" : "窗（走廊）"}`);
      }
      if (t.has("tall")) add("tall", r >= 1, [n], () => r >= 1 ? `座號${n} 身高高，沒坐第一排` : `座號${n} 身高高坐第一排，會擋後面`);
      if (t.has("needhelp")) {
        const h = students.find(o => o.seat !== n && o.tags.has("tutor") && pos.has(o.seat) && ADJ[i][pos.get(o.seat)] >= CLOSE_MIN);
        add("helper", !!h, h ? [n, h.seat] : [n],
          () => h ? `座號${n} 需協助，小老師座號${h.seat} 在${adjWord(ADJ[i][pos.get(h.seat)])}` : `座號${n} 需協助，旁邊沒有小老師`);
      }
    }
    for (const rl of relations) {
      const ia = pos.get(rl.a), ib = pos.get(rl.b); if (ia == null || ib == null) continue;
      const v = ADJ[ia][ib], pair = `座號${rl.a}、${rl.b}`;
      if (rl.k === "chat")
        add("chat", v === 0, [rl.a, rl.b], () => v === 0 ? `${pair}（愛聊天）已分開` : `${pair} 愛聊天，現在${adjWord(v)}`, v >= CLOSE_MIN ? 1 : 0.6);
      else if (rl.k === "conflict") {
        const bad = NEAR2[ia][ib];
        add("conflict", !bad, [rl.a, rl.b], () => !bad ? `${pair}（易衝突）已隔開` : `${pair} 易衝突，現在${adjWord(v)}`, v ? 1.5 : 1);
      } else
        add("pos", v >= CLOSE_MIN, [rl.a, rl.b], () => v >= CLOSE_MIN ? `${pair} ${adjWord(v)}，能互助` : `${pair} 能互助，這次沒坐近`, 1.5);
    }
    for (const [i, j, v] of CLOSE) {
      const a = assign[i], b = assign[j]; if (a == null || b == null) continue;
      const A = bySeat.get(a), B = bySeat.get(b); if (!A || !B) continue;
      if (A.sex && B.sex && A.sex === B.sex) add("gender", false, [a, b], () => `座號${a}、${b} 同性${adjWord(v)}`, v);
      if (histPairs.has(key2(a, b))) add("history", false, [a, b], () => `座號${a}、${b} 上次也坐一起`);
      if (A.tags.has("tutor") && B.tags.has("tutor")) add("spread", false, [a, b], () => `小老師座號${a}、${b} 擠在一起`);
    }
    return { total, items, counts };
  }

  // ═════════ 排座：模擬退火，固定種子（同樣條件＋同樣種子＝同樣結果） ═════════
  function rng(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // 回傳 { rows, cols, assign }（可直接交給 formatGrid）
  function optimize(input, opts) {
    const ctx = prepare(input), o = opts || {};
    const seed = Number.isInteger(o.seed) ? o.seed : 1;
    const runs = o.runs ?? SA.RUNS, steps = o.steps ?? SA.STEPS;
    const { D, students, bySeat } = ctx;
    if (students.length > D) throw new Error(`學生 ${students.length} 人，教室只有 ${D} 個座位`);
    const locks = new Map();
    const lockList = o.locks instanceof Map ? [...o.locks] : Object.entries(o.locks || {});
    for (const [k, s] of lockList) {
      const i = Number(k), n = Number(s);
      if (!Number.isInteger(i) || i < 0 || i >= D) throw new Error(`固定的桌位 ${k} 不在教室裡`);
      if (!bySeat.has(n)) throw new Error(`固定的座號${n} 不在名單`);
      if ([...locks.values()].includes(n)) throw new Error(`座號${n} 被固定在兩個位子`);
      locks.set(i, n);
    }
    let best = null, bestC = Infinity;
    for (let run = 0; run < runs; run++) {
      const rnd = rng(seed * 101 + run), assign = Array(D).fill(null);
      for (const [i, s] of locks) assign[i] = s;
      const lockedSeats = new Set(locks.values()), free = [...Array(D).keys()].filter(i => !locks.has(i));
      const pool = students.map(s => s.seat).filter(s => !lockedSeats.has(s));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      pool.forEach((s, k) => { assign[free[k]] = s; });
      // 空位固定放後排（老師 2026-11-07 裁定）：空位一開始就落在最後幾個可動桌位。
      // 空位比一排多時，它後面的整排固定空著不參與交換；只有交界那一排（backRow）可以挑哪幾格空。
      const nEmpty = free.length - pool.length;
      const backRow = nEmpty > 0 ? Math.floor(free[free.length - nEmpty] / ctx.cols) : ctx.rows;
      const movable = free.filter(i => Math.floor(i / ctx.cols) <= backRow);
      const backZone = new Set(free.filter(i => Math.floor(i / ctx.cols) === backRow));
      let cur = evaluate(ctx, assign).total;
      if (cur < bestC) { bestC = cur; best = assign.slice(); }
      if (movable.length < 2) continue;
      for (let it = 0; it < steps; it++) {
        const T = SA.T0 * Math.pow(SA.T_END_RATIO, it / steps);
        const a = movable[Math.floor(rnd() * movable.length)], b = movable[Math.floor(rnd() * movable.length)];
        if (a === b || (assign[a] == null && assign[b] == null)) continue;
        if ((assign[a] == null && !backZone.has(b)) || (assign[b] == null && !backZone.has(a))) continue;   // 空位不離開後排
        [assign[a], assign[b]] = [assign[b], assign[a]];
        const c = evaluate(ctx, assign).total;
        if (c <= cur || rnd() < Math.exp((cur - c) / T)) { cur = c; if (c < bestC) { bestC = c; best = assign.slice(); } }
        else [assign[a], assign[b]] = [assign[b], assign[a]];
      }
    }
    return { rows: ctx.rows, cols: ctx.cols, assign: best };
  }

  const api = { ROOM, TAGS, KINDS, TIER, RULES, parseGrid, formatGrid, prepare, evaluate, optimize, adjWord };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SeatPlan = api;
})(typeof window !== "undefined" ? window : globalThis);
