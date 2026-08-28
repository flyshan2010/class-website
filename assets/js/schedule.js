(async () => {
  await App.init("schedule");
  const s = await App.fetchJSON("data/schedule.json").catch(() => null);
  if (!s) {
    document.getElementById("main").innerHTML = '<p class="empty-hint">日課表尚未設定</p>';
    return;
  }
  const days = ["一", "二", "三", "四", "五"];
  const cellInfo = cell => typeof cell === "string"
    ? { subject: cell, teacher: "", room: "", parallel: [] }
    : {
        subject: cell?.subject || "", teacher: cell?.teacher || "", room: cell?.room || "",
        parallel: Array.isArray(cell?.parallel) ? cell.parallel : [],
      };
  /* 配色：老師把「(彈性)」改寫成「(彈)」時不該整格變白，
     所以照「原名 → 統一寫法 → 去掉括號的科目名」依序找，找不到才用預設底色。 */
  const color = subj => {
    const c = s.subjectColors || {};
    return c[subj] || c[App.subjKey(subj)] || c[App.subjBase(subj)] || "#fafaf5";
  };
  const line = (o, cls) => {
    const sub = [o.teacher, o.room].filter(Boolean).join("・");
    return `<div class="${cls}">${App.esc(o.subject)}${sub
      ? `<br /><small style="color:var(--ink-soft)">${App.esc(sub)}</small>` : ""}</div>`;
  };

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🕐 日課表</h2>
    <p class="scroll-hint">← 左右滑動看完整課表 →</p>
    <div class="card" style="overflow-x:auto">
      <table class="schedule-table">
        <colgroup><col class="col-period" />${days.map(() => "<col />").join("")}</colgroup>
        <thead><tr><th>節次</th>${days.map(d => `<th>星期${d}</th>`).join("")}</tr></thead>
        <tbody>
          ${s.periods.map((p, r) => `
            <tr>
              <th>${App.esc(p.name)}<br /><small>${App.esc(p.time || "")}</small></th>
              ${days.map((_, cIdx) => {
                const info = cellInfo((s.table[r] || [])[cIdx]);
                // 同節並排：第一個是該節主課程，其餘是被抽走的那幾位同學同時段上的課
                return `<td style="background:${color(info.subject)}">${line(info, "sched-main")}${
                  info.parallel.map(o => `<div class="sched-alt" style="background:${color(o.subject)}">
                    <span class="sched-alt-tag">同節・部分同學</span>${line(o, "")}</div>`).join("")}</td>`;
              }).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${s.notes ? `<div class="card"><h3>📌 說明</h3>${App.ul(s.notes)}</div>` : ""}`;
})();
