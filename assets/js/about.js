(async () => {
  const c = await App.init("about");
  const about = await App.fetchJSON("data/about.json").catch(() => null);

  // 幹部職級 emoji（依週薪對應制度三級：30 領導職／25 股長職／20 專員職）
  const roleEmoji = salary => salary >= 30 ? "👑" : salary >= 25 ? "⭐" : "🔧";

  // 幹部六大分組（依「班級幹部分組表」；同組職務依此順序；未列入的職務歸「其他幹部」組）
  const CADRE_GROUPS = [
    { name: "班級領導組", emoji: "🎖️", roles: ["班長", "副班長", "秩序股長"] },
    { name: "學術與資訊組", emoji: "📚", roles: ["學藝股長", "作業小組長", "資訊小組長"] },
    { name: "生活與衛生組", emoji: "🧹", roles: ["衛生股長", "潔牙小組長", "環保小尖兵", "午餐小組長"] },
    { name: "體育與活動組", emoji: "⚽", roles: ["體育股長", "晨運小組長"] },
    { name: "總務與文宣組", emoji: "🗂️", roles: ["總務股長", "文宣小組"] },
    { name: "服務與支援組", emoji: "💗", roles: ["服務股長", "晨讀小組長", "愛心小天使", "集點小幫手"] },
  ];

  // 依組別＋職務彙整幹部（同職務多人合併列名）
  const cadreGroups = cadres => {
    const used = new Set();
    const blocks = CADRE_GROUPS.map(g => {
      const roles = g.roles.map(rn => {
        const members = cadres.filter(x => String(x.role).trim() === rn);
        members.forEach(m => used.add(m));
        if (!members.length) return null;
        return { role: rn, names: members.map(m => m.name), desc: members[0].desc, salary: members[0].salary };
      }).filter(Boolean);
      return { ...g, roles, count: roles.reduce((s, r) => s + r.names.length, 0) };
    }).filter(b => b.roles.length);
    // 未歸類職務 → 其他幹部組
    const rest = cadres.filter(x => !used.has(x));
    if (rest.length) {
      const byRole = {};
      rest.forEach(x => (byRole[String(x.role).trim()] ||= []).push(x));
      const roles = Object.entries(byRole).map(([role, ms]) =>
        ({ role, names: ms.map(m => m.name), desc: ms[0].desc, salary: ms[0].salary }));
      blocks.push({ name: "其他幹部", emoji: "🌟", roles, count: rest.length });
    }
    return blocks;
  };

  const cadreSection = cadres => `
    <div class="cadre-groups">
      ${cadreGroups(cadres).map((b, gi) => `
      <div class="cadre-group cadre-g${gi % 6}">
        <div class="cadre-group-head">${b.emoji} ${App.esc(b.name)}<span class="cadre-group-count">${b.count} 人</span></div>
        <div class="cadre-group-body">
          ${b.roles.map(r => `
          <div class="cadre-role-block">
            <div class="cadre-role-line">
              <span class="cadre-role-name">${roleEmoji(r.salary)} ${App.esc(r.role)}</span>
              ${r.salary ? `<span class="cadre-salary-tag">🪙 ${r.salary}</span>` : ""}
            </div>
            <div class="cadre-people">${r.names.map(n => App.esc(n)).join("、")}</div>
            ${r.desc ? `<div class="cadre-desc">${App.esc(r.desc)}</div>` : ""}
          </div>`).join("")}
        </div>
      </div>`).join("")}
    </div>`;

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
      <p class="meta">幹部＝班級的工作職務，分六大組協力運作，每週依職級領崑山幣薪水（詳見小小銀行）。</p>
      ${cadreSection(about.cadres)}
    </section>` : ""}`;
})();
