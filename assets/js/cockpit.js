/* 🚀 教學駕駛艙：教學五段流程的單元入口頁（老師課堂一鍵開）
   資料：data/lessons.json（Notion「🚀 教學單元」勾「顯示」者，無個資）
   五段：起始評估 → 課程教學 → 差異化指導 → 學習評量 → 成果回流（回流在紀錄庫，無連結） */
(async () => {
  await App.init("cockpit");
  const lessons = await App.fetchJSON("data/lessons.json").catch(() => []);

  const SUBJECT_COLOR = {
    "國語": "#FF6B81", "數學": "#54A0FF", "社會": "#FF9F43", "自然": "#1DD1A1",
    "英語": "#5F27CD", "健體": "#FECA57", "藝術": "#FF9FF3", "綜合": "#8395A7", "其他": "#8395A7",
  };
  const STATUS_META = {
    "進行中": { icon: "🔥", style: "background:#d0ebff;color:#1864ab" },
    "備課中": { icon: "🌱", style: "background:#fff3bf;color:#8a6d00" },
    "已完成": { icon: "✅", style: "background:#e9ecef;color:#666" },
  };
  // 五段流程順序＝進度條；「成果回流」完成代表單元收尾（紀錄已回紀錄庫）
  const STAGES = ["起始評估", "課程教學", "差異化指導", "學習評量", "成果回流"];
  const LINKS = [
    ["pretest", "📝 起始評估"],
    ["site", "🖥️ 教學網站"],
    ["differentiated", "🎯 差異化教材"],
    ["exam", "💯 單元評量"],
    ["review", "🔁 複習素材"],
    ["material", "📚 原始教材"],
  ];

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
    return `
      <div class="card cockpit-card" style="--accent:${SUBJECT_COLOR[l.subject] || "#8395A7"}">
        <div class="cockpit-head">
          <span class="badge" style="background:${SUBJECT_COLOR[l.subject] || "#8395A7"};color:#fff">${App.esc(l.subject)}</span>
          <strong class="cockpit-title">${App.esc(l.title)}</strong>
          <span class="badge" style="${st.style}">${st.icon} ${App.esc(l.status)}</span>
          ${l.date ? `<span class="meta">${App.esc(App.fmtDateShort(l.date))} 開始</span>` : ""}
        </div>
        ${stageChips(l.stages || [])}
        ${linkBtns(l)}
        ${l.note ? `<p class="meta">${App.esc(l.note)}</p>` : ""}
      </div>`;
  };

  const groups = [
    ["進行中", "🔥 進行中的單元"],
    ["備課中", "🌱 備課中"],
    ["已完成", "✅ 已完成"],
  ];
  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🚀 教學駕駛艙</h2>
    <p class="meta">教學五段流程（起始評估→教學→差異化→評量→回流）的單元入口：課堂要用的連結都在這裡。
    單元與連結在 Notion「🚀 教學單元」維護（勾「顯示」上站），或對 AI 說「/lesson-flow 開新單元」。</p>
    ${lessons.length
      ? groups.map(([status, label]) => {
          const list = lessons.filter(l => l.status === status);
          return list.length ? `<h3 class="bank-section-title">${label}</h3>${list.map(card).join("")}` : "";
        }).join("")
      : '<p class="empty-hint">還沒有教學單元。對 AI 說「/lesson-flow 開新單元」開始第一個單元吧！</p>'}`;
})();
