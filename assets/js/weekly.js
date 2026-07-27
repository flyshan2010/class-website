(async () => {
  const config = await App.init("weekly");
  const data = await App.fetchJSON("data/weekly.json").catch(() => []);

  // 固定版型海報：設計稿 1280×720（16:9），一律等比縮放，不因視窗寬度重排。
  const STAGE_W = 1280, STAGE_H = 720, PHOTO_SLOTS = 4;

  const subjects = [
    ["chinese", "📖", "國語", "var(--pink)"],
    ["math", "🔢", "數學", "var(--sky)"],
    ["social", "🌏", "社會", "var(--mint)"],
    ["other", "⭐", "其他", "var(--orange)"],
  ];

  // 空欄位也照樣佔位，版面才不會因為某週少填而位移
  const body = s => {
    const items = App.lines(s);
    if (!items.length) return `<p class="wk-empty">本週無</p>`;
    return items.length > 1
      ? `<ul>${items.map(t => `<li>${App.esc(t)}</li>`).join("")}</ul>`
      : `<p>${App.esc(items[0])}</p>`;
  };

  const learning = w => `
    <div class="wk-box wk-learning" style="--c:var(--pink)">
      <span class="wk-title">📚 本週學習重點</span>
      <div class="wk-fit wk-subjects">
        ${subjects.map(([k, icon, label, color]) => `
          <div class="wk-subject">
            <span class="wk-subj-name" style="color:${color}"><span class="wk-subj-icon">${icon}</span>${label}</span>
            <div class="wk-subj-text">${App.esc((w.learning || {})[k] || "—")}</div>
          </div>`).join("")}
      </div>
    </div>`;

  const box = (title, emoji, color, content) => `
    <div class="wk-box" style="--c:${color}">
      <span class="wk-title">${emoji} ${title}</span>
      <div class="wk-fit wk-body">${body(content)}</div>
    </div>`;

  // 下週重要行事：行首「M/D（週）」轉成日期標籤，長文字懸掛縮排不擠壓標籤
  const events = w => {
    const items = App.lines(w.reminders);
    return `
      <div class="wk-box" style="--c:var(--sky)">
        <span class="wk-title">📅 下週重要行事</span>
        <div class="wk-fit">
          ${items.length ? `<ul class="wk-events">
            ${items.map(t => {
              const m = t.match(/^(\d{1,2}\/\d{1,2})\s*[（(]?([一二三四五六日])?[）)]?\s*(.*)$/);
              return m && m[3]
                ? `<li><span class="wk-date">${App.esc(m[1])}${m[2] ? `（${m[2]}）` : ""}</span><span class="wk-ev-text">${App.esc(m[3])}</span></li>`
                : `<li><span class="wk-ev-text">${App.esc(t)}</span></li>`;
            }).join("")}
          </ul>` : `<p class="wk-empty">本週無</p>`}
        </div>
      </div>`;
  };

  // 本週剪影：固定 2×2 四格，不足補留白格，照片再多也只取前 4 張
  const photos = w => {
    const list = (w.images || []).slice(0, PHOTO_SLOTS);
    return `
      <div class="wk-box wk-photos" style="--c:var(--purple)">
        <span class="wk-title">📸 本週剪影</span>
        <div class="wk-photo-grid">
          ${Array.from({ length: PHOTO_SLOTS }, (_, i) => list[i]
            ? `<div class="wk-slot"><img src="${App.esc(list[i])}" alt="週報照片" loading="lazy" /></div>`
            : `<div class="wk-slot wk-slot-empty"></div>`).join("")}
        </div>
      </div>`;
  };

  const poster = (w, i) => `
    <section class="wk-stage" id="w${i}">
      <div class="wk-poster">
        <header class="wk-head">
          <div>
            <h3 class="wk-brand">📰 班級週報</h3>
            <span class="wk-ribbon">${App.esc(w.week)}</span>
            <p class="wk-range">${App.esc(w.range || "")}</p>
          </div>
          <span class="wk-class">班級：<strong>${App.esc(config.className)}</strong></span>
        </header>
        <div class="wk-grid">
          <div class="wk-col wk-col-a">${learning(w)}</div>
          <div class="wk-col wk-col-b">
            ${box("班級活動", "🎉", "var(--mint)", w.activities)}
            ${box("學生亮點", "🌟", "var(--yellow)", w.highlights)}
            ${box("家長配合事項", "💗", "var(--pink)", w.parents)}
          </div>
          <div class="wk-col wk-col-c">
            ${events(w)}
            ${photos(w)}
          </div>
        </div>
      </div>
    </section>`;

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📰 班級週報</h2>
    ${data.length ? `
    <div class="card weekly-nav" style="border-top-color:var(--purple)">
      <strong>歷週索引：</strong>
      <div class="weekly-index" style="margin-top:6px">
        ${data.map((w, i) => `<a href="#w${i}">${App.esc(w.week)}</a>`).join("")}
      </div>
    </div>
    <div class="weekly-main">${data.map(poster).join("")}</div>
    ` : '<p class="empty-hint">第一期週報即將出刊，敬請期待！</p>'}`;

  // 等比縮放：畫布固定 1280×720，依容器寬度縮放，版面永遠一致
  // 719px 以下改走 CSS 堆疊可讀版（海報縮到手機寬會變成 5px 字，無法閱讀）
  const isStacked = () => matchMedia("(max-width: 719px)").matches;

  const fitStages = () => {
    let changed = false;
    document.querySelectorAll(".wk-stage").forEach(stage => {
      if (isStacked()) {
        if (stage.dataset.scale) {
          delete stage.dataset.scale;
          stage.style.removeProperty("--wk-scale");
          stage.style.removeProperty("height");
          changed = true;
        }
        return;
      }
      const scale = stage.clientWidth / STAGE_W;
      // 只在縮放值真的變了才寫入，否則 ResizeObserver 會被自己改的高度重複觸發
      if (Math.abs(scale - parseFloat(stage.dataset.scale || 0)) < 0.001) return;
      stage.dataset.scale = scale;
      stage.style.setProperty("--wk-scale", scale);
      stage.style.height = `${STAGE_H * scale}px`;
      changed = true;
    });
    return changed;
  };

  // 文字自動縮到不溢出：逐級降字級，保證固定版型內不爆框
  const fitText = () => {
    document.querySelectorAll(".wk-fit").forEach(el => {
      el.style.fontSize = "";
      if (isStacked()) return;   // 堆疊版箱高隨內容長，不需要縮字
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollHeight > el.clientHeight + 1 && size > 11) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    });
  };

  const relayout = () => { fitStages(); fitText(); };
  relayout();
  // 版面／字體載入完成後寬度才會定案，用 ResizeObserver 盯住，避免一次性計算算到舊寬度
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(relayout);
    document.querySelectorAll(".wk-stage").forEach(s => ro.observe(s));
  }
  addEventListener("resize", relayout);
  // 海報版 ↔ 堆疊版切換的明確觸發點（只靠 resize 事件在某些情況不會補算）
  matchMedia("(max-width: 719px)").addEventListener("change", relayout);
  if (document.fonts?.ready) document.fonts.ready.then(relayout);
  document.querySelectorAll(".wk-photos img").forEach(img => img.addEventListener("load", relayout));

  document.getElementById("main").addEventListener("click", e => {
    if (e.target.tagName !== "IMG") return;
    const box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = `<button class="close" aria-label="關閉">×</button><img src="${e.target.src}" alt="" />`;
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  });
})();
