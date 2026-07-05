(async () => {
  await App.init("weekly");
  const data = await App.fetchJSON("data/weekly.json").catch(() => []);
  const secs = [
    ["learning", "📚 本週學習重點"],
    ["activities", "🎉 班級活動"],
    ["highlights", "🌟 學生亮點"],
    ["reminders", "⏰ 下週提醒"],
    ["parents", "🤝 家長配合事項"],
  ];

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📰 班級週報</h2>
    ${data.length ? `
    <div class="card" style="border-top-color:var(--purple)">
      <strong>歷週索引：</strong>
      <div class="weekly-index" style="margin-top:6px">
        ${data.map((w, i) => `<a href="#w${i}">${App.esc(w.week)}</a>`).join("")}
      </div>
    </div>
    ${data.map((w, i) => `
      <section class="card weekly-card" id="w${i}">
        <h2>${App.esc(w.week)}</h2>
        <p class="meta">${App.esc(w.range || "")}</p>
        ${secs.map(([key, title]) => w[key] ? `
          <div class="weekly-sec">
            <span class="sec-title">${title}</span>
            ${App.ul(w[key]) || `<p>${App.esc(w[key])}</p>`}
          </div>` : "").join("")}
      </section>`).join("")}` : '<p class="empty-hint">第一期週報即將出刊，敬請期待！</p>'}`;
})();
