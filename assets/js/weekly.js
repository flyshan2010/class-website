(async () => {
  const config = await App.init("weekly");
  const data = await App.fetchJSON("data/weekly.json").catch(() => []);
  const subjects = [
    ["chinese", "📖", "國語", "var(--pink)"],
    ["math", "🔢", "數學", "var(--sky)"],
    ["social", "🌏", "社會", "var(--mint)"],
    ["other", "⭐", "其他", "var(--orange)"],
  ];

  const learning = w => {
    const items = subjects.filter(([k]) => (w.learning || {})[k]);
    return items.length ? `
      <div class="poster-box box-learning">
        <span class="box-title" style="background:var(--pink)">📚 本週學習重點</span>
        ${items.map(([k, icon, label, color]) => `
          <div class="subject-row">
            <span class="subject-name" style="color:${color}"><span class="subject-icon">${icon}</span>${label}</span>
            <div class="subject-text">${App.ul(w.learning[k]) || App.esc(w.learning[k])}</div>
          </div>`).join("")}
      </div>` : "";
  };

  const simpleBox = (title, emoji, color, content) => content ? `
    <div class="poster-box" style="border-color:${color}">
      <span class="box-title" style="background:${color}">${emoji} ${title}</span>
      <div class="box-body">${App.ul(content) || `<p>${App.esc(content)}</p>`}</div>
    </div>` : "";

  // 下週重要行事：一行一項，行首「M/D（週）」自動變日期標籤
  const events = w => {
    const items = App.lines(w.reminders);
    return items.length ? `
      <div class="poster-box" style="border-color:var(--sky)">
        <span class="box-title" style="background:var(--sky)">📅 下週重要行事</span>
        <ul class="event-list">
          ${items.map(t => {
            const m = t.match(/^(\d{1,2}\/\d{1,2})\s*[（(]?([一二三四五六日])?[）)]?\s*(.*)$/);
            return m && m[3]
              ? `<li><span class="event-date">${App.esc(m[1])}${m[2] ? `（${m[2]}）` : ""}</span>${App.esc(m[3])}</li>`
              : `<li>${App.esc(t)}</li>`;
          }).join("")}
        </ul>
      </div>` : "";
  };

  const imgs = w => (w.images || []).length ? `
    <div class="poster-box" style="border-color:var(--purple)">
      <span class="box-title" style="background:var(--purple)">📸 本週剪影</span>
      <div class="photo-grid" style="margin-top:8px">
        ${w.images.map(src => `<img src="${App.esc(src)}" alt="週報照片" loading="lazy" />`).join("")}
      </div>
    </div>` : "";

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📰 班級週報</h2>
    ${data.length ? `
    <div class="weekly-layout">
      <aside class="weekly-aside">
        <div class="card" style="border-top-color:var(--purple)">
          <strong>歷週索引：</strong>
          <div class="weekly-index" style="margin-top:6px">
            ${data.map((w, i) => `<a href="#w${i}">${App.esc(w.week)}</a>`).join("")}
          </div>
        </div>
      </aside>
      <div class="weekly-main">
        ${data.map((w, i) => `
          <section class="card weekly-card poster" id="w${i}">
            <div class="poster-head">
              <div>
                <span class="poster-ribbon">🎀 ${App.esc(w.week)}</span>
                <p class="poster-range">${App.esc(w.range || "")}</p>
              </div>
              <span class="poster-class">班級：<strong>${App.esc(config.className)}</strong></span>
            </div>
            <div class="poster-grid">
              ${learning(w)}
              <div class="poster-col">
                ${simpleBox("班級活動", "🎉", "var(--mint)", w.activities)}
                ${simpleBox("學生亮點", "🌟", "var(--yellow)", w.highlights)}
                ${simpleBox("家長配合事項", "💗", "var(--pink)", w.parents)}
              </div>
              <div class="poster-col">
                ${events(w)}
                ${imgs(w)}
              </div>
            </div>
          </section>`).join("")}
      </div>
    </div>` : '<p class="empty-hint">第一期週報即將出刊，敬請期待！</p>'}`;

  document.getElementById("main").addEventListener("click", e => {
    if (e.target.tagName !== "IMG") return;
    const box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = `<button class="close" aria-label="關閉">×</button><img src="${e.target.src}" alt="" />`;
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  });
})();
