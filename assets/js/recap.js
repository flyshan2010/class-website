/* 學期回顧：自動彙整已發布週報＋相簿，變成班級成果展 */
(async () => {
  const c = await App.init("recap");
  const [weekly, gallery] = await Promise.all([
    App.fetchJSON("data/weekly.json").catch(() => []),
    App.fetchJSON("data/gallery.json").catch(() => []),
  ]);
  const main = document.getElementById("main");

  if (!weekly.length && !gallery.length) {
    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>🎓 學期回顧</h2>
      <p class="empty-hint">學期回顧會隨著週報與相簿的累積自動長出來，開學後再來看看！</p>`;
    return;
  }

  // 統計數字
  const photoCount = gallery.reduce((n, a) => n + (a.photos || []).length, 0);
  const allActivities = weekly.flatMap(w => App.lines(w.activities));
  const allHighlights = weekly.flatMap(w => App.lines(w.highlights));
  const stats = [
    { n: weekly.length, label: "週報", emoji: "📰" },
    { n: allActivities.length, label: "班級活動", emoji: "🎉" },
    { n: gallery.length, label: "活動相簿", emoji: "🖼️" },
    { n: photoCount, label: "照片", emoji: "📷" },
    { n: allHighlights.length, label: "學生亮點", emoji: "🌟" },
  ].filter(s => s.n > 0);

  // 依時間舊→新排成成長軌跡（weekly.json 是新→舊）
  const timeline = [...weekly].reverse();

  main.innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🎓 學期回顧</h2>
    <div class="card recap-hero" style="--accent:${c.moduleColors.recap || "#FF9F43"}">
      <h2>${App.esc(c.schoolYear)} ${App.esc(c.className)}的成長足跡</h2>
      <div class="recap-stats">
        ${stats.map(s => `
          <div class="recap-stat">
            <div class="emoji">${s.emoji}</div>
            <div class="num">${s.n}</div>
            <div class="label">${s.label}</div>
          </div>`).join("")}
      </div>
    </div>

    ${allHighlights.length ? `
    <section class="card" style="--accent:${c.moduleColors.weekly}">
      <h2>🌟 亮點牆</h2>
      <p class="meta">週報裡記錄過的每一顆星星</p>
      <div class="recap-highlights">
        ${allHighlights.map(h => `<span class="recap-chip">${App.esc(h)}</span>`).join("")}
      </div>
    </section>` : ""}

    ${gallery.length ? `
    <section class="card" style="--accent:${c.moduleColors.gallery}">
      <h2>🖼️ 活動剪影</h2>
      <div class="album-grid" style="margin-top:10px">
        ${gallery.map(a => `
          <a class="album-card" href="gallery.html">
            ${a.cover ? `<img class="cover" src="${App.esc(a.cover)}" alt="${App.esc(a.title)}" loading="lazy" />` : ""}
            <div class="info"><strong>${App.esc(a.title)}</strong><div class="meta">${App.fmtDate(a.date)}</div></div>
          </a>`).join("")}
      </div>
    </section>` : ""}

    ${timeline.length ? `
    <section class="card" style="--accent:${c.moduleColors.calendar}">
      <h2>🚶 每週足跡</h2>
      <div class="recap-timeline">
        ${timeline.map(w => `
          <div class="recap-week">
            <div class="recap-week-head">
              <strong>${App.esc(w.week)}</strong>
              <span class="meta">${App.esc(w.range || "")}</span>
            </div>
            ${App.lines(w.activities).length ? `<p>🎉 ${App.lines(w.activities).map(App.esc.bind(App)).join("、")}</p>` : ""}
            ${App.lines(w.highlights).length ? `<p>🌟 ${App.lines(w.highlights).map(App.esc.bind(App)).join("、")}</p>` : ""}
            ${(w.images || []).length ? `
            <div class="photo-grid recap-photos">
              ${w.images.map(src => `<img src="${App.esc(src)}" alt="週報照片" loading="lazy" />`).join("")}
            </div>` : ""}
          </div>`).join("")}
      </div>
    </section>` : ""}`;

  // 燈箱
  main.addEventListener("click", e => {
    if (e.target.tagName !== "IMG" || !e.target.closest(".photo-grid")) return;
    const box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = `<button class="close" aria-label="關閉">×</button><img src="${e.target.src}" alt="" />`;
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  });
})();
