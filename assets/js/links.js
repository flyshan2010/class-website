(async () => {
  await App.init("links");
  const links = await App.fetchJSON("data/links.json").catch(() => []);
  const cats = [...new Set(links.map(l => l.category || "其他"))];

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🔗 常用網站</h2>
    ${cats.map(cat => `
      <h3 style="margin:16px 0 10px">${App.esc(cat)}</h3>
      <div class="link-grid">
        ${links.filter(l => (l.category || "其他") === cat).map(l => `
          <a class="link-card" href="${App.esc(l.url)}" target="_blank" rel="noopener">
            <span class="icon">${App.esc(l.icon || "🌐")}</span>
            <span>${App.esc(l.name)}</span>
          </a>`).join("")}
      </div>`).join("") || '<p class="empty-hint">還沒有網站連結</p>'}`;
})();
