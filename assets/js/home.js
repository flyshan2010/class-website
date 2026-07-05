(async () => {
  const c = await App.init("home");
  const [contact, ann, cal, weekly, gallery] = await Promise.all([
    App.fetchJSON("data/contactbook.json").catch(() => []),
    App.fetchJSON("data/announcements.json").catch(() => []),
    App.fetchJSON("data/calendar.json").catch(() => []),
    App.fetchJSON("data/weekly.json").catch(() => []),
    App.fetchJSON("data/gallery.json").catch(() => []),
  ]);

  const today = App.todayISO();
  const latestContact = contact.find(x => x.date <= today) || contact[0];
  const topAnn = [...ann].sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date)).slice(0, 3);
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const upcoming = cal.filter(e => (e.endDate || e.date) >= today && e.date <= in14)
                      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const latestWeekly = weekly[0];
  const latestAlbum = gallery[0];

  document.getElementById("main").innerHTML = `
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

    <div class="home-grid">
      <section class="card" style="--accent:${c.moduleColors.announcements}">
        <h2>📣 最新公告</h2>
        ${topAnn.length ? topAnn.map(a => `
          <p>${a.pinned ? '<span class="badge pin">置頂</span> ' : ""}<span class="badge cat-${App.esc(a.category || "其他")}">${App.esc(a.category || "公告")}</span>
          <strong>${App.esc(a.title)}</strong> <span class="meta">${App.fmtDate(a.date)}</span></p>`).join("") : '<p class="empty-hint">目前沒有公告</p>'}
        <p><a href="announcements.html">全部公告 →</a></p>
      </section>

      <section class="card" style="--accent:${c.moduleColors.calendar}">
        <h2>📅 近期行事</h2>
        ${upcoming.length ? upcoming.map(e => `
          <p><span class="badge type-${App.esc(e.type || "其他")}">${App.esc(e.type || "行事")}</span>
          ${App.esc(e.title)} <span class="meta">${App.fmtDate(e.date)}</span></p>`).join("") : '<p class="empty-hint">兩週內沒有活動</p>'}
        <p><a href="calendar.html">完整行事曆 →</a></p>
      </section>
    </div>

    <div class="home-grid">
      ${latestWeekly ? `
      <section class="card weekly-card" style="--accent:${c.moduleColors.weekly}">
        <h2>📰 最新週報：${App.esc(latestWeekly.week)}</h2>
        <p class="meta">${App.esc(latestWeekly.range || "")}</p>
        <p>${App.esc(App.lines(latestWeekly.highlights)[0] || App.lines(latestWeekly.learning)[0] || "")}…</p>
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

    <h2 class="page-title"><span class="dot"></span>功能選單</h2>
    <div class="module-grid">
      ${c.nav.filter(n => n.id !== "home").map(n => `
        <a class="module-card" href="${n.href}" style="--mc:${c.moduleColors[n.id] || "#54A0FF"}">
          <div class="icon">${n.icon}</div>
          <div class="label">${n.label}</div>
        </a>`).join("")}
    </div>`;
})();
