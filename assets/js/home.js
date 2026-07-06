(async () => {
  const c = await App.init("home");
  const [contact, ann, cal, weekly, gallery, countdown, emotionCards] = await Promise.all([
    App.fetchJSON("data/contactbook.json").catch(() => []),
    App.fetchJSON("data/announcements.json").catch(() => []),
    App.fetchJSON("data/calendar.json").catch(() => []),
    App.fetchJSON("data/weekly.json").catch(() => []),
    App.fetchJSON("data/gallery.json").catch(() => []),
    App.fetchJSON("data/countdown.json").catch(() => []),
    App.fetchJSON("data/emotion-cards.json").catch(() => []),
  ]);

  const today = App.todayISO();
  const latestContact = contact.find(x => x.date <= today) || contact[0];

  // 最新公告：置頂＋兩週內（班級與學校都收，標籤區分）
  const twoWeeksAgo = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const topAnn = ann.filter(a => a.pinned || a.date >= twoWeeksAgo)
    .sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date));

  // 近期行事：未來（含今天）最近 5 件，不限日期範圍
  const upcoming = cal.filter(e => (e.endDate || e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  // 日期倒數：countdown.json ＋ 行事曆事件合併，取未來 5 件
  const cdItems = [
    ...countdown.map(x => ({ ...x })),
    ...cal.map(e => ({ title: e.title, date: e.date, emoji: { "考試": "📝", "活動": "🎪", "放假": "🏖️" }[e.type] || "📌" })),
  ]
    .filter(x => x.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((x, i, arr) => arr.findIndex(y => y.title === x.title && y.date === x.date) === i)
    .slice(0, 1); // 一次只倒數一個，日期到了自動換下一個

  const dayDiff = d => Math.round((new Date(d + "T00:00:00") - new Date(today + "T00:00:00")) / 864e5);
  const cdBadge = n => n === 0 ? '<span class="cd-days today">就是今天</span>'
    : `<span class="cd-days ${n <= 7 ? "soon" : ""}">還有 ${n} 天</span>`;

  const latestWeekly = weekly[0];
  const latestAlbum = gallery[0];

  document.getElementById("main").innerHTML = `
    <div class="home-layout">
      <aside class="side-menu" aria-label="功能選單">
        ${c.nav.filter(n => n.id !== "home").map(n => `
          <a class="module-card" href="${n.href}" style="--mc:${c.moduleColors[n.id] || "#54A0FF"}">
            <span class="icon">${n.icon}</span>
            <span class="label">${n.label}</span>
          </a>`).join("")}
      </aside>

      <div class="home-main">
        <section class="card" style="--accent:${c.moduleColors.announcements}">
          <h2>📣 最新公告</h2>
          ${topAnn.length ? topAnn.map(a => `
            <p>${a.pinned ? '<span class="badge pin">置頂</span> ' : ""}<span class="badge src-${App.esc(a.source || "班級")}">${App.esc(a.source || "班級")}公告</span> <span class="badge cat-${App.esc(a.category || "其他")}">${App.esc(a.category || "公告")}</span>
            <strong>${App.esc(a.title)}</strong> <span class="meta">${App.fmtDateShort(a.date)}</span></p>`).join("") : '<p class="empty-hint">目前沒有公告</p>'}
          <p><a href="announcements.html">全部公告 →</a></p>
        </section>

        ${latestContact ? `
        <section class="card contact-day ${latestContact.date === today ? "today" : ""}" style="--accent:${c.moduleColors.contactbook}">
          <div class="day-head">
            <h2>📒 ${latestContact.date === today ? "今日" : "最新"}聯絡簿</h2>
            <span class="meta">${App.fmtDate(latestContact.date)}</span>
          </div>
          <div class="contact-section"><span class="sec-title">✏️ 今日作業</span>${App.ul(latestContact.homework) || "<p>今天沒有作業，太棒了！</p>"}</div>
          ${latestContact.bring ? `<div class="contact-section"><span class="sec-title">🎒 攜帶物品</span>${App.ul(latestContact.bring)}</div>` : ""}
          ${latestContact.notes ? `<div class="contact-section"><span class="sec-title">📌 提醒事項</span>${App.ul(latestContact.notes)}</div>` : ""}
          <p style="margin-top:8px"><a href="contactbook.html">看更多聯絡簿 →</a></p>
        </section>` : ""}

        ${latestWeekly ? `
        <section class="card weekly-card" style="--accent:${c.moduleColors.weekly}">
          <h2>📰 最新週報：${App.esc(latestWeekly.week)}</h2>
          <p class="meta">${App.esc(latestWeekly.range || "")}</p>
          <p>${App.esc(App.lines(latestWeekly.highlights)[0] || App.lines(latestWeekly.learning?.chinese)[0] || "")}…</p>
          <p><a href="weekly.html">閱讀完整週報 →</a></p>
        </section>` : ""}

        ${latestAlbum ? `
        <section class="card" style="--accent:${c.moduleColors.gallery}">
          <h2>🖼️ 最新相簿</h2>
          <a class="album-card" href="gallery.html" style="box-shadow:none">
            ${latestAlbum.cover ? `<img class="cover" src="${App.esc(latestAlbum.cover)}" alt="${App.esc(latestAlbum.title)}" loading="lazy" />` : ""}
            <div class="info"><strong>${App.esc(latestAlbum.title)}</strong><div class="meta">${App.fmtDate(latestAlbum.date)}</div></div>
          </a>
        </section>` : ""}
      </div>

      <aside class="home-right" aria-label="日期倒數與近期行事">
        ${cdItems.length ? `
        <section class="card" style="--accent:${c.moduleColors.calendar}">
          <h2>⏳ 日期倒數</h2>
          <div class="countdown-list" style="margin-top:8px">
            ${cdItems.map(x => `
              <div class="countdown-item">
                <span class="emoji">${App.esc(x.emoji || "📌")}</span>
                <span class="cd-title">${App.esc(x.title)}<small style="color:var(--ink-soft)">　${App.fmtDate(x.date)}</small></span>
                ${cdBadge(dayDiff(x.date))}
              </div>`).join("")}
          </div>
        </section>` : ""}

        ${emotionCards.length ? `
        <section class="card emotion-widget" style="--accent:${c.moduleColors.about}">
          <h2>🌈 彩虹情緒卡</h2>
          <div id="emotion-card" class="emotion-card">
            <p class="emo-zh">你的情緒，<br />是認識自己的導航系統。</p>
            <p class="emo-en">Your emotions are the navigation system to knowing yourself.</p>
          </div>
          <p class="emo-hint">✨ 深呼吸，用<strong>左手</strong>抽一張 ✨</p>
          <button id="emotion-draw" class="emotion-draw">🎲 抽取今日能量</button>
        </section>` : ""}

        <section class="card" style="--accent:${c.moduleColors.calendar}">
          <h2>📅 近期行事</h2>
          ${upcoming.length ? upcoming.map(e => `
            <p><span class="badge type-${App.esc(e.type || "其他")}">${App.esc(e.type || "行事")}</span>
            ${App.esc(e.title)} <span class="meta">${App.fmtDate(e.date)}</span></p>`).join("") : '<p class="empty-hint">目前沒有行事資料</p>'}
          <p><a href="calendar.html">完整行事曆 →</a></p>
        </section>
      </aside>
    </div>`;

  // 彩虹情緒卡：抽一張（資料取自 Super Jessica 學生彩虹情緒卡）
  const drawBtn = document.getElementById("emotion-draw");
  if (drawBtn) {
    const cardEl = document.getElementById("emotion-card");
    let last = -1;
    drawBtn.addEventListener("click", () => {
      let i;
      do { i = Math.floor(Math.random() * emotionCards.length); } while (i === last && emotionCards.length > 1);
      last = i;
      const card = emotionCards[i];
      cardEl.classList.remove("drawn");
      void cardEl.offsetWidth; // 重新觸發動畫
      cardEl.classList.add("drawn");
      cardEl.style.background = `linear-gradient(135deg, ${card.colors.join(", ")})`;
      cardEl.innerHTML = `
        <p class="emo-zh">${App.esc(card.zh)}</p>
        <p class="emo-en">${App.esc(card.en)}</p>
        <p class="emo-no">No.${i + 1} / ${emotionCards.length}</p>`;
      drawBtn.textContent = "🎲 再抽一張";
    });
  }
})();
