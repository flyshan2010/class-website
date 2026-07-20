/* 🚀 教學駕駛艙：教學五段流程的單元入口頁（老師課堂一鍵開）
   資料：data/lessons.json（Notion「🚀 教學單元」勾「顯示」者，無個資）
   五段：起始評估 → 課程教學 → 差異化指導 → 學習評量 → 成果回流（回流在紀錄庫，無連結）
   排列：主分類＝科目，次排序＝課次代碼（國L1、社1-1…）；狀態改為卡片徽章＋上方篩選 */
(async () => {
  await App.init("cockpit");
  const lessons = await App.fetchJSON("data/lessons.json").catch(() => []);

  const SUBJECT_COLOR = {
    "國語": "#FF6B81", "數學": "#54A0FF", "社會": "#FF9F43", "自然": "#1DD1A1",
    "英語": "#5F27CD", "健體": "#FECA57", "藝術": "#FF9FF3", "綜合": "#8395A7", "其他": "#8395A7",
  };
  // 科目分區的顯示順序（未列到的科目排在最後，依字母序）
  const SUBJECT_ORDER = ["國語", "數學", "社會", "自然", "英語", "健體", "藝術", "綜合", "其他"];
  const SUBJECT_ICON = {
    "國語": "📖", "數學": "🔢", "社會": "🗺️", "自然": "🔬",
    "英語": "🔤", "健體": "🤸", "藝術": "🎨", "綜合": "🧩", "其他": "📦",
  };
  const STATUS_META = {
    "進行中": { icon: "🔥", style: "background:#d0ebff;color:#1864ab" },
    "備課中": { icon: "🌱", style: "background:#fff3bf;color:#8a6d00" },
    "已完成": { icon: "✅", style: "background:#e9ecef;color:#666" },
  };
  // 五段流程順序＝進度條；「成果回流」完成代表單元收尾（紀錄已回紀錄庫）
  const STAGES = ["起始評估", "課程教學", "差異化指導", "學習評量", "成果回流"];
  const LINKS = [
    ["pretest", "0 📝 起始評估"],
    ["site", "1 🖥️ 教學網站"],
    ["differentiated", "2 🎯 差異化教材"],
    ["review", "3 🔁 複習素材"],
    ["exam", "4 💯 單元評量"],
    ["material", "5 📚 原教材"],
  ];

  /* 課次代碼：單元名稱中形如「國L1」「社1-1」「數L10」「SEL1-1」的那一段。
     命名規範見 AGENTS.md 第 10 條；取不到就退回用整個標題排序。 */
  const CODE_RE = /(?:^|\s)((?:國|數|社|自|英|健康|藝|綜)[A-Za-z]*\d+(?:-\d+)*|SEL\d+(?:-\d+)*)(?=\s|$)/;
  const codeOf = l => (CODE_RE.exec(l.title || "") || [])[1] || "";
  /* 自然排序：把代碼拆成「文字段／數字段」交錯比較，讓 數L2 排在 數L10 前面 */
  const sortKey = l => {
    const c = codeOf(l) || l.title || "";
    return c.split(/(\d+)/).map(p => (/^\d+$/.test(p) ? p.padStart(6, "0") : p)).join("");
  };

  const stageChips = done => `
    <div class="cockpit-stages">
      ${STAGES.map(s => `<span class="cockpit-stage ${done.includes(s) ? "done" : ""}">${done.includes(s) ? "✓" : "○"} ${s}</span>`).join("")}
    </div>`;

  const linkBtns = l => {
    const btns = LINKS.filter(([k]) => l.links[k])
      .map(([k, label]) => `<a class="cockpit-link" href="${App.esc(l.links[k])}" target="_blank" rel="noopener">${label}</a>`);
    return btns.length
      ? `<div class="cockpit-links">${btns.join("")}</div>`
      : `<p class="meta">尚未有教學連結——用 /lesson-flow 產出後會自動掛上。</p>`;
  };

  const card = l => {
    const st = STATUS_META[l.status] || STATUS_META["備課中"];
    const color = SUBJECT_COLOR[l.subject] || "#8395A7";
    const code = codeOf(l);
    // 標題已含課次代碼，前面的代碼徽章就不重複顯示課次以外的字
    const name = code ? (l.title || "").replace(CODE_RE, " ").replace(/\s+/g, " ").trim() : l.title;
    return `
      <div class="card cockpit-card" style="--accent:${color}">
        <div class="cockpit-head">
          ${code ? `<span class="badge" style="background:${color};color:#fff">${App.esc(code)}</span>` : ""}
          <strong class="cockpit-title">${App.esc(name)}</strong>
          <span class="badge" style="${st.style}">${st.icon} ${App.esc(l.status)}</span>
          ${l.date ? `<span class="meta">${App.esc(App.fmtDateShort(l.date))} 開始</span>` : ""}
        </div>
        ${stageChips(l.stages || [])}
        ${linkBtns(l)}
        ${l.note ? `<p class="meta">${App.esc(l.note)}</p>` : ""}
      </div>`;
  };

  const subjectsOf = list => {
    const names = [...new Set(list.map(l => l.subject || "其他"))];
    return names.sort((a, b) => {
      const ia = SUBJECT_ORDER.indexOf(a), ib = SUBJECT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, "zh-Hant");
    });
  };

  const renderList = onlyActive => {
    const list = onlyActive ? lessons.filter(l => l.status === "進行中") : lessons;
    if (!list.length) {
      return onlyActive
        ? '<p class="empty-hint">目前沒有「進行中」的單元。</p>'
        : '<p class="empty-hint">還沒有教學單元。對 AI 說「/lesson-flow 開新單元」開始第一個單元吧！</p>';
    }
    return subjectsOf(list).map(sub => {
      const rows = list.filter(l => (l.subject || "其他") === sub)
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b), "zh-Hant"));
      const color = SUBJECT_COLOR[sub] || "#8395A7";
      return `<h3 class="bank-section-title" style="border-left:6px solid ${color};padding-left:12px">
                ${SUBJECT_ICON[sub] || "📦"} ${App.esc(sub)}
                <span class="meta">（${rows.length} 課）</span>
              </h3>${rows.map(card).join("")}`;
    }).join("");
  };

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🚀 教學駕駛艙</h2>
    <p class="meta">教學五段流程（起始評估→教學→差異化→評量→回流）的單元入口：課堂要用的連結都在這裡。
    依<b>科目</b>分區、<b>課次</b>排序。單元與連結在 Notion「🚀 教學單元」維護（勾「顯示」上站），
    或對 AI 說「/lesson-flow 開新單元」。</p>
    <div class="cockpit-filter" style="display:flex;gap:10px;margin:14px 0 6px">
      <button type="button" class="cockpit-link" data-filter="all" aria-pressed="true">全部單元</button>
      <button type="button" class="cockpit-link" data-filter="active" aria-pressed="false">🔥 只看進行中</button>
    </div>
    <div id="cockpit-list">${renderList(false)}</div>`;

  document.querySelectorAll("[data-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-filter]").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
      document.getElementById("cockpit-list").innerHTML = renderList(btn.dataset.filter === "active");
    });
  });
})();
