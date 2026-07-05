(async () => {
  await App.init("gallery");
  const albums = await App.fetchJSON("data/gallery.json").catch(() => []);
  const main = document.getElementById("main");

  const openLightbox = src => {
    const box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = `<button class="close" aria-label="關閉">×</button><img src="${App.esc(src)}" alt="" />`;
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  };

  const showAlbum = idx => {
    const a = albums[idx];
    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>🖼️ ${App.esc(a.title)} <span class="meta">${App.fmtDate(a.date)}</span></h2>
      <p><a href="#" id="back">← 回相簿列表</a>${a.folderUrl ? `　<a href="${App.esc(a.folderUrl)}" target="_blank" rel="noopener">在 Google Drive 開啟 ↗</a>` : ""}</p>
      <div class="photo-grid" style="margin-top:12px">
        ${(a.photos || []).map(p => `<img src="${App.esc(p.thumb)}" data-full="${App.esc(p.full || p.thumb)}" alt="${App.esc(a.title)}照片" loading="lazy" />`).join("")}
      </div>
      ${!(a.photos || []).length ? '<p class="empty-hint">照片同步中，稍後再來看看！</p>' : ""}`;
    document.getElementById("back").onclick = e => { e.preventDefault(); showList(); };
    main.querySelectorAll(".photo-grid img").forEach(img => img.onclick = () => openLightbox(img.dataset.full));
  };

  const showList = () => {
    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>🖼️ 活動相簿</h2>
      ${albums.length ? `<div class="album-grid">
        ${albums.map((a, i) => `
          <a class="album-card" href="#" data-idx="${i}">
            ${a.cover ? `<img class="cover" src="${App.esc(a.cover)}" alt="${App.esc(a.title)}" loading="lazy" />` : `<div class="cover" style="display:flex;align-items:center;justify-content:center;font-size:44px">📷</div>`}
            <div class="info"><strong>${App.esc(a.title)}</strong><div class="meta">${App.fmtDate(a.date)}・${(a.photos || []).length} 張</div></div>
          </a>`).join("")}
      </div>` : '<p class="empty-hint">還沒有相簿，活動照片整理中！</p>'}`;
    main.querySelectorAll(".album-card").forEach(el =>
      el.onclick = e => { e.preventDefault(); showAlbum(+el.dataset.idx); });
  };

  showList();
})();
