(async () => {
  await App.init("schedule");
  const s = await App.fetchJSON("data/schedule.json").catch(() => null);
  if (!s) {
    document.getElementById("main").innerHTML = '<p class="empty-hint">日課表尚未設定</p>';
    return;
  }
  const days = ["一", "二", "三", "四", "五"];
  const cellInfo = cell => typeof cell === "string"
    ? { subject: cell, teacher: "", room: "" }
    : { subject: cell?.subject || "", teacher: cell?.teacher || "", room: cell?.room || "" };
  const color = subj => (s.subjectColors || {})[subj] || "#fafaf5";

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🕐 日課表</h2>
    <div class="card" style="overflow-x:auto">
      <table class="schedule-table">
        <thead><tr><th>節次</th>${days.map(d => `<th>星期${d}</th>`).join("")}</tr></thead>
        <tbody>
          ${s.periods.map((p, r) => `
            <tr>
              <th>${App.esc(p.name)}<br /><small>${App.esc(p.time || "")}</small></th>
              ${days.map((_, cIdx) => {
                const { subject, teacher, room } = cellInfo((s.table[r] || [])[cIdx]);
                const sub = [teacher, room].filter(Boolean).join("・");
                return `<td style="background:${color(subject)}">${App.esc(subject)}${sub ? `<br /><small style="color:var(--ink-soft)">${App.esc(sub)}</small>` : ""}</td>`;
              }).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${s.notes ? `<div class="card"><h3>📌 說明</h3>${App.ul(s.notes)}</div>` : ""}`;
})();
