/* 聯絡簿頁：月曆式檢視
 * ・上方月曆＝查找某一天（有聯絡簿的日子才可點；已過的日期變暗但仍查得到）
 * ・中間黑板＝點選那天的完整內容（版面同首頁「當天聯絡簿」）
 * ・下方清單＝今天以後的聯絡簿，由早到晚；已過的不列出，避免資訊干擾
 */
(async () => {
  const c = await App.init("contactbook");
  const data = await App.fetchJSON("data/contactbook.json").catch(() => []);
  const today = App.todayISO();

  const byDate = new Map(data.map(d => [d.date, d]));
  const days = [...data].sort((a, b) => a.date.localeCompare(b.date)); // 由早到晚
  // 未過期的全部（給預設選日用）；下方清單只列最近 5 天——整學期公開後也不會變成長長一串，
  // 想看更後面的日子用上方月曆點選。
  const upcomingAll = days.filter(d => d.date >= today);
  const UPCOMING_MAX = 5;
  const upcoming = upcomingAll.slice(0, UPCOMING_MAX);

  // 可翻閱的月份範圍：有資料的第一個月～最後一個月（含今天所在月）
  const ym = iso => iso.slice(0, 7);
  const months = [...new Set([...days.map(d => ym(d.date)), ym(today)])].sort();
  const minM = months[0], maxM = months.at(-1);

  let selected = upcomingAll[0]?.date || days.at(-1)?.date || null; // 預設看最早的未過期那天
  let cursor = ym(selected || today);

  const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
  const pad = n => String(n).padStart(2, "0");
  const shiftMonth = (m, step) => {
    const [y, mm] = m.split("-").map(Number);
    const d = new Date(y, mm - 1 + step, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };

  function calendarHTML() {
    const [Y, M] = cursor.split("-").map(Number);
    const lead = new Date(Y, M - 1, 1).getDay();
    const total = new Date(Y, M, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell blank"></div>');
    for (let d = 1; d <= total; d++) {
      const iso = `${Y}-${pad(M)}-${pad(d)}`;
      const has = byDate.has(iso);
      const cls = ["cal-cell",
        has ? "has" : "none",
        iso < today ? "past" : "",
        iso === today ? "today" : "",
        iso === selected ? "sel" : ""].filter(Boolean).join(" ");
      cells.push(has
        ? `<button type="button" class="${cls}" data-date="${iso}" aria-label="${M}月${d}日聯絡簿">${d}<span class="dot"></span></button>`
        : `<div class="${cls}">${d}</div>`);
    }
    return `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-go="-1" ${cursor <= minM ? "disabled" : ""}>‹</button>
        <strong>${Y} 年 ${M} 月</strong>
        <button type="button" class="cal-nav" data-go="1" ${cursor >= maxM ? "disabled" : ""}>›</button>
      </div>
      <div class="cal-grid">
        ${WEEK.map(w => `<div class="cal-w">${w}</div>`).join("")}
        ${cells.join("")}
      </div>
      <p class="cal-legend"><span class="lg has"></span>有聯絡簿　<span class="lg past"></span>已過的日子（變暗）　<span class="lg today"></span>今天</p>`;
  }

  const listHTML = () => upcoming.length
    ? upcoming.map(d => `
      <section class="card contact-day ${d.date === today ? "today" : ""}">
        <div class="day-head">
          <h2>${App.fmtDate(d.date)}</h2>
          ${d.date === today ? '<span class="badge" style="background:var(--orange)">今天</span>'
            : '<span class="badge" style="background:var(--sky)">預告</span>'}
        </div>
        <div class="contact-section"><span class="sec-title">✏️ 本日功課</span>${App.ul(d.homework) || "<p>今天沒有功課！</p>"}</div>
        ${d.bring ? `<div class="contact-section"><span class="sec-title">🎒 攜帶物品</span>${App.ul(d.bring)}</div>` : ""}
        ${d.notes ? `<div class="contact-section"><span class="sec-title">📌 提醒事項</span>${App.ul(d.notes)}</div>` : ""}
      </section>`).join("")
    : '<p class="empty-hint">接下來還沒有新的聯絡簿</p>';

  const moreHint = upcomingAll.length > UPCOMING_MAX
    ? `<p class="meta" style="margin:10px 0 0">只列最近 ${UPCOMING_MAX} 天；更後面的日子請用上方月曆點選 📅</p>`
    : "";

  const main = document.getElementById("main");
  main.innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📒 聯絡簿</h2>
    <section class="card cb-cal" style="--accent:${c.moduleColors.contactbook}">
      <h2>📅 選一天看看</h2>
      <div id="cal-body">${calendarHTML()}</div>
    </section>
    <div id="cb-detail">${App.chalkBoard(byDate.get(selected), c.spar, { title: "聯絡簿" })}</div>
    <h3 class="cb-list-title">🔜 接下來的聯絡簿</h3>
    <div id="cb-list">${listHTML()}</div>
    ${moreHint}`;

  const calBody = document.getElementById("cal-body");
  const detail = document.getElementById("cb-detail");

  calBody.addEventListener("click", e => {
    const nav = e.target.closest(".cal-nav");
    if (nav) {
      cursor = shiftMonth(cursor, Number(nav.dataset.go));
      calBody.innerHTML = calendarHTML();
      return;
    }
    const cell = e.target.closest(".cal-cell[data-date]");
    if (!cell) return;
    selected = cell.dataset.date;
    calBody.innerHTML = calendarHTML();
    detail.innerHTML = App.chalkBoard(byDate.get(selected), c.spar, { title: "聯絡簿" });
  });
})();
