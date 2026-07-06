(async () => {
  await App.init("weekly");
  const data = await App.fetchJSON("data/weekly.json").catch(() => []);
  const learnSecs = [
    ["chinese", "📖 國語"],
    ["math", "🔢 數學"],
    ["social", "🌏 社會"],
    ["other", "✨ 其他"],
  ];
  const secs = [
    ["activities", "🎉 班級活動"],
    ["highlights", "🌟 學生亮點"],
    ["reminders", "⏰ 下週提醒"],
    ["parents", "🤝 家長配合事項"],
  ];

  const learning = w => {
    const items = learnSecs.filter(([k]) => (w.learning || {})[k]);
    return items.length ? `
      <div class="weekly-sec">
        <span class="sec-title">📚 本週學習重點</span>
        ${items.map(([k, label]) => `
          <p style="margin-top:4px"><strong>${label}</strong></p>
          ${App.ul(w.learning[k]) || `<p>${App.esc(w.learning[k])}</p>`}`).join("")}
      </div>` : "";
  };

  const imgs = w => (w.images || []).length ? `
    <div class="weekly-sec">
      <span class="sec-title">📷 本週剪影</span>
      <div class="photo-grid" style="margin-top:6px">
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
          <section class="card weekly-card" id="w${i}">
            <h2>${App.esc(w.week)}</h2>
            <p class="meta">${App.esc(w.range || "")}</p>
            ${learning(w)}
            ${secs.map(([key, title]) => w[key] ? `
              <div class="weekly-sec">
                <span class="sec-title">${title}</span>
                ${App.ul(w[key]) || `<p>${App.esc(w[key])}</p>`}
              </div>` : "").join("")}
            ${imgs(w)}
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
