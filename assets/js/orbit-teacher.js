/* 教師專區「🌌 自學星圖」分頁（自學星圖 P3 第③步，SPEC_自學星圖_P3皇城四季與三種練習.md §4）
 * - 預設收合，點開才打代理 orbit_class（要教師口令；代理 v2.27）。點座號 → orbit_student 個人頁。
 * - 數字全部由代理的 classview.mjs 算好；這裡只負責畫，以及把代碼對照成名稱（班網公開的題本檔 data/study-orbit/*.json）。
 * - 只顯示座號、不排名（熱圖依座號排）；每格一個結論，點開才有明細（PLAN §六 第 2 點）。
 * - 退路：P3 SPEC §9 第③步——有問題只要把本區塊藏起來（teacher.js 的 MENU 與 sec-orbit），學生端不受影響。 */
(function () {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COL = { "國語": "#c2185b", "數學": "#2a78d6", "社會": "#eda100" }; // 同全班儀表板方案 A
  const ISLE = ["沒玩", "卡關（試過沒過）", "部分過關", "全過", "島心全金（寶箱開）"];
  const ISLE_MARK = ["", "!", "", "", "★"];
  const md = ymd => ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : "";
  let api = null, V = null, NAMES = null, curBook = null, curIsle = -1;

  // ---------- 名稱對照（公開檔）----------
  async function loadNames() {
    const idx = await App.fetchJSON("data/study-orbit/index.json");
    const N = { books: {}, level: {}, bs: {} };
    for (const b of idx.books || []) {
      N.books[b.code] = { subject: b.subject, islands: {} };
      for (const isl of (b.structure || {}).islands || []) {
        N.books[b.code].islands[isl.id] = isl.name;
        for (const l of isl.levels || []) N.level[l.code] = { name: l.name, isle: isl.name };
      }
    }
    await Promise.all((idx.books || []).map(async b => {
      try { const d = await App.fetchJSON(`data/study-orbit/${b.code}.json`); (d.blindspots || []).forEach(x => { N.bs[x.code] = x.name; }); } catch {}
    }));
    return N;
  }
  const bookOf = code => Object.keys(NAMES.books).filter(b => code.indexOf(b + "-") === 0).sort((a, b) => b.length - a.length)[0] || "";
  const subj = book => (NAMES.books[book] || {}).subject || book;
  /** 一關的名稱：「數學・一億以內的數 1-2 名稱」；虛擬島心＝「…・島心試煉」 */
  function levelLabel(book, key) {
    const full = book + "-" + key, l = NAMES.level[full];
    if (l) return `${subj(book)}・${l.isle}｜${l.name}`;
    const isl = (V.heat.find(h => h.book === book) || { islands: [] }).islands.find(x => x.core === key);
    return isl ? `${subj(book)}・${isl.name}｜島心試煉` : `${subj(book)} ${key}`;
  }
  function bsLabel(code) {
    const book = bookOf(code), lv = code.replace(/-B\d+$/, "");
    return { name: NAMES.bs[code] || code, where: levelLabel(book, lv.slice(book.length + 1)) };
  }
  /** 島的短名：國語一課一島、島名卻是單元名（同單元重複）→ 改用第一關名稱「・」前的課名 */
  function isleTitle(H, i) {
    const x = H.islands[i], dup = H.islands.filter(y => y.name === x.name).length > 1;
    if (!dup) return String(x.name).split(/[、，]/).pop();
    const k = x.keys[0] || x.core, l = NAMES.level[H.book + "-" + k];
    return l ? String(l.name).split("・")[0] : x.name + " " + (i + 1);
  }
  const seatList = a => a.map(s => typeof s === "object" ? `${s.seat}（${s.n} 張）` : s).join("、");

  // ---------- 全班 ----------
  function todoText(x) {
    if (x.t === "zero") return `座號 <b>${seatList(x.seats)}</b> 本週還沒自學（上週有 2 天以上）：可以問問看是不是登入或載具的問題。`;
    if (x.t === "stuck") return `<b>${esc(levelLabel(x.book, x.key))}</b>：${x.n} 人挑戰 2 次以上仍 0 星 → 建議課堂看一下這一關。`;
    if (x.t === "bs") { const b = bsLabel(x.code); return `盲點「<b>${esc(b.name)}</b>」（${esc(b.where)}）本週 ${x.n} 人拿到卡、還沒克服 → 列入下週重教。`; }
    if (x.t === "due") return `座號 <b>${seatList(x.seats)}</b> 有 3 張以上到期卡還沒確認：提醒打開卡冊按「確認」。`;
    if (x.t === "streak") return `👏 座號 <b>${seatList(x.seats)}</b> 連續自學 5 天以上，可以公開鼓勵。`;
    return "";
  }
  function kpis() {
    const K = V.kpi, early = V.weekStart < V.since;
    const note = early ? `<small class="orbit-since">週資料從 ${md(V.since)} 起</small>` : "";
    const tile = (k, v, sub, extra = "") => `<div class="dash-kpi"><div class="k">${k}</div><div class="v">${v}</div><span class="dash-delta flat">${sub}</span>${extra}</div>`;
    const stuckList = K.stuck.levels.length
      ? `<details class="orbit-more"><summary>看是哪幾關</summary><ul>${K.stuck.levels.map(x => `<li>${esc(levelLabel(x.book, x.key))}：${x.n} 人</li>`).join("")}</ul></details>` : "";
    return `<div class="dash-kpis">
      ${tile("本週自學 3 天以上", `${K.week3.n}<small>／${K.week3.of} 人</small>`, "目標：過半", note)}
      ${tile("全班亮度", `${K.bright.pct}<small>%</small>`, `${K.bright.lit}／${K.bright.of} 關次已過關`)}
      ${tile("卡關星", `${K.stuck.n}<small> 關</small>`, "≥3 人挑戰 2 次仍 0 星", stuckList)}
      ${tile("到期複習答對率", K.due.pct == null ? `<small>本週還沒有到期卡</small>` : `${K.due.pct}<small>%</small>`, K.due.tries ? `${K.due.pass}／${K.due.tries} 次・目標 70%` : "目標 70%", note)}
    </div>`;
  }
  function heat() {
    const H = V.heat.find(h => h.book === curBook) || V.heat[0];
    if (!H) return `<p class="empty-hint">還沒有題本。</p>`;
    const seats = Object.keys(H.rows).map(Number).sort((a, b) => a - b);
    const tabs = V.heat.map(h => `<button class="orbit-tab${h.book === H.book ? " on" : ""}" data-book="${esc(h.book)}" style="--c:${COL[h.subject] || "#57606f"}">${esc(h.subject || h.book)}</button>`).join("");
    const dayDots = s => { const w = V.week[s] || { n: 0 }; return `<td class="days" title="本週 ${w.n} 天">${"●".repeat(Math.min(w.n, 7))}<span>${"●".repeat(Math.max(0, 5 - w.n))}</span></td>`; };
    let head, cells, back = "";
    if (curIsle < 0) {
      head = H.islands.map((x, i) => `<th class="sh" data-i="${i}" title="${esc(x.name)}：點開看每一關">${esc(isleTitle(H, i).length > 7 ? isleTitle(H, i).slice(0, 6) + "…" : isleTitle(H, i))}</th>`).join("");
      cells = s => H.rows[s].map(v => `<td class="c i${v}" title="${ISLE[v]}">${ISLE_MARK[v]}</td>`).join("");
    } else {
      const isl = H.islands[curIsle], ks = isl.keys.concat([isl.core]);
      back = `<p class="orbit-back"><button class="orbit-tab" id="orbit-back">← 回到全部島</button> <b>${esc(isl.name)}・${esc(isleTitle(H, curIsle))}</b></p>`;
      head = ks.map(k => { const lab = k === isl.core ? "島心" : k; const l = NAMES.level[H.book + "-" + k]; return `<th title="${esc(l ? l.name : "島心試煉")}">${esc(lab)}</th>`; }).join("");
      cells = s => ks.map(k => { const v = H.detail[s][H.keys.indexOf(k)]; return `<td class="c l${v}${k === isl.core ? " core" : ""}" title="${v < 0 ? "沒玩" : v === 0 ? "卡關" : v + " 星"}">${v === 0 ? "!" : ""}</td>`; }).join("");
    }
    return `<div class="orbit-tabs">${tabs}</div>${back}
      <div class="orbit-hm"><table><thead><tr><th>座號</th>${head}<th>本週</th></tr></thead>
      <tbody>${seats.map(s => `<tr><td class="seat"><button data-seat="${s}" aria-label="看座號 ${s} 個人頁">${s}</button></td>${cells(s)}${dayDots(s)}</tr>`).join("")}</tbody></table></div>
      <div class="orbit-legend">${curIsle < 0
        ? ISLE.map((t, i) => `<span><i class="c i${i}">${ISLE_MARK[i]}</i>${t}</span>`).join("")
        : ["沒玩", "卡關", "1 星", "2 星", "3 星"].map((t, i) => `<span><i class="c l${i - 1}">${i === 1 ? "!" : ""}</i>${t}</span>`).join("") + `<span><i class="c l3 core"></i>圓形＝島心</span>`}</div>`;
  }
  function side() {
    const max = Math.max(1, ...V.bsTop.map(x => x.n));
    const bs = V.bsTop.length ? V.bsTop.map(x => { const b = bsLabel(x.code); return `<div class="orbit-bs"><span>${esc(b.name)}<br><small>${esc(b.where)}</small></span><span class="bar"><i style="width:${x.n / max * 100}%"></i></span><b>${x.n} 人</b></div>`; }).join("")
      : `<p class="empty-hint">本週還沒有人拿到新的盲點卡。</p>`;
    const U = V.usage, umax = Math.max(1, U.after, U.core, U.tower || 0);
    const bar = (t, n, c) => `<div class="orbit-use"><span>${t}</span><span class="bar"><i style="width:${n / umax * 100}%;background:${c}"></i></span><b>${n}</b></div>`;
    return `<div class="dash-card"><h4>🧩 本週最多人卡住的盲點 <small>本週拿到卡、還沒克服的人數</small></h4>${bs}</div>
      <div class="dash-card" style="margin-top:12px"><h4>三種練習的使用（本週回合數）${V.weekStart < V.since ? `<small>週資料從 ${md(V.since)} 起</small>` : ""}</h4>
        ${bar("島嶼點燈（課後練習）", U.after, "#1baf7a")}${bar("島心試煉", U.core, "#eda100")}
        ${bar("百鍊之塔（層次）", U.tower || 0, "#5a4fb8")}</div>${tower()}`;
  }
  /* 🗼 百鍊之塔各層人數（v2.28 起；沒有人玩過整塊不顯示）：一條＝停在該層（最高過到第 N 層）的人數 */
  function tower() {
    const T = V.tower;
    if (!T) return "";
    const max = Math.max(1, ...T.at.slice(1)), rows = [];
    let top = 0; T.at.forEach((n, i) => { if (n && i) top = i; });
    for (let f = Math.min(T.names.length, top + 1); f >= 1; f--) /* 只列到「有人到的最高層＋1」，空的高層不佔版面 */
      rows.push(`<div class="orbit-use"><span>第 ${f} 層・${esc(T.names[f - 1])}</span><span class="bar"><i style="width:${T.at[f] / max * 100}%;background:#5a4fb8"></i></span><b>${T.at[f]}</b></div>`);
    return `<div class="dash-card" style="margin-top:12px"><h4>🗼 百鍊之塔・數學算力階 <small>最高過到第幾層的人數；玩過 ${T.played} 人、還沒過第 1 層 ${T.at[0]} 人</small></h4>${rows.join("")}</div>`;
  }
  function render(body) {
    const miss = (V.missing || []).length ? `<p class="meta" style="color:#b3261e">⚠️ 有 ${V.missing.length} 本題本暫時讀不到 Notion 進度，部分學生先當「沒玩」顯示；稍後重新整理。</p>` : "";
    body.innerHTML = `<div class="dash-head"><span class="meta">資料時間 ${esc((V.at || "").slice(11, 16))}（每 60 秒更新一次）・在學 ${V.n} 人・只顯示座號</span>
        <button class="orbit-tab" id="orbit-reload">🔄 重新整理</button></div>${miss}
      ${kpis()}
      <div class="dash-card" style="margin-top:12px"><h4>📌 這週需要您看的事 <small>程式照順序挑，最多 5 句</small></h4>
        ${V.todo.length ? `<ul class="orbit-todo">${V.todo.map(x => `<li>${todoText(x)}</li>`).join("")}</ul>` : `<p class="empty-hint">這週沒有需要特別注意的事。</p>`}</div>
      <div class="dash-row">
        <div class="dash-card"><h4>全班 × 島 <small>點島名看每一關、點座號看個人頁</small></h4><div id="orbit-heat">${heat()}</div><div id="orbit-stu"></div></div>
        <div>${side()}</div>
      </div>`;
    wire(body);
  }
  function wire(body) {
    body.querySelector("#orbit-reload").onclick = () => load(body, true);
    const h = body.querySelector("#orbit-heat");
    h.querySelectorAll("[data-book]").forEach(b => b.onclick = () => { curBook = b.dataset.book; curIsle = -1; h.innerHTML = heat(); wire(body); });
    h.querySelectorAll("th.sh").forEach(t => t.onclick = () => { curIsle = Number(t.dataset.i); h.innerHTML = heat(); wire(body); });
    const bk = h.querySelector("#orbit-back"); if (bk) bk.onclick = () => { curIsle = -1; h.innerHTML = heat(); wire(body); };
    h.querySelectorAll("[data-seat]").forEach(b => b.onclick = () => student(body, Number(b.dataset.seat)));
  }

  // ---------- 個人頁 ----------
  async function student(body, seat) {
    const box = body.querySelector("#orbit-stu");
    box.innerHTML = `<div class="orbit-stu"><p class="empty-hint">讀取座號 ${seat}…</p></div>`;
    const S = await api("orbit_student", { seat }).catch(() => ({ ok: false, error: "連線失敗" }));
    if (!S.ok) { box.innerHTML = `<div class="orbit-stu"><p class="empty-hint">❌ ${esc(S.error || "讀取失敗")}</p></div>`; return; }
    const cons = S.books.map(b => `<div class="orbit-crow"><span class="sj" style="color:${COL[b.subject] || "#57606f"}">${esc(b.subject)}</span><div class="isles">${b.islands.map(x => {
      const dots = x.cells.map(v => `<i class="dot l${v}"></i>`).join("") + `<i class="dot dia l${x.coreCell}"></i>`;
      return `<span class="isle" title="${esc(x.name)}：${ISLE[x.state]}">${dots}${x.state === 4 ? "🎁" : ""}</span>`;
    }).join("")}</div></div>`).join("");
    const cards = S.books.flatMap(b => b.cards.filter(c => c.st !== "wait").map(c => ({ ...c, subject: b.subject })));
    const cardList = cards.length ? `<ul class="orbit-cards">${cards.map(c => { const n = bsLabel(c.code); return `<li><span class="tag ${c.st}">${c.st === "due" ? "7 天到了" : "待複習"}</span>${esc(n.name)} <small>${esc(n.where)}</small></li>`; }).join("")}</ul>` : `<p class="empty-hint">沒有待複習或到期的卡。</p>`;
    const wait = S.books.reduce((a, b) => a + b.cards.filter(c => c.st === "wait").length, 0), ok = S.books.reduce((a, b) => a + b.overcome, 0);
    box.innerHTML = `<div class="orbit-stu">
      <div class="orbit-stu-head"><b>座號 ${S.seat}</b><button class="orbit-tab" id="orbit-stu-close">關閉</button></div>
      <p class="meta">本週 <span class="orbit-week">${S.days.map((on, i) => `<i class="${on ? "on" : ""}">${"一二三四五六日"[i]}</i>`).join("")}</span>　連續 ${S.streak} 天
        島嶼點燈 ${S.usage.after} 回合・島心試煉 ${S.usage.core} 回合・百鍊之塔 ${S.usage.tower || 0} 層次${S.tower ? `（最高過到第 ${S.tower[0]} 層）` : ""}${S.weekStart < S.since ? `（週資料從 ${md(S.since)} 起）` : ""}</p>
      <h5>星座圖 <small>一點＝一關、一串＝一座島；菱形＝島心；顏色＝最高星等（紅＝試過沒過）</small></h5><div class="orbit-cons">${cons}</div>
      <h5>卡冊 <small>待確認 ${wait} 張・已結案 ${ok} 張</small></h5>${cardList}
      <p class="meta">個人頁給個別指導用；學生、家長看不到這一頁。</p></div>`;
    box.querySelector("#orbit-stu-close").onclick = () => { box.innerHTML = ""; };
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function load(body, force) {
    body.innerHTML = `<p class="empty-hint">讀取全班自學星圖…（第一次約 5–15 秒）</p>`;
    try {
      if (!NAMES) NAMES = await loadNames();
      const r = await api("orbit_class", force ? { t: Date.now() } : {});
      if (!r.ok) { body.innerHTML = `<p class="empty-hint">❌ ${esc(r.error || "讀取失敗")}${/未知的動作/.test(r.error || "") ? "（代理還不是 v2.27，請重新部署）" : ""}</p>`; return; }
      V = r; if (!curBook || !V.heat.some(h => h.book === curBook)) curBook = (V.heat[0] || {}).book;
      render(body);
    } catch (e) { body.innerHTML = `<p class="empty-hint">❌ 讀取失敗：${esc(e.message)}</p>`; }
  }

  window.OrbitTeacher = {
    mount(callApi) {
      const det = document.getElementById("orbit-details"), body = document.getElementById("orbit-body");
      if (!det || !body) return;
      api = callApi;
      let loaded = false;
      det.addEventListener("toggle", () => { if (det.open && !loaded) { loaded = true; load(body); } });
      document.querySelectorAll('a[href="#sec-orbit"]').forEach(a => a.addEventListener("click", () => { det.open = true; }));
    },
  };
})();
