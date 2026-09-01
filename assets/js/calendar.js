(async () => {
  const c = await App.init("calendar");
  const events = await App.fetchJSON("data/calendar.json").catch(() => []);
  const today = App.todayISO();
  const thisWeek = await App.weekOf(today);
  // 近期事件逐則標週次：家長／學生看行事曆時最常問的是「那是第幾週」，
  // 週次來自 data/weeks.json（單一出處），假期事件沒有週次就不顯示徽章。
  const weekBadges = new Map();
  for (const e of events) if (!weekBadges.has(e.date)) weekBadges.set(e.date, await App.weekBadge(e.date));
  const upcoming = events.filter(e => (e.endDate || e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);

  // 活動說明：Google 日曆的說明欄已在 sync-gcal 剝成純文字換行。
  // 一律用同一種摺疊呈現，長短都一樣——近期事件一次列 10 則，
  // 有的攤開有的收起會讓整頁參差；統一收起後每則就是一行標題＋一行日期，掃一眼就看完。
  const notesHtml = notes => {
    const ls = App.lines(notes);
    if (!ls.length) return "";
    const body = ls.map(t => `<p>${App.esc(t)}</p>`).join("");
    return `<details class="event-notes"><summary>活動說明（點開看全文）</summary>${body}</details>`;
  };

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📅 班級行事曆</h2>
    <p class="meta" style="margin:-6px 0 14px">${thisWeek
      ? `今天是 <strong>${App.esc(thisWeek.學期名稱)}第${thisWeek.週次}週</strong>${App.esc((thisWeek.標籤.match(/\(.+\)$/) || [""])[0])}`
      : "目前為假期，沒有學校週次"}</p>
    <div class="card" style="padding:10px">
      <iframe src="${App.esc(c.gcalEmbedUrl)}" style="border:0;width:100%;height:70vh;min-height:480px;border-radius:12px" frameborder="0" scrolling="no" title="班級 Google 行事曆"></iframe>
    </div>
    ${upcoming.length ? `
    <h2 class="page-title" style="margin-top:26px"><span class="dot"></span>近期事件</h2>
    ${upcoming.map(e => `
      <section class="card">
        <h3><span class="badge type-${App.esc(e.type || "其他")}">${App.esc(e.type || "行事")}</span> ${App.esc(e.title)}</h3>
        ${weekBadges.get(e.date) ? `<p class="meta" style="margin:2px 0 0">🗓️ ${App.esc(weekBadges.get(e.date))}</p>` : ""}
        <p class="meta">${App.fmtEventDate(e)}</p>
        ${notesHtml(e.notes)}
      </section>`).join("")}` : ""}`;
})();
