(async () => {
  const c = await App.init("about");
  const about = await App.fetchJSON("data/about.json").catch(() => null);

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🌈 關於我們</h2>
    <section class="card">
      <h2>${c.schoolYear} ${c.schoolName} ${c.className}</h2>
      <p>${App.esc(about?.intro || "我們是一個充滿活力的班級！")}</p>
    </section>
    ${about?.teacherWords ? `
    <section class="card" style="border-top-color:var(--mint)">
      <h3>💬 老師的話</h3>
      ${App.lines(about.teacherWords).map(t => `<p>${App.esc(t)}</p>`).join("")}
    </section>` : ""}
    ${about?.rules ? `
    <section class="card" style="border-top-color:var(--yellow)">
      <h3>🤝 班級公約</h3>
      ${App.ul(about.rules)}
    </section>` : ""}`;
})();
