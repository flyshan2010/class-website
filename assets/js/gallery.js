(async () => {
  await App.init("gallery");
  const albums = await App.fetchJSON("data/gallery.json").catch(() => []);
  const main = document.getElementById("main");

  // 燈箱：左右鍵／螢幕兩側箭頭／手機左右滑 切換上下張，Esc 或點黑底關閉
  const openLightbox = (list, start) => {
    let i = start;
    const box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = `<button class="close" aria-label="關閉">×</button>
      <button class="nav prev" aria-label="上一張">‹</button>
      <img alt="" />
      <button class="nav next" aria-label="下一張">›</button>
      <div class="counter" aria-live="polite"></div>`;
    const img = box.querySelector("img");
    const counter = box.querySelector(".counter");
    const show = n => {
      i = (n + list.length) % list.length;
      img.src = list[i];
      counter.textContent = `${i + 1} / ${list.length}`;
      new Image().src = list[(i + 1) % list.length]; // 先載下一張，滑過去不必等
    };
    const close = () => { document.removeEventListener("keydown", onKey); box.remove(); };
    const onKey = e => {
      if (e.key === "ArrowLeft") show(i - 1);
      else if (e.key === "ArrowRight") show(i + 1);
      else if (e.key === "Escape") close();
    };
    box.querySelector(".prev").onclick = e => { e.stopPropagation(); show(i - 1); };
    box.querySelector(".next").onclick = e => { e.stopPropagation(); show(i + 1); };
    img.onclick = e => e.stopPropagation();
    box.onclick = close;
    let x0 = null;
    box.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) show(dx < 0 ? i + 1 : i - 1);
    });
    document.addEventListener("keydown", onKey);
    if (list.length < 2) box.querySelectorAll(".nav, .counter").forEach(el => el.remove());
    document.body.appendChild(box);
    show(i);
  };

  const showAlbum = idx => {
    const a = albums[idx];
    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>🖼️ ${App.esc(a.title)} <span class="meta">${App.fmtDate(a.date)}</span></h2>
      <p><a href="#" id="back">← 回相簿列表</a>${a.folderUrl ? `　<a href="${App.esc(a.folderUrl)}" target="_blank" rel="noopener">在 ${a.source === "google-photos" ? "Google 相簿" : "Google Drive"} 開啟 ↗</a>` : ""}</p>
      <div class="photo-grid" style="margin-top:12px">
        ${(a.photos || []).map(p => `<img src="${App.esc(p.thumb)}" data-full="${App.esc(p.full || p.thumb)}" alt="${App.esc(a.title)}照片" loading="lazy" />`).join("")}
      </div>
      ${!(a.photos || []).length ? '<p class="empty-hint">照片同步中，稍後再來看看！</p>' : ""}`;
    document.getElementById("back").onclick = e => { e.preventDefault(); showList(); };
    const fulls = (a.photos || []).map(p => p.full || p.thumb);
    main.querySelectorAll(".photo-grid img").forEach((img, n) => img.onclick = () => openLightbox(fulls, n));
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
