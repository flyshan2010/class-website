(async () => {
  const c = await App.init("calendar");
  const events = await App.fetchJSON("data/calendar.json").catch(() => []);
  const today = App.todayISO();
  const upcoming = events.filter(e => (e.endDate || e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📅 班級行事曆</h2>
    <div class="card" style="padding:10px">
      <iframe src="${App.esc(c.gcalEmbedUrl)}" style="border:0;width:100%;height:70vh;min-height:480px;border-radius:12px" frameborder="0" scrolling="no" title="班級 Google 行事曆"></iframe>
    </div>
    ${upcoming.length ? `
    <h2 class="page-title" style="margin-top:26px"><span class="dot"></span>近期事件</h2>
    ${upcoming.map(e => `
      <section class="card">
        <h3><span class="badge type-${App.esc(e.type || "其他")}">${App.esc(e.type || "行事")}</span> ${App.esc(e.title)}</h3>
        <p class="meta">${App.fmtDate(e.date)}${e.endDate && e.endDate !== e.date ? ` ～ ${App.fmtDate(e.endDate)}` : ""}</p>
        ${e.notes ? `<p>${App.esc(e.notes)}</p>` : ""}
      </section>`).join("")}` : ""}`;
})();
