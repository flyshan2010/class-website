(async () => {
  await App.init("calendar");
  const events = await App.fetchJSON("data/calendar.json").catch(() => []);
  const today = App.todayISO();
  let cur = new Date(); cur.setDate(1);

  const eventsOn = iso => events.filter(e => e.date <= iso && (e.endDate || e.date) >= iso);

  const renderMonth = () => {
    const y = cur.getFullYear(), m = cur.getMonth();
    document.getElementById("cal-month").textContent = `${y} 年 ${m + 1} 月`;
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = i - first + 1;
      let iso, label, other = false;
      if (d < 1) { label = prevDays + d; other = true; iso = null; }
      else if (d > days) { label = d - days; other = true; iso = null; }
      else { label = d; iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
      const evs = iso ? eventsOn(iso) : [];
      cells += `<div class="cal-cell ${other ? "other" : ""} ${iso === today ? "today" : ""}">
        <div class="d">${label}</div>
        ${evs.map(e => `<div class="cal-event type-${App.esc(e.type || "其他")}" title="${App.esc(e.title)}">${App.esc(e.title)}</div>`).join("")}
      </div>`;
      if (d >= days && (i + 1) % 7 === 0) break;
    }
    document.getElementById("cal-cells").innerHTML =
      "日一二三四五六".split("").map(w => `<div class="dow">${w}</div>`).join("") + cells;
  };

  const upcoming = events.filter(e => (e.endDate || e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📅 班級行事曆</h2>
    <div class="cal-toolbar">
      <button id="cal-prev" aria-label="上個月">←</button>
      <div class="cal-month" id="cal-month"></div>
      <button id="cal-next" aria-label="下個月">→</button>
    </div>
    <div class="cal-grid" id="cal-cells"></div>
    <h2 class="page-title" style="margin-top:26px"><span class="dot"></span>近期事件</h2>
    ${upcoming.length ? upcoming.map(e => `
      <section class="card">
        <h3><span class="badge type-${App.esc(e.type || "其他")}">${App.esc(e.type || "行事")}</span> ${App.esc(e.title)}</h3>
        <p class="meta">${App.fmtDate(e.date)}${e.endDate && e.endDate !== e.date ? ` ～ ${App.fmtDate(e.endDate)}` : ""}</p>
        ${e.notes ? `<p>${App.esc(e.notes)}</p>` : ""}
      </section>`).join("") : '<p class="empty-hint">近期沒有事件</p>'}`;

  document.getElementById("cal-prev").onclick = () => { cur.setMonth(cur.getMonth() - 1); renderMonth(); };
  document.getElementById("cal-next").onclick = () => { cur.setMonth(cur.getMonth() + 1); renderMonth(); };
  renderMonth();
})();
