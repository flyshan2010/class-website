/* 教師專區「📊 全班學習儀表板」（BR 線 P2，老師 2026-10-16 定案；版面照 系統工作流參考資料/學習報告Dashboard_範例/2_…）
 * - 預設收合（避免學生一眼看到），點開才抓 data/teacher-dashboard.json 並解密。
 * - 加密同學生報告（PBKDF2＋AES-GCM），金鑰材料＝「teacher:口令」；口令先用登入教師專區時那一組，
 *   解不開才請老師另輸入（GitHub secret TEACHER_DASH_PW 與代理口令不同時）。
 * - 只顯示座號；「需要關注」一律交給 LearningWatch（assets/js/learning-watch.js，唯一一份規則）。 */
(function () {
  const DIMS = ["國語", "數學", "社會", "人際互動", "生活技能"];
  const COL = { "國語": "#c2185b", "數學": "#2a78d6", "社會": "#eda100", "人際互動": "#e8590c", "生活技能": "#1baf7a" }; // 方案 A
  const RAMP = ["#e8f1fc", "#b9d4f5", "#86b6ef", "#5698e3", "#2a78d6", "#1b56a0"];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const bin = v => RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.floor((v - 1) / 4 * RAMP.length)))];
  const r1 = v => Math.floor(v * 10 + 0.5) / 10; // 禁用銀行家捨入
  const b64d = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
  const shortWeek = label => String(label).replace(/^(\S{2})第(\d+)週$/, "$1第 $2 週");

  async function decrypt(payload, pw) {
    const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(`teacher:${pw}`), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64d(payload.salt), iterations: 150000, hash: "SHA-256" },
      baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(payload.iv) }, key, b64d(payload.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  const spark = (vals, col, labels) => {
    const pts = vals.map((v, i) => [i, v]).filter(([, v]) => v != null);
    if (pts.length < 2) return "";
    const W = 200, H = 64, pad = 6, n = vals.length;
    const x = i => pad + i * (W - pad * 2) / Math.max(1, n - 1), y = v => H - pad - (v - 1) / 4 * (H - pad * 2);
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="dash-spark" role="img" aria-label="逐週趨勢">
      <line x1="${pad}" x2="${W - pad}" y1="${y(3)}" y2="${y(3)}" stroke="#e6e2d6" stroke-dasharray="3 3"/>
      <polyline points="${pts.map(([i, v]) => `${x(i)},${y(v)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(last[0])}" cy="${y(last[1])}" r="4" fill="${col}" stroke="#fff" stroke-width="2"/>
      ${pts.map(([i, v]) => `<rect x="${x(i) - 12}" y="0" width="24" height="${H}" fill="transparent"><title>${esc(labels[i])}：${v}</title></rect>`).join("")}</svg>`;
  };

  function render(body, D, w, focusSeat, aw) {
    const N = D.seats.length;
    const cnt = { "已發布": 0, "待勾發布": 0, "尚未產生": 0 };
    D.seats.forEach(s => { cnt[(D.status[s] || [])[w] || "尚未產生"]++; });
    const pending = D.seats.filter(s => (D.status[s] || [])[w] !== "已發布");
    const J = window.LearningWatch.judgeClass(D.scores, D.seats, w);
    const rec = D.records[w], recPrev = w ? D.records[w - 1] : null;
    const recDelta = rec == null || recPrev == null ? `<span class="dash-delta flat">${rec == null ? "週次日期對不上，需人工" : "—"}</span>`
      : rec > recPrev ? `<span class="dash-delta up">▲ ${rec - recPrev} 比上週</span>`
      : rec < recPrev ? `<span class="dash-delta down">▼ ${recPrev - rec} 比上週</span>` : `<span class="dash-delta flat">● 與上週持平</span>`;
    const E = D.essay;
    const labels = D.weeks.map(x => shortWeek(x.label));
    const val = (s, d, k) => ((D.scores[s] || {})[d] || [])[k] ?? null;

    // 全班平均：只算有分數的人（缺資料不當 0 拉低平均），並標出人數
    const avgOf = (d, k) => {
      const v = D.seats.map(s => val(s, d, k)).filter(x => x != null);
      return v.length ? { avg: r1(v.reduce((a, b) => a + b, 0) / v.length), n: v.length } : null;
    };

    const detail = focusSeat != null ? `
      <div class="dash-card dash-seat" style="margin-top:10px">
        <h4>${focusSeat} 號・五向度逐週 <small>同一刻度 1–5</small>
          <button class="dash-go" data-close style="float:right">✕ 關閉</button></h4>
        <div class="dash-multiples">${DIMS.map(d => {
          const vals = D.weeks.map((_, k) => val(focusSeat, d, k));
          const now = vals[w];
          return `<div><div class="dash-sm-name"><i style="background:${COL[d]}"></i>${d}</div>
            <div class="dash-sm-now">${now == null ? `<span class="meta">無</span>` : now}</div>
            ${spark(vals.slice(0, w + 1), COL[d], labels)}</div>`;
        }).join("")}</div>
        <p class="meta" style="margin:6px 0 0">完整個人報告（含各科建議、作品）請到
          <a href="report.html#seat=${focusSeat}" target="_blank" rel="noopener">學習報告頁</a>，需輸入該生查詢碼。</p>
      </div>` : "";

    body.innerHTML = `
      <div class="dash-kpis">
        <div class="dash-kpi"><div class="k">📊 本週報告已發布</div><div class="v">${cnt["已發布"]}<small> / ${N}</small></div>
          <span class="dash-delta flat">待勾 ${cnt["待勾發布"]}・未產生 ${cnt["尚未產生"]}</span></div>
        <div class="dash-kpi"><div class="k">⚠️ 需要關注</div><div class="v">${J.watch.length}<small> 項</small></div>
          <span class="dash-delta flat">另 ${J.manual.length} 項需人工</span></div>
        <div class="dash-kpi"><div class="k">📝 本週紀錄</div><div class="v">${rec == null ? "—" : rec}<small> 筆</small></div>${recDelta}</div>
        <div class="dash-kpi"><div class="k">✍️ 作文已批</div><div class="v">${E ? E.graded : 0}<small> / ${N}</small></div>
          <span class="dash-delta flat" title="${esc(E ? E.title : "")}">${E ? `最近：${esc(E.title || "（未填題目）")}・已發布 ${E.published}` : "還沒有作文批改"}</span></div>
      </div>
      <div class="dash-row">
        <div class="dash-card">
          <h4>${esc(labels[w])}五向度熱度圖 <small>越深分數越高；滑過看數值，點座號看個人逐週</small></h4>
          <div class="heat">
            <div></div>${DIMS.map(d => `<div class="hd">${d}</div>`).join("")}
            ${D.seats.map(s => `<button class="rl${s === focusSeat ? " on" : ""}" data-seat="${s}" title="看 ${s} 號五向度逐週">${s} 號</button>${DIMS.map(d => {
              const v = val(s, d, w), p = w ? val(s, d, w - 1) : null;
              const draft = (D.status[s] || [])[w] === "待勾發布" ? "・草稿" : "";
              return v == null
                ? `<div class="cell nodata" title="${s} 號・${d}：無分數（需人工）"></div>`
                : `<div class="cell" style="background:${bin(v)}" title="${s} 號・${d}：${v}${p != null ? `（上週 ${p}）` : ""}${draft}"></div>`;
            }).join("")}`).join("")}
          </div>
          <div class="ramp">1 分 ${RAMP.map(c => `<span style="background:${c}"></span>`).join("")} 5 分　<span class="nodata" style="width:22px"></span> 無資料</div>
          ${detail}
        </div>
        <div>
          <div class="dash-card">
            <h4>⚠️ 需要關注 <small>連 2 週下滑且累計 ≥0.5，或低於 2 分</small></h4>
            <ul class="watch">
              ${J.watch.map(x => `<li><strong>${x.seat} 號</strong> <span class="wtag" style="--c:${COL[x.dim]}">${x.dim}</span> ${esc(x.reason)}</li>`).join("")
                || "<li class='meta'>本週沒有符合條件的學生</li>"}
              ${J.manual.map(x => `<li><strong>${x.seat} 號</strong> <span class="wtag"${COL[x.dim] ? ` style="--c:${COL[x.dim]}"` : ""}>${x.dim}</span> ${esc(x.reason)} → <em>需人工</em></li>`).join("")}
            </ul>
          </div>
          <div class="dash-card" style="margin-top:12px">
            <h4>本週報告發布進度</h4>
            <div class="progress">${[["已發布", "#2a78d6"], ["待勾發布", "#86b6ef"], ["尚未產生", "#d5d2c8"]].map(([k, c]) =>
              `<span style="flex:${cnt[k] || 0.0001};background:${c}" title="${k} ${cnt[k]} 份"></span>`).join("")}</div>
            <p class="meta" style="margin:6px 0 0">${pending.length ? `待處理：${pending.map(s => `${s} 號（${(D.status[s] || [])[w] || "尚未產生"}）`).join("、")}` : "全班都已發布 🎉"}</p>
          </div>
        </div>
      </div>
      <div class="dash-card" style="margin-top:12px">
        <h4>全班五向度平均・逐週 <small>每格一個向度，同一刻度 1–5；只算有分數的人</small></h4>
        <div class="dash-multiples">${DIMS.map(d => {
          const series = D.weeks.slice(0, w + 1).map((_, k) => avgOf(d, k));
          const now = series[w], prev = w ? series[w - 1] : null;
          const dd = now && prev ? r1(now.avg - prev.avg) : null;
          return `<div><div class="dash-sm-name"><i style="background:${COL[d]}"></i>${d}</div>
            <div class="dash-sm-now">${now ? now.avg.toFixed(1) : "—"}</div>
            <span class="dash-delta ${dd > 0 ? "up" : dd < 0 ? "down" : "flat"}">${dd == null ? (now ? `${now.n} 人` : "無資料") : dd > 0 ? `▲ ${dd}` : dd < 0 ? `▼ ${-dd}` : "● 持平"}</span>
            ${spark(series.map(x => x && x.avg), COL[d], labels)}</div>`;
        }).join("")}</div>
      </div>
      ${window.AssessView ? window.AssessView.teacher(D.assess, aw) : ""}
      <p class="meta" style="margin-top:8px">資料更新：${esc(new Date(D.generatedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }))}（每次同步班網時重算；草稿報告也算進熱度圖，滑過會標「草稿」）</p>`;
  }

  function show(body, D) {
    if (!D.weeks.length) { body.innerHTML = `<p class="empty-hint">還沒有任何每週學習報告，產生報告後再同步班網就會出現。</p>`; return; }
    const sel = document.getElementById("dash-week");
    sel.innerHTML = D.weeks.map((x, i) => `<option value="${i}"${i === D.weeks.length - 1 ? " selected" : ""}>${esc(shortWeek(x.label))}</option>`).join("");
    sel.hidden = false;
    let w = D.weeks.length - 1, focus = null, aw = Math.max(0, (D.assess || []).length - 1);   // aw＝課堂作答選的週（自己一組，預設最新）
    const draw = () => render(body, D, w, focus, aw);
    sel.onchange = () => { w = +sel.value; draw(); };
    body.onchange = e => { if (e.target.matches("select[data-aw]")) { aw = +e.target.value; draw(); } };
    body.onclick = e => {
      const b = e.target.closest("[data-seat]");
      if (b) { const s = +b.dataset.seat; focus = focus === s ? null : s; draw(); return; }
      if (e.target.closest("[data-close]")) { focus = null; draw(); }
    };
    draw();
  }

  async function load(body) {
    body.innerHTML = `<p class="empty-hint">解密中…</p>`;
    let payload;
    try {
      const res = await fetch(`data/teacher-dashboard.json?t=${Date.now()}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(String(res.status));
      payload = await res.json();
    } catch {
      body.innerHTML = `<p class="empty-hint">尚未設定全班儀表板：班網同步還沒產出彙總檔（需要先設定 GitHub secret「TEACHER_DASH_PW」，見老師操作手冊）。</p>`;
      return;
    }
    const tryPw = async pw => { try { return await decrypt(payload, pw); } catch { return null; } };
    const saved = sessionStorage.getItem("teacherDashPw") || sessionStorage.getItem("teacherPw") || "";
    const D = saved ? await tryPw(saved) : null;
    if (D) return show(body, D);
    // 解不開：不洩漏任何內容，只請老師輸入儀表板口令
    body.innerHTML = `<p class="meta">儀表板口令和登入口令不同，請輸入設定 TEACHER_DASH_PW 時用的口令：</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="dash-pw" type="password" autocomplete="off" placeholder="儀表板口令"
        style="flex:1;min-width:0;padding:8px;border:1px solid #ccc;border-radius:8px" />
      <button id="dash-pw-btn" class="emotion-draw" style="margin:0;width:auto;padding:8px 18px">解開</button></div>
      <p class="meta" id="dash-pw-msg" style="color:#c0392b"></p>`;
    const go = async () => {
      const pw = document.getElementById("dash-pw").value.trim();
      if (!pw) return;
      const d = await tryPw(pw);
      if (!d) { document.getElementById("dash-pw-msg").textContent = "口令不正確。"; return; }
      sessionStorage.setItem("teacherDashPw", pw);
      show(body, d);
    };
    document.getElementById("dash-pw-btn").onclick = go;
    document.getElementById("dash-pw").onkeydown = e => { if (e.key === "Enter") go(); };
  }

  // 掛到教師專區：<details id="dash-details"> 第一次展開才載入
  window.TeacherDash = {
    mount() {
      const det = document.getElementById("dash-details"), body = document.getElementById("dash-body");
      if (!det || !body) return;
      let loaded = false;
      det.addEventListener("toggle", () => { if (det.open && !loaded) { loaded = true; load(body); } });
      document.querySelectorAll('a[href="#sec-dash"]').forEach(a => a.addEventListener("click", () => { det.open = true; }));
    },
  };
})();
