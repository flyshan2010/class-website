/* 🪑 排座頁（DJ 線 P3，SPEC_座位編排.md §7）
 * 資料：代理 seat_get（名冊、座位表、座位條件）→ 本頁微調 → seat_apply（封存舊表、寫新表、更新條件、同步班網）。
 * 計算：window.SeatPlan（assets/js/seat-plan-core.js，與 node 測試同一支，不在這裡重寫規則）。
 * 健康（只存本機 localStorage，絕不送代理）：🦻 聽力「seatplan-hear-v1」（座號陣列）、視力「seatplan-vision-v1」、身高「seatplan-height-v1」（{座號: 數值}）。
 *   視力、身高由老師貼上，👁️ 需坐前面／👓 第 3–4 排／📏 身高高由 SP.deriveTags 推出，不手勾（老師 11/07）。
 *   舊版手勾的「seatplan-health-v1／v2」（視力標籤）載入時清掉，改以貼上的視力為準。 */
(function () {
  "use strict";
  const SP = window.SeatPlan;
  const HEAR_KEY = "seatplan-hear-v1", OLD_KEYS = ["seatplan-health-v1", "seatplan-health-v2"];
  // 貼上的數值：身高、視力（格式「座號:數值」；視力可寫「右/左」取較差眼）
  const NUM = {
    height: { key: "seatplan-height-v1", min: 80, max: 220, unit: "身高", box: "h" },
    vision: { key: "seatplan-vision-v1", min: 0.01, max: 2.0, unit: "視力", box: "v" },
  };
  // chip＝老師手勾；其餘由視力、身高推出（只顯示圖示）
  const TRAITS = {
    hear:     { icon: "🦻", label: "聽力・需坐前面", health: true, chip: true },
    distract: { icon: "🌀", label: "易分心", chip: true },
    needhelp: { icon: "🙋", label: "需協助", chip: true },
    tutor:    { icon: "🎓", label: "小老師", chip: true },
    front:    { icon: "👁️", label: "視力≤0.7・需坐前面" },
    mid:      { icon: "👓", label: "視力0.8–0.9・第3–4排" },
    tall:     { icon: "📏", label: "全班最高1/5" },
  };
  const REL = { chat: "🗣️ 愛聊天（不相鄰）", conflict: "⚡ 易衝突（隔開）", pos: "💚 能互助（坐近）" };
  const MONTH = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast = m => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2600); };
  const key2 = (a, b) => Math.min(a, b) + "-" + Math.max(a, b);

  // ── 狀態 ──
  let students = [], bySeat = new Map(), relations = [], current = null, room = { rows: 5, cols: 6 };
  let plan = null, seed = 1, view = "plan", selected = null, healthSaved = false, busy = false;
  const locks = new Map();                                     // 桌 index → 座號（只存在本次頁面）
  let proxyUrl = null;

  // ── 代理 ──
  function pw() { try { return sessionStorage.getItem("teacherPw") || ""; } catch (e) { return ""; } }
  async function call(body) {
    if (!proxyUrl) {
      const c = await (await fetch("data/site-config.json?t=" + Date.now(), { cache: "no-cache" })).json();
      proxyUrl = c.updateProxyUrl;
      if (!proxyUrl) throw new Error("班網設定沒有代理網址（updateProxyUrl）");
    }
    const res = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ pw: pw() }, body)) });
    const data = await res.json();
    if (!data.ok && data.error === "口令錯誤") {
      try { sessionStorage.removeItem("teacherPw"); } catch (e) {}
      gate("口令已失效，請回教師專區重新登入。");
      throw new Error("口令錯誤");
    }
    return data;
  }
  function gate(msg) {
    $("#app").hidden = true; $("#gate").hidden = false;
    if (msg) $("#gateMsg").textContent = msg;
  }
  function setStatus(msg, bad) { const el = $("#status"); el.textContent = msg; el.classList.toggle("bad", !!bad); }

  // ── 健康標籤：只存本機 ──
  function loadHealth() {
    try {
      OLD_KEYS.forEach(k => localStorage.removeItem(k));        // 舊版手勾視力：改由貼上的視力推算
      const raw = localStorage.getItem(HEAR_KEY);
      if (!raw) return;
      JSON.parse(raw).forEach(n => { const s = bySeat.get(Number(n)); if (s) s.tags.add("hear"); });
      healthSaved = true;
    } catch (e) { /* 私密視窗或封鎖儲存：照常運作，只是不記 */ }
  }
  function saveHealth() {
    try { localStorage.setItem(HEAR_KEY, JSON.stringify(students.filter(s => s.tags.has("hear")).map(s => s.seat))); healthSaved = true; }
    catch (e) { healthSaved = false; toast("這台電腦沒辦法記住健康標籤（瀏覽器封鎖儲存），關掉頁面就會消失"); }
  }

  // ── 身高、視力：貼上、只存本機 ──
  function parseNums(kind, text) {
    const cfg = NUM[kind], out = new Map(), bad = [];
    String(text || "").split(/[\s,，、;；]+/).filter(Boolean).forEach(tok => {
      const m = tok.match(/^(\d+)[:：=](\d*\.?\d+)(?:[\/／](\d*\.?\d+))?$/);
      if (!m || (m[3] && kind !== "vision")) { bad.push(tok); return; }
      const n = Number(m[1]), v = m[3] ? Math.min(Number(m[2]), Number(m[3])) : Number(m[2]);
      if (!bySeat.has(n) || !(v >= cfg.min && v <= cfg.max)) { bad.push(tok); return; }
      out.set(n, v);
    });
    return { out, bad };
  }
  function loadNums() {
    for (const kind of Object.keys(NUM)) {
      try {
        const raw = localStorage.getItem(NUM[kind].key); if (!raw) continue;
        const d = JSON.parse(raw);
        Object.keys(d).forEach(k => { const s = bySeat.get(Number(k)), v = Number(d[k]); if (s && v >= NUM[kind].min && v <= NUM[kind].max) s[kind] = v; });
      } catch (e) { /* 封鎖儲存：照常運作 */ }
    }
  }
  function saveNums(kind) {
    const d = {}; students.forEach(s => { if (s[kind] != null) d[s.seat] = s[kind]; });
    try { localStorage.setItem(NUM[kind].key, JSON.stringify(d)); return true; } catch (e) { return false; }
  }
  // 實際送進計算的標籤＝手勾（🦻 聽力→需坐前面）＋由視力、身高推出
  let derived = new Map();
  function rederive() { derived = SP.deriveTags(students.map(s => ({ seat: s.seat, vision: s.vision, height: s.height }))); }
  function eff(s) {
    const t = new Set([...s.tags].map(x => x === "hear" ? "front" : x));
    (derived.get(s.seat) || []).forEach(x => t.add(x));
    return t;
  }
  function shownTags(s) { return [...new Set([...s.tags, ...(derived.get(s.seat) || [])])]; }

  // ── 計算 ──
  function input() {
    return {
      rows: room.rows, cols: room.cols, current,
      students: students.map(s => ({ seat: s.seat, sex: s.sex, tags: [...eff(s)], height: s.height ?? null })),
      relations,
    };
  }
  function regen() {
    try {
      rederive();
      plan = SP.optimize(input(), { seed, locks }).assign;
      selected = null; render();
    } catch (err) { setStatus("排不出座位：" + err.message, true); }
  }
  // 班網遮罩姓名（與 scripts/lib/mask-name.mjs 相同規則：王大明→王○明；撞名改遮末字）
  function maskMap() {
    const base = n => n.length <= 1 ? (n || "○○○") : n[0] + "○".repeat(Math.max(1, n.length - 2)) + (n.length > 2 ? n[n.length - 1] : "");
    const tail = n => n.length <= 1 ? (n || "○○○") : n.slice(0, -1) + "○";
    const count = {};
    students.forEach(s => { const b = base(s.name); count[b] = (count[b] || 0) + 1; });
    return new Map(students.map(s => [s.seat, count[base(s.name)] > 1 ? tail(s.name) : base(s.name)]));
  }

  // ── 畫面 ──
  function renderInputs() {
    $("#stuList").innerHTML = students.map(s => `<div class="stu"><div class="who">${s.seat} ${esc(s.name)}<small>${esc(s.sex || "未填性別")}${s.height != null ? "・" + s.height : ""}${s.vision != null ? "・視" + s.vision : ""}${[...(derived.get(s.seat) || [])].map(t => " " + TRAITS[t].icon).join("")}</small></div><div class="chips">` +
      Object.entries(TRAITS).filter(([, v]) => v.chip).map(([k, v]) => `<button class="chip${v.health ? " health" : ""}${s.tags.has(k) ? " on" : ""}" data-s="${s.seat}" data-t="${k}" aria-pressed="${s.tags.has(k)}">${v.icon} ${v.label}</button>`).join("") + `</div></div>`).join("");
    $("#healthState").textContent = healthSaved ? "（這台電腦已記住）" : "";
    const hn = students.filter(s => s.height != null).length, vn = students.filter(s => s.vision != null).length;
    $("#hState").textContent = hn ? `（已記 ${hn}／${students.length} 人）` : "（尚未設定，不依身高排）";
    $("#vState").textContent = vn ? `（已記 ${vn}／${students.length} 人）` : "（尚未設定）";
    const nm = n => esc(bySeat.get(n) ? bySeat.get(n).name : "");
    $("#relList").innerHTML = relations.map((r, i) => `<li><span>座號${r.a} ${nm(r.a)} ↔ 座號${r.b} ${nm(r.b)}<br><small style="color:var(--muted)">${REL[r.k]}</small></span><button class="btn ghost small" data-del="${i}" aria-label="刪除這組">✕</button></li>`).join("") || `<li><span style="color:var(--muted)">還沒有記錄</span></li>`;
  }

  function roomHTML(assign, mode, e) {
    const must = new Set(), pri = new Set();
    if (mode === "plan") for (const x of e.items) if (!x.ok) {
      if (x.tier === "must") x.seats.forEach(s => must.add(s));
      if (x.tier === "pri") pri.add(x.seats[0]);
    }
    const selS = selected != null ? assign[selected] : null;
    const hi = new Set(selS ? relations.filter(r => r.a === selS || r.b === selS).map(r => r.a === selS ? r.b : r.a) : []);
    const masks = mode === "pub" ? maskMap() : null;
    let h = `<div class="board">黑　板</div><div class="win l"></div><div class="win r"></div>
      <span class="door" style="left:4px;top:10px">🚪 門</span><span class="door" style="right:4px;top:10px">🚪 門</span><span class="door" style="right:4px;bottom:4px">🚪 門</span>
      <div class="grid" style="grid-template-columns:repeat(${room.cols},minmax(0,1fr))">`;
    assign.forEach((s, i) => {
      const st = s != null ? bySeat.get(s) : null, cls = ["desk"];
      if (mode === "pub") cls.push("pub"); else if (st) cls.push(st.sex === "男" ? "m" : st.sex === "女" ? "f" : "");
      if (!st) cls.push("empty");
      if (st && must.has(s)) cls.push("must");
      if (mode === "plan" && i === selected) cls.push("sel");
      if (mode === "plan" && hi.has(s)) cls.push("hi");
      const name = !st ? (s != null ? "名冊沒有" : "空位") : mode === "pub" ? masks.get(s) : st.name;
      const moved = mode === "plan" && s != null && current && current.assign[i] !== s;
      h += `<div class="${cls.filter(Boolean).join(" ")}" data-i="${i}" role="button" tabindex="0" aria-label="${esc(s != null ? "座號" + s + " " + name : "空位")}">
        ${st && pri.has(s) && !must.has(s) ? `<span class="pri"></span>` : ""}${moved ? `<span class="mv"></span>` : ""}${mode === "plan" && locks.has(i) ? `<span class="lock">🔒</span>` : ""}
        <div class="no">${mode === "pub" ? "" : (s ?? "")}</div><div class="nk">${esc(name)}</div>
        <div class="ic">${st && mode !== "pub" ? shownTags(st).map(t => TRAITS[t].icon).join("") : ""}</div></div>`;
    });
    return h + `</div>`;
  }

  function render() {
    renderInputs();
    const assign = view === "now" ? current.assign : plan;
    const e = SP.evaluate(input(), assign, { detail: true });
    $("#room").innerHTML = roomHTML(assign, view, e);
    const by = {}; e.items.forEach(x => (by[x.rule] = by[x.rule] || []).push(x));
    const nm = e.counts.must, np = e.counts.pri;
    $("#headline").innerHTML = (view === "now" ? "目前座位：" : "這份建議：") +
      (nm ? `<span class="bdl">必須的還有 ${nm} 件沒做到</span>` : `<span class="okl">必須的全部做到</span>`) + "・" +
      (np ? `<span class="pril">優先的還有 ${np} 件沒做到</span>` : `<span class="okl">優先的全部做到</span>`);
    $("#tiers").innerHTML = ["must", "pri", "soft"].map(t => `<div class="tier"><h3>${SP.TIER[t]}</h3><ul>` +
      Object.entries(SP.RULES).filter(([, r]) => r.tier === t).map(([k, r]) => {
        const list = by[k] || [], bad = list.filter(x => !x.ok);
        if (t === "soft" && k !== "pos") return `<li class="${bad.length ? "pril" : "okl"}">${bad.length ? "・" : "✅"} ${r.label}${bad.length ? `：還有 ${bad.length} 組` : ""}</li>`;
        if (!list.length) return `<li style="color:var(--muted)">— ${r.label}（沒有人）</li>`;
        return `<li class="${bad.length ? (t === "must" ? "bdl" : "pril") : "okl"}">${bad.length ? "⚠️" : "✅"} ${r.label} ${list.length - bad.length}/${list.length}` +
          bad.map(x => `<br><small>　${esc(x.text)}</small>`).join("") + `</li>`;
      }).join("") + `</ul></div>`).join("");
    renderDetail(assign, e);
    document.querySelectorAll("#view button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === view));
  }

  function renderDetail(assign, e) {
    const d = $("#detail");
    if (selected == null || view !== "plan") { d.classList.remove("on"); return; }
    const s = assign[selected], r = Math.floor(selected / room.cols), c = selected % room.cols;
    const door = SP.ROOM.isDoor(r, c, room.rows, room.cols), win = SP.ROOM.isWindow(c, room.cols);
    const where = `第${r + 1}排第${c + 1}個${door ? "（門邊）" : win ? "（靠窗、走廊）" : ""}`;
    if (s == null) { d.innerHTML = `空位，${where}。再點一位學生，就把他移到這裡。`; d.classList.add("on"); return; }
    const st = bySeat.get(s), mine = e.items.filter(x => x.seats.includes(s));
    const cls = x => x.ok ? "okl" : x.tier === "must" ? "bdl" : "pril";
    d.innerHTML = `<b>座號${s} ${esc(st.name)}</b>（${esc(st.sex || "未填性別")}）${where}　${shownTags(st).map(t => TRAITS[t].icon + TRAITS[t].label).join("　") || "沒有標狀況"}${st.height != null ? "　身高 " + st.height : ""}${st.vision != null ? "　視力 " + st.vision : ""}
      <ul>${mine.map(x => `<li class="${cls(x)}">${x.ok ? "✅" : "⚠️"} ${esc(x.text)}</li>`).join("") || `<li class="okl">✅ 沒有特別的條件，前後左右也沒有衝突</li>`}</ul>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn small" id="lockBtn">${locks.has(selected) ? "🔓 取消固定" : "🔒 固定這個位子"}</button>
      <small style="color:var(--muted)">固定後按「換一個建議」也不會動（例：行動不便要坐門邊）；固定只在這次頁面有效。再點另一格＝兩人互換。</small></div>`;
    d.classList.add("on");
    $("#lockBtn").onclick = () => {
      if (locks.has(selected)) locks.delete(selected); else locks.set(selected, s);
      toast(locks.has(selected) ? `座號${s} 固定在這裡` : "已取消固定"); render();
    };
  }

  // ── 互動 ──
  function bind() {
    $("#stuList").addEventListener("click", ev => {
      const b = ev.target.closest(".chip"); if (!b) return;
      const s = bySeat.get(Number(b.dataset.s)), t = b.dataset.t;
      s.tags.has(t) ? s.tags.delete(t) : s.tags.add(t);
      if (TRAITS[t].health) saveHealth();
      regen();
    });
    $("#clearHealth").onclick = () => {
      students.forEach(s => { s.tags.delete("hear"); s.height = null; s.vision = null; });
      try { [HEAR_KEY, ...OLD_KEYS, NUM.height.key, NUM.vision.key].forEach(k => localStorage.removeItem(k)); } catch (e) {}
      healthSaved = false; toast("已清除這台電腦的聽力、視力、身高"); regen();
    };
    for (const kind of Object.keys(NUM)) {
      const b = NUM[kind].box, u = NUM[kind].unit;
      $("#" + b + "Go").onclick = () => {
        const { out, bad } = parseNums(kind, $("#" + b + "In").value);
        if (bad.length) { toast("看不懂：" + bad.slice(0, 5).join("、") + (bad.length > 5 ? "…" : "") + `（格式「座號:${u}」，${u} ${NUM[kind].min}–${NUM[kind].max}）`); return; }
        if (!out.size) { toast("沒有貼上任何" + u); return; }
        out.forEach((v, n) => { bySeat.get(n)[kind] = v; });
        const kept = saveNums(kind);
        $("#" + b + "In").value = "";
        toast(`已套用 ${out.size} 人${u}` + (kept ? "" : "（這台電腦記不住，關掉頁面就會消失）"));
        regen();
      };
      $("#" + b + "Clear").onclick = () => {
        students.forEach(s => { s[kind] = null; });
        try { localStorage.removeItem(NUM[kind].key); } catch (e) {}
        toast("已清除這台電腦的" + u); regen();
      };
    }
    $("#relList").addEventListener("click", ev => {
      const b = ev.target.closest("[data-del]"); if (!b) return;
      relations.splice(Number(b.dataset.del), 1); regen();
    });
    const opts = students.map(s => `<option value="${s.seat}">座號${s.seat} ${esc(s.name)}</option>`).join("");
    $("#ra").innerHTML = opts; $("#rb").innerHTML = opts;
    if (students[1]) $("#rb").value = String(students[1].seat);
    $("#rk").innerHTML = Object.entries(REL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    $("#addRel").onclick = () => {
      const a = Number($("#ra").value), b = Number($("#rb").value), k = $("#rk").value;
      if (a === b) return toast("請選兩位不同的學生");
      relations = relations.filter(r => key2(r.a, r.b) !== key2(a, b));
      relations.push({ a, b, k }); toast("已加入，座位重新排好"); regen();
    };
    const pick = el => {
      if (!el || view !== "plan") return;
      const i = Number(el.dataset.i);
      if (selected == null || selected === i) { selected = selected === i ? null : i; render(); return; }
      if (locks.has(selected) || locks.has(i)) return toast("有一格已固定，先取消固定才能換");
      const a = plan[selected], b = plan[i];
      [plan[selected], plan[i]] = [b, a];
      toast(`${a ? "座號" + a : "空位"} ⇄ ${b ? "座號" + b : "空位"}`); selected = null; render();
    };
    $("#room").addEventListener("click", ev => pick(ev.target.closest(".desk")));
    $("#room").addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(ev.target.closest(".desk")); } });
    $("#view").addEventListener("click", ev => { const b = ev.target.closest("button"); if (!b) return; view = b.dataset.v; selected = null; render(); });
    $("#again").onclick = () => { seed++; view = "plan"; regen(); toast(`換成第 ${seed} 份建議`); };
    $("#apply").onclick = openApply;
    document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());
    $("#applyGo").onclick = doApply;
  }

  function prevMonthLabel() { const m = new Date().getMonth(); return MONTH[(m + 11) % 12] + "月"; }

  function openApply() {
    if (busy) return;
    const e = SP.evaluate(input(), plan, { detail: true }), nm = e.counts.must;
    const same = SP.formatGrid({ rows: room.rows, cols: room.cols, assign: plan }) === SP.formatGrid(current);
    $("#applyMsg").innerHTML = nm ? `<span class="bdl">⚠️ 還有 ${nm} 件「必須」沒做到</span>，確定要用這份嗎？` : "這份建議「必須」的條件全部做到。按確認後：";
    $("#applySteps").innerHTML = (same ? `<li>座位和目前一樣，不封存、只更新條件。</li>` :
      `<li>現在的座位封存成「座位表（${prevMonthLabel()}）」（已有同名就加（2）），下次排座用來比對「不和上次同座」。</li><li>新座位寫入 Notion「⚙️ 網站設定」的「座位表」。</li>`) +
      `<li>易分心、需協助、小老師與人際關係存進 Notion「🪑 座位條件」；<b>🦻 聽力、視力、身高不會送出</b>（只在這台電腦）。</li><li>班網約 1 分鐘後換新；班網只顯示座位和遮罩姓名。</li>`;
    $("#dlgApply").showModal();
  }

  async function doApply() {
    if (busy) return;
    busy = true; $("#applyGo").disabled = true; $("#apply").disabled = true;
    const conditions = [];
    students.forEach(s => s.tags.forEach(t => { if (TRAITS[t].chip && !TRAITS[t].health) conditions.push({ seat: s.seat, kind: t }); }));
    relations.forEach(r => conditions.push({ seat: r.a, kind: r.k, other: r.b }));
    const grid = SP.formatGrid({ rows: room.rows, cols: room.cols, assign: plan });
    setStatus("更新中…（請不要關掉頁面）");
    try {
      const r = await call({ action: "seat_apply", grid, conditions });
      $("#dlgApply").close();
      if (!r.ok) { setStatus("❌ " + (r.error || "更新失敗"), true); toast("沒有更新成功，畫面保留，可以再按一次"); return; }
      current = { rows: room.rows, cols: room.cols, assign: plan.slice() };
      const syncMsg = r.sync && r.sync.ok ? "班網同步已觸發，約 1 分鐘後換新" : "⚠️ 班網同步沒觸發成功，請到教師專區按「立即更新班網」";
      setStatus(`✅ 已更新座位表${r.archived ? `（舊座位封存成「${r.archived}」）` : "（座位沒變，未封存）"}；條件新增 ${r.added}、取消 ${r.cancelled}。${syncMsg}`, !(r.sync && r.sync.ok));
      toast("座位已送出");
      render();
    } catch (err) {
      if (err.message !== "口令錯誤") { setStatus("❌ 連不到代理：" + err.message + "（畫面保留，可以再按一次）", true); $("#dlgApply").close(); }
    } finally {
      busy = false; $("#applyGo").disabled = false; $("#apply").disabled = false;
    }
  }

  // ── 啟動 ──
  async function init() {
    if (!SP) { gate("頁面載入不完整，請重新整理。"); return; }
    if (!pw()) { gate(); return; }
    $("#app").hidden = false;
    let r;
    try { r = await call({ action: "seat_get" }); }
    catch (err) { if (err.message !== "口令錯誤") setStatus("❌ 連不到代理：" + err.message, true); return; }
    if (!r.ok) { setStatus("❌ " + (r.error || "讀取失敗"), true); return; }
    students = r.students.map(s => ({ seat: s.seat, name: s.name, sex: s.sex, tags: new Set() }));
    bySeat = new Map(students.map(s => [s.seat, s]));
    r.conditions.forEach(c => {
      if (c.other != null) { relations = relations.filter(x => key2(x.a, x.b) !== key2(c.seat, c.other)); relations.push({ a: c.seat, b: c.other, k: c.kind }); }
      else if (bySeat.has(c.seat) && TRAITS[c.kind] && TRAITS[c.kind].chip) bySeat.get(c.seat).tags.add(c.kind);   // 舊「身高高」列改由身高推算，不讀
    });
    loadHealth();
    loadNums();
    const msgs = [];
    try {
      current = SP.parseGrid(r.grid);
      room = { rows: current.rows, cols: current.cols };
      const gone = current.assign.filter(s => s != null && !bySeat.has(s));
      if (gone.length) msgs.push(`目前座位表有名冊沒有的座號 ${gone.join("、")}（建議座位不會排他們）`);
    } catch (err) {
      msgs.push(r.gridMissing ? "⚙️ 網站設定找不到「座位表」列，確認前請先建好" : `目前座位表讀不懂（${err.message}），先用 5 排 × 6 欄`);
      room = { rows: 5, cols: 6 };
      current = { rows: 5, cols: 6, assign: Array(30).fill(null) };
    }
    if (r.skipped && r.skipped.length) msgs.push(`有 ${r.skipped.length} 筆座位條件對不到在學學生，沒有用：${r.skipped.join("、")}`);
    setStatus(`${r.year} 學年・${students.length} 人・${room.rows} 排 × ${room.cols} 欄。` + (msgs.length ? "⚠️ " + msgs.join("；") : ""), msgs.length > 0);
    bind();
    regen();
  }
  init();
})();
