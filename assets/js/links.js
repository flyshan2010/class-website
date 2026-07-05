(async () => {
  await App.init("links");
  const links = await App.fetchJSON("data/links.json").catch(() => []);
  const ORDER = ["工具網站", "閱讀平台", "自學平台", "休閒娛樂", "班級事務", "親師專區", "其他"];
  const rank = c => (ORDER.indexOf(c) + 1) || 999;
  const cats = [...new Set(links.map(l => l.category || "其他"))].sort((a, b) => rank(a) - rank(b));

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🔗 常用網站</h2>
    ${cats.map(cat => `
      <h3 style="margin:16px 0 10px">${App.esc(cat)}</h3>
      <div class="link-grid">
        ${links.filter(l => (l.category || "其他") === cat).map(l => `
          <a class="link-card" href="${App.esc(l.url)}" target="_blank" rel="noopener" ${l.note ? `title="${App.esc(l.note)}"` : ""}>
            <span class="icon">${App.esc(l.icon || "🌐")}</span>
            <span>${App.esc(l.name)}${l.note ? `<br /><small style="color:var(--ink-soft)">${App.esc(l.note)}</small>` : ""}</span>
          </a>`).join("")}
      </div>`).join("") || '<p class="empty-hint">還沒有網站連結</p>'}`;
})();
