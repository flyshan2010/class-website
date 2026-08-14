(async () => {
  const c = await App.init("calendar");
  const events = await App.fetchJSON("data/calendar.json").catch(() => []);
  const today = App.todayISO();
  const upcoming = events.filter(e => (e.endDate || e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);

  // 活動說明：Google 日曆的說明欄已在 sync-gcal 剝成純文字換行。
  // 短的直接攤開；長的收進 <details>，避免一則活動就把整頁佔滿。
  const notesHtml = notes => {
    const ls = App.lines(notes);
    if (!ls.length) return "";
    const body = ls.map(t => `<p>${App.esc(t)}</p>`).join("");
    if (notes.length <= 120) return `<div class="event-notes">${body}</div>`;
    return `<details class="event-notes"><summary>活動說明（點開看全文）</summary>${body}</details>`;
  };

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
        <p class="meta">${App.fmtEventDate(e)}</p>
        ${notesHtml(e.notes)}
      </section>`).join("")}` : ""}`;
})();
