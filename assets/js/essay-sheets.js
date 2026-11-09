/* 教師專區「📝 作文說明單」（SPEC_作文說明單 §4，老師 2026-11-09）
 * - 題目清單＝data/essay-sheets.json（公開、無個資）：三版 PDF 下載＋網頁版連結，檔案都在教材庫 lessons/。依課次排序。
 * - 分層名單＋作文分析＝data/essay-tiers.json（教師口令加密，只有座號）。
 *   已登入（sessionStorage 有口令）就自動解開：卡片上方顯示全班彙總（不含座號，投影也安全）；
 *   含座號的分析細節與「誰用哪一版」一律收合，點開才顯示。
 * - 作文分析＝同題目的「作文批改」報告列彙整（sync-notion.mjs → scripts/lib/essay-analysis.mjs），沒批改就顯示「尚未批改」。
 * - 做新的一課：一句話交辦「作文說明單：第○課〈題目〉」→ 路由 R21 → 收件匣待審，老師在 Claude Code 對話中完成。 */
(function () {
  const LESSONS = "https://flyshan2010.github.io/lessons/";
  const TIERS = ["基礎版", "進階版", "挑戰版"];
  const COL = { 基礎版: "#2f9e44", 進階版: "#1c7ed6", 挑戰版: "#e8590c" };
  const GV = { 優: 8, 甲上: 7, 甲: 6, 甲下: 5, 乙上: 4, 乙: 3, 乙下: 2 };
  const VG = Object.fromEntries(Object.entries(GV).map(([k, v]) => [v, k]));
  const GC = { 優: "#1b5e20", 甲上: "#2f9e44", 甲: "#66a80f", 甲下: "#f59f00", 乙上: "#e8590c", 乙: "#c92a2a", 乙下: "#862e9c" };
  const DIMS = { 版面: "檢查", 文字標點: "技巧", 段落結構: "組織", 主旨切題: "審題", 創意真情: "選材" };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fileOf = (s, tier) => s.file.replace("{版}", tier);
  const href = (s, tier, ext) => LESSONS + encodeURIComponent(s.folder) + "/" + encodeURIComponent(fileOf(s, tier) + ext);
  const pct = v => Math.max(0, Math.min(100, (v - 2) / 6 * 100)); // 乙下2～優8
  const g2 = x => VG[Math.floor(x + 0.5)] || "";

  // 「第十二課」→ 12；認不得排最後
  const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function lessonNo(s) {
    const m = String(s.lesson || s.name || "").match(/第([一二三四五六七八九十\d]+)課/);
    if (!m) return 999;
    if (/^\d+$/.test(m[1])) return Number(m[1]);
    const [a, b] = m[1].split("十");
    return m[1].includes("十") ? (CN[a] || 1) * 10 + (CN[b] || 0) : CN[m[1]] || 999;
  }

  let tiersP = null, tiersData = null; // 同一頁只解一次

  const tierCol = (s, tier) => `
    <div class="es-tier" style="border-top:4px solid ${COL[tier]};padding:6px 10px;background:#fafafa;border-radius:8px">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <b style="color:${COL[tier]};margin-right:2px">${tier}</b>
        <a class="badge" href="${href(s, tier, ".pdf")}" download="${esc(fileOf(s, tier))}.pdf">⬇️ PDF</a>
        <a class="badge" href="${href(s, tier, ".html")}" target="_blank" rel="noopener">🌐 網頁版</a>
      </div>
      <div class="es-seats meta" data-tier="${tier}" style="margin-top:4px"></div>
    </div>`;

  const card = s => `
    <div class="es-sheet" data-id="${esc(s.id)}" style="border:1px solid #eee;border-radius:10px;padding:10px 12px;margin-top:10px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">
        <div><span style="background:#333;color:#fff;border-radius:6px;padding:0 8px;margin-right:6px;font-size:.9em">${esc(s.lesson || "")}</span><b>${esc(s.topic || s.name)}</b></div>
        <span class="meta">${esc(s.genre)} <span class="es-status"></span></span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-top:8px">
        ${TIERS.map(t => tierCol(s, t)).join("")}
      </div>
      <div class="es-kpi" style="margin-top:8px"></div>
      <details class="es-ana" style="margin-top:8px">
        <summary class="meta" style="cursor:pointer">📊 作文分析（點開看細節；含座號）</summary>
        <div class="es-ana-body" style="margin-top:6px"></div>
      </details>
      <details class="es-who" style="margin-top:6px">
        <summary class="meta" style="cursor:pointer">👥 誰用哪一版（點開才顯示；只顯示座號）</summary>
        <div class="es-who-body meta" style="margin-top:6px"></div>
      </details>
    </div>`;

  // ── 作文分析 ──
  const kpiTile = (label, val, sub, warn) => `<div style="background:#fafafa;border-radius:8px;padding:6px 10px">
    <small class="meta" style="display:block">${label}</small><b style="font-size:1.15em;${warn ? "color:#c0392b" : ""}">${val}</b> <span class="meta">${sub || ""}</span></div>`;
  const hbar = (label, v, txt, hot) => `<div style="display:grid;grid-template-columns:5.5em 1fr 3em;gap:6px;align-items:center;font-size:.88em;margin:3px 0;${hot ? "color:#c0392b;font-weight:600" : ""}">
    <span>${label}</span><div style="background:#f1f3f5;border-radius:4px;height:12px"><div style="height:12px;border-radius:4px;width:${pct(v)}%;background:${hot ? "#c0392b" : "#8aa4c8"}"></div></div><span>${txt}</span></div>`;
  const chip = s => `<span style="display:inline-block;background:#f1f3f5;border-radius:6px;padding:1px 7px;margin:2px;font-size:.85em">${s}</span>`;

  function kpi(a) {
    const need = a.rows.filter(r => r.flags.length).length, low = a.rows.filter(r => GV[r.final] <= 4).length;
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
      ${kpiTile("繳交／批改", `${a.done}／${a.roster}`, a.missing.length ? `未交 ${a.missing.length}` : "全班到齊")}
      ${kpiTile("總評中位數", a.median || "—", `甲上以上 ${(a.dist["優"] || 0) + (a.dist["甲上"] || 0)} 人`)}
      ${a.weakest ? kpiTile("全班最弱", esc(a.weakest.dim), `→ 步驟「${esc(a.weakest.step)}」`, true) : ""}
      ${kpiTile("要看原稿", `${need} 篇`, `乙上以下 ${low} 人`, need > 0)}
    </div>`;
  }

  function detail(a) {
    const dist = Object.entries(a.dist).filter(([, c]) => c);
    const bar = `<div style="display:flex;height:22px;border-radius:6px;overflow:hidden;font-size:.75em;color:#fff">${dist.map(([k, c]) =>
      `<div style="flex:${c};background:${GC[k]};display:flex;align-items:center;justify-content:center;min-width:0" title="${k} ${c} 人">${k} ${c}</div>`).join("")}</div>`;
    const avgs = Object.entries(a.avg).filter(([, v]) => v != null);
    const bt = a.bytier;
    const tierWarn = bt["進階版"] && bt["基礎版"] && bt["進階版"].avg <= bt["基礎版"].avg
      ? `<p style="color:#c0392b;font-size:.85em;margin:4px 0">⚠️ 進階版平均（${bt["進階版"].avg}）沒有高於基礎版（${bt["基礎版"].avg}），下一課分層要不要調整？</p>` : "";
    const sug = [];
    if (a.weakest) sug.push(`全班最弱「${esc(a.weakest.dim)}」（${a.weakest.avg.toFixed(1)}）→ 下一課說明單加強步驟「${esc(a.weakest.step)}」的範例與檢查項。`);
    if (a.wc && a.wc.under300) sug.push(`字數未達 300 有 ${a.wc.under300} 人（未達 250：${a.wc.under250} 人，最少 ${a.wc.min} 字）→ 選材步驟多給「再寫一個畫面」的提示。`);
    if (a.typos.length) sug.push(`最常見錯字：${a.typos.slice(0, 3).map(x => esc(x[0])).join("、")} → 可排進聯絡簿訂正。`);
    if (a.missing.length) sug.push(`還沒批改：座號 ${a.missing.join("、")}。`);
    const flagged = a.rows.filter(r => r.flags.length);
    const h4 = t => `<h4 style="margin:.6em 0 .3em;font-size:.95em">${t}</h4>`;
    const cell = v => (v ? VG[v] : "—");
    return `<p class="meta" style="margin:0">最近批改 ${esc(a.date)}・已勾發布 ${a.published}／${a.done}</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
        <div>${h4("總評分布")}${bar}${h4("五分項全班平均（優＝8）")}${avgs.map(([k, v]) => hbar(esc(k), v, v.toFixed(1), a.weakest && k === a.weakest.dim)).join("")}</div>
        <div>${h4("分層有沒有分對？（各版平均總評）")}${Object.keys(bt).length ? Object.entries(bt).map(([t, x]) => hbar(t, x.avg, g2(x.avg))).join("") + tierWarn : `<p class="meta">沒有分層名單可對照。</p>`}
          ${h4("這一篇的最弱步驟（人數）")}${Object.entries(a.weak).sort((x, y) => y[1] - x[1]).map(([k, c]) => chip(`${esc(k)} ${c}`)).join("")}</div>
        <div>${h4("高頻錯字（從抓漏評語擷取）")}${a.typos.length ? a.typos.map(([k, c]) => chip(esc(k) + (c > 1 ? ` ×${c}` : ""))).join("") : `<p class="meta">沒有擷取到。</p>`}
          ${a.wc ? `<p class="meta">字數平均 ${a.wc.avg}・最少 ${a.wc.min}</p>` : ""}</div>
        <div>${h4("🌟 可以唸給全班聽的句子")}${a.shine.map(x => `<div style="font-size:.88em;margin:4px 0;padding-left:8px;border-left:3px solid #ddd">${esc(x.s)}<span class="meta">（${x.seat} 號）</span></div>`).join("") || `<p class="meta">—</p>`}</div>
      </div>
      ${sug.length ? `<div style="background:#eef6ff;border-left:4px solid #1c7ed6;padding:6px 12px;border-radius:6px;font-size:.92em;margin-top:10px"><b>🎯 下一課怎麼教（程式依數據產生）</b><ul style="margin:4px 0;padding-left:1.2em">${sug.map(s => `<li>${s}</li>`).join("")}</ul></div>` : ""}
      ${flagged.length ? `<p style="margin:8px 0 0"><b>🔎 要看原稿：</b>${flagged.map(r => chip(`<b>${r.seat}</b> ${r.flags.map(esc).join("、")}`)).join("")}</p>` : ""}
      <details style="margin-top:8px"><summary class="meta" style="cursor:pointer">座號明細（${a.rows.length} 人）</summary>
        <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.85em;text-align:center">
          <tr><th>座號</th><th>版本</th><th>總評</th><th>版面</th><th>文字</th><th>結構</th><th>主旨</th><th>創意</th><th>最弱步驟</th><th>字數</th><th>需人工</th></tr>
          ${a.rows.map(r => `<tr style="border-top:1px solid #eee"><td>${r.seat}</td><td>${esc(r.tier.replace("版", "")) || "—"}</td>
            <td style="color:${GC[r.final] || "#999"};font-weight:700">${esc(r.final) || "—"}</td>
            ${Object.keys(DIMS).map(k => `<td>${cell(r.dims[k])}</td>`).join("")}<td>${esc(r.weak) || "—"}</td><td>${r.wc ?? "—"}</td>
            <td style="color:#c0392b;text-align:left">${r.flags.map(esc).join("、")}</td></tr>`).join("")}
        </table></div></details>`;
  }

  function fillAnalysis(box, entry) {
    const a = entry && entry.analysis, st = box.querySelector(".es-status");
    if (!a) {
      st.innerHTML = `<span style="background:#f1f3f5;color:#666;border-radius:99px;padding:1px 8px;font-size:.85em">⏳ 尚未批改</span>`;
      box.querySelector(".es-kpi").innerHTML = "";
      box.querySelector(".es-ana-body").innerHTML = `<p class="meta">這一題批改完（Notion 學習報告「作文批改」、作文_題目＝本題），班網同步後這裡會自動出現分析。</p>`;
      return;
    }
    st.innerHTML = `<span style="background:#e6f4ea;color:#2f9e44;border-radius:99px;padding:1px 8px;font-size:.85em">✅ 已批改 ${a.done}/${a.roster}</span>`;
    box.querySelector(".es-kpi").innerHTML = kpi(a);
    box.querySelector(".es-ana-body").innerHTML = detail(a);
  }

  function fillTiers(box, entry) {
    const body = box.querySelector(".es-who-body");
    if (!entry) { body.textContent = "這一題還沒有分層名單（班網同步後才會出現）。"; return; }
    if (entry.error) { body.innerHTML = `<span style="color:#c0392b">${esc(entry.error)}</span>`; return; }
    const tiers = entry.tiers || {};
    box.querySelectorAll(".es-seats").forEach(el => {
      const list = tiers[el.dataset.tier] || [];
      el.innerHTML = list.length
        ? `<b>${list.length} 人</b>：` + list.map(([seat, weak]) => `${seat}${weak ? `<small style="color:#888">(${esc(weak)})</small>` : ""}`).join("、")
        : "（無）";
    });
    const extra = Object.keys(tiers).filter(k => !TIERS.includes(k));
    body.innerHTML = (entry.note ? esc(entry.note) : "名單已顯示在各版下方。") +
      (extra.length ? `<br><span style="color:#c0392b">另有：${extra.map(k => `${esc(k)} ${tiers[k].map(x => x[0]).join("、")}`).join("；")}</span>` : "");
  }

  // 解開後：所有卡片的狀態與彙總一次填好；名單只在點開「誰用哪一版」時填
  function applyAll(root) {
    root.querySelectorAll(".es-sheet").forEach(box => fillAnalysis(box, tiersData.tiers?.[box.dataset.id]));
    root.querySelectorAll(".es-who[open]").forEach(det => fillTiers(det.closest(".es-sheet"), tiersData.tiers?.[det.closest(".es-sheet").dataset.id]));
  }

  async function tryAuto() {
    try { const r = await (tiersP ||= window.TeacherDash.unlock("data/essay-tiers.json")); if (r.data) { tiersData = r.data; return "ok"; } tiersP = null; return "need"; }
    catch { tiersP = null; return "none"; }
  }

  function askPw(body, root) {
    body.innerHTML = `<span>口令和登入口令不同，請輸入設定 TEACHER_DASH_PW 時用的口令：</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"><input class="es-pw" type="password" autocomplete="off" placeholder="儀表板口令"
        style="flex:1;min-width:0;padding:6px;border:1px solid #ccc;border-radius:8px" /><button class="es-pw-btn emotion-draw" style="margin:0;width:auto;padding:6px 14px">解開</button></div>`;
    const go = async () => {
      const pw = body.querySelector(".es-pw").value.trim(); if (!pw) return;
      const r2 = await window.TeacherDash.unlock("data/essay-tiers.json", pw).catch(() => ({ need: true }));
      if (!r2.data) { body.querySelector(".es-pw").value = ""; body.querySelector(".es-pw").placeholder = "口令不正確"; return; }
      tiersP = Promise.resolve(r2); tiersData = r2.data; applyAll(root);
    };
    body.querySelector(".es-pw-btn").onclick = go;
    body.querySelector(".es-pw").onkeydown = e => { if (e.key === "Enter") go(); };
  }

  async function onOpen(det, root) {
    const box = det.closest(".es-sheet"), body = det.querySelector(".es-who-body, .es-ana-body");
    if (!tiersData) {
      body.textContent = "解密中…";
      const st = await tryAuto();
      if (st === "none") { body.textContent = "還沒有分層／分析檔（班網同步後才會出現）。"; return; }
      if (st === "need") { askPw(body, root); return; }
      applyAll(root);
    }
    if (det.classList.contains("es-who")) fillTiers(box, tiersData.tiers?.[box.dataset.id]);
  }

  window.EssaySheets = {
    async mount() {
      const el = document.getElementById("essay-body");
      if (!el) return;
      let sheets = [];
      try { sheets = (await App.fetchJSON("data/essay-sheets.json")).sheets || []; } catch { /* 下面顯示空 */ }
      sheets.sort((a, b) => lessonNo(a) - lessonNo(b) || String(a.name).localeCompare(String(b.name)));
      el.innerHTML = sheets.length ? sheets.map(card).join("") : `<p class="empty-hint">還沒有已上線的作文說明單。</p>`;
      el.querySelectorAll(".es-ana, .es-who").forEach(det =>
        det.addEventListener("toggle", () => { if (det.open) onOpen(det, el); }));
      // 已登入就自動解開，卡片上方直接顯示全班彙總（不含座號）
      if (sheets.length && (await tryAuto()) === "ok") applyAll(el);
    },
  };
})();
