(async () => {
  const c = await App.init("about");
  const about = await App.fetchJSON("data/about.json").catch(() => null);

  // 幹部職級 emoji（依週薪對應制度三級：30 領導職／25 股長職／20 專員職）
  const roleEmoji = salary => salary >= 30 ? "👑" : salary >= 25 ? "⭐" : "🔧";

  // 班級公約海報式排版：行格式「N｜大字標題｜小字說明」→ 編號色條；
  // 開頭非編號行依序當作「小標語＋大標題」；整段沒有編號行時退回原本 bullet 清單。
  const rulesPoster = text => {
    const lines = App.lines(text);
    const items = [], heads = [];
    for (const ln of lines) {
      const m = ln.match(/^(\d+)\s*[｜|]\s*(.+?)\s*[｜|]\s*(.+)$/);
      if (m) items.push({ n: m[1], main: m[2], sub: m[3] });
      else heads.push(ln);
    }
    if (!items.length) return App.ul(text);
    return `
      <div class="rules-poster">
        ${heads[0] ? `<div class="rules-kicker">${App.esc(heads[0])}</div>` : ""}
        ${heads[1] ? `<div class="rules-title">${App.esc(heads[1])}</div>` : ""}
        ${items.map((it, i) => `
        <div class="rules-item rules-c${i % 5}">
          <span class="rules-num">${App.esc(it.n)}</span>
          <div class="rules-text">
            <div class="rules-main">${App.esc(it.main)}</div>
            <div class="rules-sub">${App.esc(it.sub)}</div>
          </div>
        </div>`).join("")}
      </div>`;
  };

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
      ${rulesPoster(about.rules)}
      ${about.rulesImages?.length ? `
      <div class="about-rule-photos">
        ${about.rulesImages.map(src => `<img src="${src}" alt="班級公約" loading="lazy" />`).join("")}
      </div>` : ""}
    </section>` : ""}
    ${about?.cadres?.length ? `
    <section class="card" style="border-top-color:var(--pink)">
      <h3>🧑‍💼 班級幹部</h3>
      <p class="meta">幹部＝班級的工作職務，每週依職級領崑山幣薪水（詳見小小銀行）。</p>
      <div class="cadre-grid">
        ${about.cadres.map(x => `
          <div class="cadre-card">
            <div class="cadre-role">${roleEmoji(x.salary)} ${App.esc(x.role)}</div>
            <div class="cadre-name">${App.esc(x.name)}</div>
            ${x.desc ? `<div class="cadre-desc">${App.esc(x.desc)}</div>` : ""}
            ${x.salary ? `<div class="cadre-salary">🪙 週薪 ${x.salary} 幣</div>` : ""}
          </div>`).join("")}
      </div>
    </section>` : ""}`;
})();
