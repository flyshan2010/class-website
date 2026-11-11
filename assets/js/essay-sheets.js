/* 教師專區「📝 作文說明單」（SPEC_作文說明單 §4，老師 2026-11-09）
 * - 題目清單＝data/essay-sheets.json（公開、無個資）：三版 PDF 下載＋網頁版連結，檔案都在教材庫 lessons/。
 * - 收合＋搜尋排序（老師 2026-11-11 定案範本）：每題收成一行，預設只展開「📌 下一篇」（今天以後最近的說明日）；
 *   日期跟課程進度走（date＝週四說明、hw＝週五當作業，sync 端算好；暑假作文 08/31）。
 *   排序：說明日期舊→新（預設）／新→舊／待批改優先／依文體分組；搜尋題目、課次、文體；篩狀態（解開後才有）、文體。
 *   排序、篩選、展開狀態記在本機 localStorage（只是便利，讀不到照預設）。
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

  // 「第十二課」→ 12；暑假作文排第一課之前；認不得排最後
  const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function lessonNo(s) {
    if (s.lesson === "暑假作文") return 0;
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

  const md = d => String(d || "").slice(5).replace("-", "/");
  const dateTxt = s => s.hw ? `📣 ${md(s.date)} 說明・✏️ ${md(s.hw)} 作業` : s.date ? `📅 ${md(s.date)}` : "";
  const card = (s, open, next, hl) => `
    <details class="es-sheet" data-id="${esc(s.id)}" ${open ? "open" : ""}>
      <summary>
        <span class="es-chev">▶</span>
        <span class="es-lesson">${hl(s.lesson || "")}</span><b class="es-topic">${hl(s.topic || s.name)}</b>
        ${next ? `<span class="es-next">📌 下一篇</span>` : ""}
        <span class="es-right">
          <span class="es-quick">${TIERS.map(t => `<a href="${href(s, t, ".pdf")}" download="${esc(fileOf(s, t))}.pdf" style="background:${COL[t]}" title="${t} PDF">${t[0]}</a>`).join("")}</span>
          <span class="meta">${hl(s.genre)}</span><span class="es-status"></span><span class="es-date" title="課程進度日期">${dateTxt(s)}</span>
        </span>
      </summary>
      <div class="es-body">
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
      </div>
    </details>`;

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
      tiersP = Promise.resolve(r2); tiersData = r2.data; applyAll(root); window.EssaySheets._rerender?.(); // 出現「狀態」篩選
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

  // ── 收合＋搜尋排序 ──
  const CSS = `
    #essay-body .es-bar{position:sticky;top:0;z-index:3;background:var(--card,#fff);padding:8px 0;border-bottom:1px solid #eee;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    #essay-body .es-bar input{flex:1 1 220px;min-width:0;padding:6px 10px;border:1px solid #ccc;border-radius:8px;font-size:1em}
    #essay-body .es-bar select,#essay-body .es-btn{padding:6px 8px;border:1px solid #ccc;border-radius:8px;background:#fff;font-size:.92em;cursor:pointer;color:inherit}
    #essay-body .es-chips{display:flex;flex-wrap:wrap;gap:6px;width:100%;align-items:center;font-size:.85em}
    #essay-body .es-chip{border:1px solid #d0d5db;background:#fff;border-radius:99px;padding:1px 10px;cursor:pointer;color:inherit;font-size:1em}
    #essay-body .es-chip[aria-pressed=true]{background:#333;color:#fff;border-color:#333}
    #essay-body .es-count{margin-left:auto}
    #essay-body details.es-sheet{border:1px solid #eee;border-radius:10px;margin-top:8px}
    #essay-body details.es-sheet>summary{list-style:none;cursor:pointer;padding:8px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    #essay-body details.es-sheet>summary::-webkit-details-marker{display:none}
    #essay-body details.es-sheet[open]>summary{border-bottom:1px solid #eee}
    #essay-body .es-chev{color:#999;transition:transform .15s;display:inline-block}
    #essay-body details.es-sheet[open] .es-chev{transform:rotate(90deg)}
    #essay-body .es-lesson{background:#333;color:#fff;border-radius:6px;padding:0 8px;font-size:.9em;white-space:nowrap}
    #essay-body .es-next{background:#fff3bf;color:#b35c00;border-radius:99px;padding:1px 8px;font-size:.82em;white-space:nowrap}
    #essay-body .es-right{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:.92em}
    #essay-body .es-quick{display:flex;gap:4px}
    #essay-body .es-quick a{font-size:.78em;border-radius:6px;padding:0 6px;color:#fff;text-decoration:none}
    #essay-body .es-date{font-size:.85em;color:#888;white-space:nowrap}
    #essay-body .es-body{padding:10px 12px}
    #essay-body .es-grp{margin:14px 0 0;font-size:.95em;color:#555;border-left:4px solid #999;padding-left:8px}
    #essay-body mark{background:#ffe066;padding:0}
    @media (max-width:600px){#essay-body .es-right{margin-left:0;width:100%}#essay-body .es-quick{display:none}}`;

  const KEY = "essaySheetsUI";
  const ui = { q: "", sort: "dateAsc", st: "全部", genre: "全部", open: null };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* 用預設 */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ sort: ui.sort, st: ui.st, genre: ui.genre, open: ui.open })); } catch { /* 略過 */ } };
  ui.q = ""; // 搜尋字不記
  const genreMain = g => String(g || "").replace(/（.*$/, "");
  const graded = s => !!tiersData?.tiers?.[s.id]?.analysis;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || lessonNo(a) - lessonNo(b) || String(a.topic).localeCompare(String(b.topic), "zh-Hant");
  const SORTERS = {
    dateAsc: byDate,
    dateDesc: (a, b) => -byDate(a, b),
    pending: (a, b) => (graded(a) - graded(b)) || byDate(a, b),
    genre: (a, b) => String(a.genre).localeCompare(String(b.genre), "zh-Hant") || byDate(a, b),
  };

  function chips(sheets) {
    const c = (g, v) => `<button type="button" class="es-chip" data-g="${g}" data-v="${esc(v)}" aria-pressed="${ui[g] === v}">${esc(v)}</button>`;
    const genres = ["全部", ...new Set(sheets.map(s => genreMain(s.genre)).filter(Boolean))];
    return (tiersData ? `<span class="meta">狀態</span>${["全部", "尚未批改", "已批改"].map(v => c("st", v)).join("")}<span style="width:6px"></span>` : "")
      + `<span class="meta">文體</span>${genres.map(v => c("genre", v)).join("")}<span class="meta es-count"></span>`;
  }

  function render(el, sheets) {
    const q = ui.q.trim();
    const hl = text => { const t = esc(text); if (!q) return t; const e = esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return t.replace(new RegExp(e, "g"), m => `<mark>${m}</mark>`); };
    const list = sheets.filter(s =>
      (!q || [s.lesson, s.topic, s.genre].join(" ").includes(q)) &&
      (!tiersData || ui.st === "全部" || (ui.st === "已批改") === graded(s)) &&
      (ui.genre === "全部" || genreMain(s.genre) === ui.genre)).sort(SORTERS[ui.sort] || byDate);
    const td = today();
    const next = [...sheets].filter(s => s.date >= td).sort(byDate)[0];
    const openSet = new Set(q ? list.map(s => s.id) : (ui.open ?? (next ? [next.id] : [])));
    let html = "", lastG = null;
    for (const s of list) {
      if (ui.sort === "genre" && s.genre !== lastG) { html += `<h3 class="es-grp">${esc(s.genre)}</h3>`; lastG = s.genre; }
      html += card(s, openSet.has(s.id), next && s.id === next.id, hl);
    }
    const box = el.querySelector(".es-list");
    box.innerHTML = html || `<p class="empty-hint">找不到符合的說明單。</p>`;
    el.querySelector(".es-chips").innerHTML = chips(sheets);
    el.querySelector(".es-count").textContent = `顯示 ${list.length}／${sheets.length} 篇`;
    box.querySelectorAll("details.es-sheet").forEach(d => d.addEventListener("toggle", () => {
      if (ui.q.trim()) return;
      ui.open = [...box.querySelectorAll("details.es-sheet[open]")].map(x => x.dataset.id); save();
    }));
    box.querySelectorAll(".es-quick a").forEach(a => a.addEventListener("click", e => e.stopPropagation()));
    box.querySelectorAll(".es-ana, .es-who").forEach(det =>
      det.addEventListener("toggle", () => { if (det.open) onOpen(det, box); }));
    if (tiersData) applyAll(box);
  }

  window.EssaySheets = {
    async mount() {
      const el = document.getElementById("essay-body");
      if (!el) return;
      let sheets = [];
      try { sheets = (await App.fetchJSON("data/essay-sheets.json")).sheets || []; } catch { /* 下面顯示空 */ }
      if (!sheets.length) { el.innerHTML = `<p class="empty-hint">還沒有已上線的作文說明單。</p>`; return; }
      if (!SORTERS[ui.sort]) ui.sort = "dateAsc";
      el.innerHTML = `<style>${CSS}</style>
        <div class="es-bar">
          <input type="search" class="es-q" placeholder="🔍 搜尋題目、課次、文體（例：海洋、第十、書信）" aria-label="搜尋作文說明單">
          <select class="es-sort" aria-label="排序">
            <option value="dateAsc">說明日期：舊→新</option><option value="dateDesc">說明日期：新→舊</option>
            <option value="pending">待批改優先</option><option value="genre">依文體分組</option>
          </select>
          <button type="button" class="es-btn" data-act="open">全部展開</button><button type="button" class="es-btn" data-act="close">全部收合</button>
          <div class="es-chips"></div>
        </div>
        <div class="es-list"></div>`;
      const qEl = el.querySelector(".es-q"), sEl = el.querySelector(".es-sort");
      sEl.value = ui.sort;
      qEl.addEventListener("input", () => { ui.q = qEl.value; render(el, sheets); });
      sEl.addEventListener("change", () => { ui.sort = sEl.value; ui.open = null; save(); render(el, sheets); });
      el.querySelector(".es-chips").addEventListener("click", e => {
        const b = e.target.closest(".es-chip"); if (!b) return;
        ui[b.dataset.g] = b.dataset.v; save(); render(el, sheets);
      });
      el.querySelectorAll(".es-btn").forEach(b => b.addEventListener("click", () => {
        ui.open = b.dataset.act === "open" ? sheets.map(s => s.id) : []; save(); render(el, sheets);
      }));
      render(el, sheets);
      // 已登入就自動解開：狀態、彙總填好，並出現「狀態」篩選
      if ((await tryAuto()) === "ok") render(el, sheets);
      window.EssaySheets._rerender = () => render(el, sheets);
    },
  };
})();
