(async () => {
  await App.init("contactbook");
  const data = await App.fetchJSON("data/contactbook.json").catch(() => []);
  const today = App.todayISO();
  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📒 聯絡簿</h2>
    ${sorted.length ? sorted.map(d => `
      <section class="card contact-day ${d.date === today ? "today" : ""}">
        <div class="day-head">
          <h2>${App.fmtDate(d.date)}</h2>
          ${d.date === today ? '<span class="badge" style="background:var(--orange)">今天</span>' : ""}
        </div>
        <div class="contact-section"><span class="sec-title">✏️ 今日作業</span>${App.ul(d.homework) || "<p>今天沒有作業！</p>"}</div>
        ${d.bring ? `<div class="contact-section"><span class="sec-title">🎒 攜帶物品</span>${App.ul(d.bring)}</div>` : ""}
        ${d.notes ? `<div class="contact-section"><span class="sec-title">📌 提醒事項</span>${App.ul(d.notes)}</div>` : ""}
      </section>`).join("") : '<p class="empty-hint">還沒有聯絡簿內容</p>'}`;
})();
