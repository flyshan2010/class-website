(async () => {
  await App.init("schedule");
  const s = await App.fetchJSON("data/schedule.json").catch(() => null);
  if (!s) {
    document.getElementById("main").innerHTML = '<p class="empty-hint">日課表尚未設定</p>';
    return;
  }
  const days = ["一", "二", "三", "四", "五"];
  const subjectColor = subj => {
    const map = s.subjectColors || {};
    return map[subj] || "#fafaf5";
  };

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🕐 日課表</h2>
    <div class="card" style="overflow-x:auto">
      <table class="schedule-table">
        <thead><tr><th>節次</th>${days.map(d => `<th>星期${d}</th>`).join("")}</tr></thead>
        <tbody>
          ${s.periods.map((p, r) => `
            <tr>
              <th>${App.esc(p.name)}<br /><small>${App.esc(p.time || "")}</small></th>
              ${days.map((_, c) => {
                const subj = (s.table[r] || [])[c] || "";
                return `<td style="background:${subjectColor(subj)}">${App.esc(subj)}</td>`;
              }).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${s.notes ? `<div class="card"><h3>📌 說明</h3>${App.ul(s.notes)}</div>` : ""}`;
})();
