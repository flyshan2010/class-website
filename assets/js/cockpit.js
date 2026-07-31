/* 🚀 教學駕駛艙：教學五段流程的單元入口頁（老師課堂一鍵開）
   資料：data/lessons.json（Notion「🚀 教學單元」勾「顯示」者，無個資）
   五段：起始評估 → 課程教學 → 差異化指導 → 學習評量 → 成果回流（回流在紀錄庫，無連結）
   排列：主分類＝科目，次分群＝單元（數L1、社1…，由小而大），單元內依小節排序；
         沒有小節的課（國L1）不歸單元，直接掛科目底下；狀態改為卡片徽章＋上方篩選
   卡片：標題列只留「課次＋課名＋狀態」，年段・版本・開始日收成一行小字，其下條列內容重點 */
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
  /* 單元分群：代碼有小節（數L1-2、社1-1）才歸單元，單元代碼＝最後一段小節之前的部分；
     沒有小節的課（國L1）自成一組、不顯示單元標題。單元序號取代碼尾端數字，用來寫「第 N 單元」。 */
  const UNIT_RE = /^(.*\d)-\d+$/; // 數L1-2 → 數L1；社1-1 → 社1；國L1（無小節）→ 不成單元
  const unitOf = l => (UNIT_RE.exec(codeOf(l)) || [])[1] || "";
  const unitNo = u => (/(\d+)$/.exec(u) || [])[1] || "";

  /* 節次分組判斷：國語這類「同一課依教學進度切成第N節」的分組，代碼雖有 -N 尾碼、
     邏輯上仍是同一課，要顯示成「第 N 課（代碼 課名）」；數學／社會的小節（乘以一二位數、
     乘以三位數…）是同一單元底下不同課，維持「第 N 單元（代碼・N 課）」。
     判斷法：把每一列標題「第N節」之前的文字取出來比對，全部相同才視為同一課。 */
  const NODE_NAME_RE = /^(.*?)\s*第[一二三四五六七八九十0-9]+節/;
  const sameCourseName = rows => {
    const names = rows.map(l => {
      const full = (l.title || "").replace(CODE_RE, " ").replace(/\s+/g, " ").trim();
      const m = NODE_NAME_RE.exec(full);
      return m && m[1] ? m[1].trim() : null;
    });
    return names.every(n => n && n === names[0]) ? names[0] : null;
  };

  /* 單元名稱（數學／社會小節適用）：標題若寫成「代碼 單元名稱｜課名」（｜前後皆可留空白），
     取「｜」前的單元名稱，同一單元底下每列都相同才採用；沒有寫「｜」的舊資料不受影響，
     單元標題退回原本「第N單元（代碼・N課）」的樣子。 */
  const UNIT_NAME_RE = /^(.*?)\s*｜/;
  const sameUnitName = rows => {
    const names = rows.map(l => {
      const full = (l.title || "").replace(CODE_RE, " ").replace(/\s+/g, " ").trim();
      const m = UNIT_NAME_RE.exec(full);
      return m && m[1] ? m[1].trim() : null;
    });
    return names.every(n => n && n === names[0]) ? names[0] : null;
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

  /* 內容重點：Notion 多行文字，一行一則；條列呈現，讓老師掃一眼就知道這課要教什麼 */
  const pointList = pts => (pts && pts.length)
    ? `<ul class="cockpit-points">${pts.map(p => `<li>${App.esc(p)}</li>`).join("")}</ul>`
    : "";

  const card = (l, stripPrefix) => {
    const st = STATUS_META[l.status] || STATUS_META["備課中"];
    const color = SUBJECT_COLOR[l.subject] || "#8395A7";
    const code = codeOf(l);
    // 標題已含課次代碼，前面的代碼徽章就不重複顯示課次以外的字
    let name = code ? (l.title || "").replace(CODE_RE, " ").replace(/\s+/g, " ").trim() : l.title;
    // 同課節次分組時，課名已顯示在上方摺疊列標題，卡片標題只留節次描述避免重複
    if (stripPrefix && name.startsWith(stripPrefix)) name = name.slice(stripPrefix.length).trim();
    // 年段・版本・開始日整併成一行小字，標題列只留課名與狀態
    const meta = [l.grade, l.version, l.date ? `${App.fmtDateShort(l.date)} 開始` : ""]
      .filter(Boolean).map(App.esc).join(" ・ ");
    return `
      <div class="card cockpit-card" style="--accent:${color}">
        <div class="cockpit-head">
          ${code ? `<span class="badge" style="background:${color};color:#fff">${App.esc(code)}</span>` : ""}
          <strong class="cockpit-title">${App.esc(name)}</strong>
          <span class="badge" style="${st.style}">${st.icon} ${App.esc(l.status)}</span>
        </div>
        ${meta ? `<p class="meta cockpit-meta">${meta}</p>` : ""}
        ${pointList(l.points)}
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

  /* 科目內再依單元分塊：rows 已依課次代碼排好，照順序切開就是「單元由小而大、單元內小節由小而大」。
     每塊都做成 <details> 摺疊列表（點標題收合／展開），**預設全部收合**——一進來只看到
     單元清單，要用哪課再點開。有小節的（數L1-1…）合成「第 N 單元」；沒有小節的（國L1）
     一課自成一列，標題直接顯示課次與課名。 */
  const blockHead = b => {
    if (b.unit) {
      const courseName = sameCourseName(b.rows);
      if (courseName) {
        return `📄 第 ${App.esc(unitNo(b.unit))} 課
                <span class="meta">（${App.esc(b.unit)}${App.esc(courseName)} ${b.rows.length}節）</span>`;
      }
      const unitName = sameUnitName(b.rows);
      return unitName
        ? `📘 第 ${App.esc(unitNo(b.unit))} 單元
           <span class="meta">（${App.esc(b.unit)} ${App.esc(unitName)}・${b.rows.length} 課）</span>`
        : `📘 第 ${App.esc(unitNo(b.unit))} 單元
           <span class="meta">（${App.esc(b.unit)}・${b.rows.length} 課）</span>`;
    }
    // 單課列：標題列就把課次與課名寫清楚，收合狀態下也認得出是哪一課
    const l = b.rows[0], code = codeOf(l);
    const name = code ? (l.title || "").replace(CODE_RE, " ").replace(/\s+/g, " ").trim() : l.title;
    return code
      ? `📄 第 ${App.esc(unitNo(code))} 課 <span class="meta">（${App.esc(code)}・${App.esc(name)}）</span>`
      : `📄 ${App.esc(l.title || "")}`;
  };

  const unitBlocks = (rows, color) => {
    const blocks = [];
    rows.forEach(l => {
      const unit = unitOf(l);
      const last = blocks[blocks.length - 1];
      if (unit && last && last.unit === unit) last.rows.push(l);
      else blocks.push({ unit, rows: [l] });
    });
    return blocks.map(b => {
      // 卡片標題要去掉的前綴：同課節次（課名）或同單元小節（單元名稱｜），已在摺疊列標題顯示過
      let stripPrefix = null;
      if (b.unit) {
        const courseName = sameCourseName(b.rows);
        if (courseName) stripPrefix = courseName;
        else {
          const unitName = sameUnitName(b.rows);
          if (unitName) stripPrefix = `${unitName}｜`;
        }
      }
      return `
        <details class="cockpit-unit-box">
          <summary class="cockpit-unit" style="--accent:${color}">
            <span>${blockHead(b)}</span>
          </summary>
          ${b.rows.map(l => card(l, stripPrefix)).join("")}
        </details>`;
    }).join("");
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
              </h3>${unitBlocks(rows, color)}`;
    }).join("");
  };

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🚀 教學駕駛艙</h2>
    <p class="meta">教學五段流程（起始評估→教學→差異化→評量→回流）的單元入口：課堂要用的連結都在這裡。
    依<b>科目</b>分區、區內再依<b>單元</b>做成摺疊列表（單元由小而大，單元內依小節排序）——
    <b>預設全部收合</b>，點單元標題展開該單元的課卡與連結。
    單元與連結在 Notion「🚀 教學單元」維護（勾「顯示」上站），
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
