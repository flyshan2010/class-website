/* 學期回顧：自動彙整已發布週報＋相簿，變成班級成果展 */
(async () => {
  const c = await App.init("recap");
  const [weekly, gallery, extra] = await Promise.all([
    App.fetchJSON("data/weekly.json").catch(() => []),
    App.fetchJSON("data/gallery.json").catch(() => []),
    App.fetchJSON("data/recap-extra.json").catch(() => null),
  ]);
  const main = document.getElementById("main");
  const ecoWeeks = extra?.economy?.weeks || [];
  const selWeeks = extra?.sel?.weeks || [];

  if (!weekly.length && !gallery.length && !ecoWeeks.length && !selWeeks.length) {
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

  // ── 班級經濟大事記（Phase C3；recap-extra.json 全班聚合，無個資）──
  const ecoLine = w => {
    const parts = [];
    if (w.salary) parts.push(`💵 發薪 ${w.salary}`);
    if (w.reward) parts.push(`🌟 獎勵 ${w.reward}`);
    if (w.penalty) parts.push(`⚠️ 扣款 ${w.penalty}`);
    if (w.interest) parts.push(`🪙 利息 ${w.interest}`);
    if (w.spendCount) parts.push(`🛒 消費 ${w.spendCount} 筆共 ${w.spend}`);
    return parts.join("・");
  };
  const ecoSection = ecoWeeks.length ? `
    <section class="card" style="--accent:${c.moduleColors.bank || "#FECA57"}">
      <h2>💰 班級經濟大事記</h2>
      <p class="meta">崑山幣目前流通 ${extra.economy.totals.supply} 幣・累計 ${extra.economy.totals.txCount} 筆交易・全班共消費 ${extra.economy.totals.spend} 幣（全班統計，無個人資料）</p>
      <div class="recap-timeline">
        ${ecoWeeks.map(w => `
          <div class="recap-week">
            <div class="recap-week-head"><strong>${App.esc(w.label)}</strong></div>
            <p>${ecoLine(w) || "本週無交易"}</p>
          </div>`).join("")}
      </div>
    </section>` : "";

  // ── 全班 SEL 成長雷達（去識別化：僅全班平均；同步端已限「該週發布數 ≥ minN」才輸出）──
  const selRadar = () => {
    if (!selWeeks.length) return "";
    const abilities = extra.sel.abilities;
    const first = selWeeks[0], last = selWeeks[selWeeks.length - 1];
    const cx = 130, cy = 118, r = 78;
    const pt = (i, ratio) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / abilities.length;
      return [cx + r * ratio * Math.cos(a), cy + r * ratio * Math.sin(a)];
    };
    const ring = ratio => abilities.map((_, i) => pt(i, ratio).map(n => n.toFixed(1)).join(",")).join(" ");
    const poly = wk => abilities.map((a, i) => pt(i, Math.max(0, Math.min(5, wk.avg[a])) / 5).map(x => x.toFixed(1)).join(",")).join(" ");
    const labels = abilities.map((a, i) => {
      const [x, y] = pt(i, 1.28);
      return `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="12" fill="#57606f">${App.esc(a)}</text>`;
    }).join("");
    const same = first.week === last.week;
    return `
    <section class="card" style="--accent:#5F27CD">
      <h2>🧠 全班 SEL 成長雷達</h2>
      <p class="meta">社會情緒學習（SEL）五能力全班平均（去識別化聚合，不呈現個人；${same
        ? `${App.esc(last.period)}，${last.n} 位`
        : `虛線＝${App.esc(first.period)}、實線＝${App.esc(last.period)}`}）</p>
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:center">
        <svg viewBox="0 0 260 246" class="report-radar" style="width:min(300px, 86vw)" role="img" aria-label="全班 SEL 五能力平均雷達圖">
          ${[1, 0.8, 0.6, 0.4, 0.2].map(rt => `<polygon points="${ring(rt)}" fill="none" stroke="#e8e4d8" />`).join("")}
          ${abilities.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0].toFixed(1)}" y2="${pt(i, 1)[1].toFixed(1)}" stroke="#e8e4d8" />`).join("")}
          ${same ? "" : `<polygon points="${poly(first)}" fill="rgba(87,96,111,.12)" stroke="#8395a7" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round" />`}
          <polygon points="${poly(last)}" fill="rgba(95,39,205,.25)" stroke="#5F27CD" stroke-width="2.5" stroke-linejoin="round" />
          ${labels}
        </svg>
        <div class="recap-highlights" style="flex-direction:column;align-items:flex-start">
          ${abilities.map(a => `<span class="recap-chip">${App.esc(a)}：${same ? "" : `${first.avg[a]} → `}<strong>${last.avg[a]}</strong></span>`).join("")}
        </div>
      </div>
    </section>`;
  };
  const selSection = selRadar();

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

    ${ecoSection}
    ${selSection}

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
