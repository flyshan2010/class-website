(async () => {
  const c = await App.init("about");
  const [about, duties, lunch, seating, classRules] = await Promise.all([
    App.fetchJSON("data/about.json").catch(() => null),
    App.fetchJSON("data/duties.json").catch(() => null),
    App.fetchJSON("data/lunch.json").catch(() => null),
    App.fetchJSON("data/seating.json").catch(() => null),
    App.fetchJSON("data/class-rules.json").catch(() => null),
  ]);

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

  // 「一項工作算一次」獎懲階梯。金額與判準對齊 docs/班級經營與生活常規.md 的獎懲三線：
  // 沒做到先走「同領域邏輯後果」（補做／重做，不扣幣），只有反覆不做才踩班規③扣幣。
  const DUTY_SCORING = [
    { icon: "✅", when: "當天把自己負責的工作做完、做好", act: "檢核表記 1 次 ✓", coin: "", tone: "ok" },
    { icon: "🏅", when: "一週 5 次全部完成", act: "認真負責・程度 1", coin: "+5", tone: "good" },
    { icon: "🔁", when: "有 1～2 次沒做到", act: "補做或重做一次，不扣崑山幣", coin: "0", tone: "warn" },
    { icon: "⚠️", when: "有 3 次以上沒做到", act: "踩到班規③「打掃要認真」・程度 1", coin: "−5", tone: "bad" },
    { icon: "🌟", when: "做得特別好、被公開表揚", act: "亮點・程度 1", coin: "+10", tone: "star" },
  ];

  const scoringCard = () => `
    <div class="duty-score">
      <div class="duty-score-head">
        <span class="duty-score-badge">一項工作 ＝ 一次</span>
        身上有幾項工作就分開算：例如同時有打掃和午餐工作，就是兩條線各自結算。
      </div>
      <div class="duty-score-rows">
        ${DUTY_SCORING.map(r => `
        <div class="duty-score-row t-${r.tone}">
          <span class="ds-icon">${r.icon}</span>
          <span class="ds-when">${App.esc(r.when)}</span>
          <span class="ds-act">${App.esc(r.act)}</span>
          <span class="ds-coin">${r.coin ? `🪙 ${App.esc(r.coin)}` : "—"}</span>
        </div>`).join("")}
      </div>
      <p class="duty-score-note">
        沒做到不是先扣錢——先把它補好，這是「認真負責」真正的意思。
        反覆不做才會扣崑山幣，而且扣到 0 就停，不會變負的。
      </p>
    </div>`;

  // ── 班規與獎懲（資料來自 Notion「📋 班規與獎懲」→ data/class-rules.json）──
  // 老師在 Notion 改行為、點數、改過方式，按「立即更新班網」即生效，不必動程式。
  // 制度正本仍是 Notion 📜 班級獎懲規定頁與 docs/班級經營與生活常規.md（三處要一致）。
  // n：1–8＝八條班規、9＝上課時間、10＝重大安全事件（決定卡序與卡片樣式）。

  // 卡片樣式：1–8 用公約海報的五色循環、9 上課時間灰卡、10 重大安全事件紅卡
  const ruleCardClass = (n, i) => n >= 10 ? "rule-card-serious" : n === 9 ? "rule-card-common" : `rules-c${i % 5}`;

  // 重大安全事件不是「改過」就了事的層級，標籤改稱「處理方式」
  const ruleRows = (list, withFix, fixLabel = "改過方式") => list.map(x => `
    <div class="rule-row">
      <span class="rr-act">${App.esc(x.act)}${withFix && x.fix ? `
        <em class="rr-fix">${fixLabel}：${App.esc(x.fix)}</em>` : ""}</span>
      <span class="rr-coin">🪙 ${App.esc(x.coin)}</span>
    </div>`).join("");

  const ruleCard = (r, i) => {
    const fixLabel = r.n >= 10 ? "處理方式" : "改過方式";
    return `
    <div class="rule-card ${ruleCardClass(r.n, i)}">
      <div class="rule-card-head">
        <div class="rule-names">
          ${r.rule.split(/[、,／\/]/).map(x => `<span class="rule-name-big">${App.esc(x.trim())}</span>`).join("")}
        </div>
      </div>
      ${r.covenant ? `<div class="rule-covenant">🤝 ${App.esc(r.covenant)}</div>` : ""}
      ${r.good.length && r.bad.length ? `
      <div class="rule-cols">
        <div class="rule-col good">
          <div class="rule-col-head">✅ 做到的樣子</div>
          ${ruleRows(r.good, false)}
        </div>
        <div class="rule-col bad">
          <div class="rule-col-head">⚠️ 沒做到怎麼辦</div>
          ${ruleRows(r.bad, true, fixLabel)}
        </div>
      </div>` : `
      <div class="rule-col ${r.good.length ? "good" : "bad"}">
        ${ruleRows(r.good.length ? r.good : r.bad, !r.good.length, fixLabel)}
      </div>`}
    </div>`;
  };

  const rulesLadder = cr => `
    <div class="rule-cards">${(cr?.cards || []).map(ruleCard).join("")}</div>
    <ul class="rule-notes">
      <li><b>扣到 0 就停</b>，不會變成負的。</li>
      <li><b>當天同一不當行為第一次改過，不扣點</b>；若再有，則需改過且扣點。</li>
      <li>另外還有亮點、進步獎、比賽獲獎、布可星球等獎勵，詳見「🏦 小小銀行」。</li>
    </ul>`;

  // ── 一日作息與常規（Notion「🕗 作息與常規」）──
  const routineRows = list => list.map(r => `
    <div class="routine-row">
      <span class="rt-time">${App.esc(r.label)}</span>
      <span class="rt-name">${App.esc(r.name)}</span>
      <span class="rt-sop">${App.esc(r.sop)}</span>
    </div>`).join("");

  const routineCard = cr => `
    <div class="routine-list">${routineRows(cr?.daily || [])}</div>
    ${cr?.flows?.length ? `
    <div class="routine-sub">🔁 上課常規</div>
    <div class="routine-list flows">${routineRows(cr.flows)}</div>` : ""}
    <p class="duty-score-note">
      班級常規沒做到（例如：進教室、排隊、收拾這些「怎麼做」的流程），沒做好就重做一次練到會，<b>不扣點</b>。
    </p>`;

  // 抽獎池＝🏪 班級商店勾「抽獎池」的特權券（與商店同源，抽到的就是平常換得到的那些）
  const luckyDrawCard = cr => {
    const pool = cr?.draw || [];
    if (!pool.length) return '<p class="meta">抽獎池尚未設定。</p>';
    return `
      <p class="meta">連續兩週都沒有違規紀錄，就可以抽一次獎（${pool.length} 選 1）。</p>
      <div class="draw-pool">
        ${pool.map((x, i) => `
        <span class="draw-chip">
          <b>${i + 1}.</b> ${App.esc(x.icon)} ${App.esc(x.name)}
          ${x.desc ? `<em>${App.esc(x.desc)}</em>` : ""}
        </span>`).join("")}
      </div>
      <p class="duty-score-note">
        獎品就是「🏦 小小銀行」商店裡的特權券——平常可以自己存崑山幣換，連續兩週沒有違規也抽得到。
        抽獎是「連續兩週都做得好」的里程碑獎勵，和崑山幣（每次的即時回饋）並行，不衝突。
      </p>`;
  };

  // ── 打掃工作表 ──
  const dutySection = d => !d ? "" : `
    <p class="meta">打掃時間：${App.esc(d.時段)}</p>
    ${d.zones.map(z => `
    <div class="duty-zone">
      <div class="duty-zone-head">${z.emoji} ${App.esc(z.zone)}<span class="duty-zone-count">${z.headcount} 人</span></div>
      <div class="duty-cards">
        ${z.groups.map(g => `
        <div class="duty-card">
          <div class="duty-card-head">${App.esc(g.group)}</div>
          <div class="duty-people">${g.members.map(n => `<span class="duty-chip">${App.esc(n)}</span>`).join("")}${
            g.support.length ? g.support.map(n => `<span class="duty-chip sup">${App.esc(n)}<small>支援</small></span>`).join("") : ""}</div>
          <div class="duty-work">${App.esc(g.work)}</div>
          <div class="duty-tools">🧰 ${g.tools.map(t => App.esc(t)).join("、")}</div>
        </div>`).join("")}
      </div>
    </div>`).join("")}
    ${d.未分配?.length ? `
    <p class="duty-todo">📌 尚待老師安排：${d.未分配.map(n => App.esc(n)).join("、")}</p>` : ""}`;

  // ── 午餐工作表 ──
  // 值週生每週換一次，輪值表由 scripts/build-class-duties.mjs 依規則產生（見 data/lunch.json）。
  const lunchSlots = w => w.assign.map(a => `
    <div class="lunch-slot">
      <div class="lunch-slot-post">${App.esc(a.slot)}</div>
      <div class="lunch-slot-name">${App.esc(a.name)}</div>
    </div>`).join("");

  const lunchSection = l => {
    if (!l) return "";
    const weeks = l.rotation || [];
    return `
      <div class="lunch-fixed">
        ${l.fixed.map(f => `
        <div class="duty-card">
          <div class="duty-card-head">${App.esc(f.post)}
            ${f.isMock ? '<span class="mock-tag">模擬資料・待確認</span>' : ""}</div>
          <div class="duty-people">${f.members.map(n => `<span class="duty-chip">${App.esc(n)}</span>`).join("")}</div>
          <div class="duty-work">${App.esc(f.work)}</div>
        </div>`).join("")}
      </div>

      <div class="lunch-rot">
        <div class="lunch-rot-head">
          <span>🍚 午餐值週生</span>
          <label class="lunch-week-pick">第
            <select id="lunch-week">${weeks.map(w => `<option value="${w.week}">${w.week}</option>`).join("")}</select>
            週</label>
        </div>
        <div id="lunch-week-body" class="lunch-week-cards">${weeks.length ? lunchSlots(weeks[0]) : ""}</div>
        <p class="meta">
          輪值池 ${l.輪值池人數} 人（午餐長與打飯班不輪），每週 ${l.每週人數} 人，
          ${l.完整輪替週數} 週輪完一圈，每人各輪 ${l.每人每輪次數} 次。
        </p>
      </div>

      <ul class="lunch-rules">${l.規則.map(r => `<li>${App.esc(r)}</li>`).join("")}</ul>

      <details class="lunch-all">
        <summary>看完整 ${l.完整輪替週數} 週輪值表</summary>
        <div class="table-scroll">
          <table class="lunch-table">
            <thead><tr><th>週次</th>${(weeks[0]?.assign || []).map(a => `<th>${App.esc(a.slot)}</th>`).join("")}</tr></thead>
            <tbody>
              ${weeks.map(w => `<tr><td>第 ${w.week} 週</td>${w.assign.map(a => `<td>${App.esc(a.name)}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </div>
      </details>`;
  };

  // ── 座位表 ──
  // 欄由左至右為第六排→第一排，列由上至下為前排→後排（與老師提供的原始座位表一致）。
  const seatingSection = s => !s ? "" : `
    <div class="seat-board">🧑‍🏫 講台・黑板</div>
    <div class="table-scroll">
      <table class="seat-grid">
        <thead><tr>${s.columns.map(col => `<th>第${App.esc(col)}排</th>`).join("")}</tr></thead>
        <tbody>
          ${s.grid.map(row => `<tr>${row.map(n =>
            n ? `<td class="seat">${App.esc(n)}</td>` : '<td class="seat empty"></td>').join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
    <p class="meta">${App.esc(s.說明)}</p>`;

  // ── 分頁 ──
  const TABS = [
    {
      id: "intro", icon: "🌈", label: "認識我們",
      html: () => `
        <section class="card">
          <h2>${c.schoolYear} ${c.schoolName} ${c.className}</h2>
          <p>${App.esc(about?.intro || "我們是一個充滿活力的班級！")}</p>
        </section>
        ${c.spar ? `
        <section class="card" style="border-top-color:var(--pink)">
          <h3>⭐ 班級口號</h3>
          ${App.sparPoster(c.spar)}
        </section>` : ""}
        ${about?.teacherWords ? `
        <section class="card" style="border-top-color:var(--mint)">
          <h3>💬 老師的話</h3>
          ${App.lines(about.teacherWords).map(t => `<p>${App.esc(t)}</p>`).join("")}
        </section>` : ""}`,
    },
    {
      id: "rules", icon: "🤝", label: "班級公約",
      html: () => `
        ${about?.rules ? `
        <section class="card" style="border-top-color:var(--yellow)">
          <h3>🤝 班級公約</h3>
          ${rulesPoster(about.rules)}
          ${about.rulesImages?.length ? `
          <div class="about-rule-photos">
            ${about.rulesImages.map(src => `<img src="${App.esc(src)}" alt="班級公約" loading="lazy" />`).join("")}
          </div>` : ""}
        </section>` : ""}
        <section class="card" style="border-top-color:var(--orange)">
          <h3>📋 我們的班規（Rules）</h3>
          <p class="meta">做到會加崑山幣，沒做到就照「改過方式」把事情補好。</p>
          ${classRules?.cards?.length ? rulesLadder(classRules) : '<p class="meta">班規尚未建立。</p>'}
        </section>
        <section class="card" style="border-top-color:var(--mint)">
          <h3>🎁 連續兩週沒有違規，可以抽獎</h3>
          ${luckyDrawCard(classRules)}
        </section>`,
    },
    {
      id: "routines", icon: "🕗", label: "作息與常規",
      html: () => `
        <section class="card" style="border-top-color:var(--sky)">
          <h3>🕗 一日作息與常規（Routines）</h3>
          <p class="meta">常規是「怎麼做」——每天照著做，班上就會順。</p>
          ${classRules?.daily?.length ? routineCard(classRules) : '<p class="meta">作息與常規尚未建立。</p>'}
        </section>`,
    },
    {
      id: "cadres", icon: "🧑‍💼", label: "班級幹部",
      html: () => !about?.cadres?.length ? "" : `
        <section class="card" style="border-top-color:var(--pink)">
          <h3>🧑‍💼 班級幹部</h3>
          <p class="meta">幹部＝班級的工作職務，分六大組協力運作，每週依職級領崑山幣薪水（詳見小小銀行）。</p>
          ${cadreSection(about.cadres)}
        </section>`,
    },
    {
      id: "duties", icon: "🧹", label: "工作分配",
      html: () => `
        <section class="card" style="border-top-color:var(--mint)">
          <h3>🧹 打掃工作</h3>
          ${dutySection(duties) || '<p class="meta">打掃分配表尚未建立。</p>'}
        </section>
        <section class="card" style="border-top-color:var(--sky)">
          <h3>🍱 午餐工作</h3>
          ${lunchSection(lunch) || '<p class="meta">午餐分配表尚未建立。</p>'}
        </section>
        <section class="card" style="border-top-color:var(--orange)">
          <h3>🪙 一項工作 ＝ 一次</h3>
          ${scoringCard()}
        </section>`,
    },
    {
      id: "seating", icon: "🪑", label: "座位表",
      html: () => `
        <section class="card" style="border-top-color:var(--purple)">
          <h3>🪑 座位表</h3>
          ${seatingSection(seating) || '<p class="meta">座位表尚未建立。</p>'}
        </section>`,
    },
  ];

  const main = document.getElementById("main");
  main.innerHTML = `
    <h2 class="page-title"><span class="dot"></span>🌈 關於我們</h2>
    <div class="tabs about-tabs" role="tablist">
      ${TABS.map(t => `<button role="tab" data-tab="${t.id}">${t.icon} ${App.esc(t.label)}</button>`).join("")}
    </div>
    <div id="tab-body"></div>`;

  const body = document.getElementById("tab-body");
  const buttons = [...main.querySelectorAll(".about-tabs button")];

  // 每個分頁只在第一次點開時渲染，之後留著重用——
  // 午餐分頁有 <select> 與 <details> 的使用者狀態，每次切換都重畫會把它們清掉。
  const rendered = new Map();

  const show = id => {
    const tab = TABS.find(t => t.id === id) || TABS[0];
    buttons.forEach(b => b.classList.toggle("active", b.dataset.tab === tab.id));
    if (!rendered.has(tab.id)) {
      const div = document.createElement("div");
      div.className = "tab-panel";
      div.innerHTML = tab.html();
      body.appendChild(div);
      rendered.set(tab.id, div);
      if (tab.id === "duties") wireLunchPicker(div);
    }
    rendered.forEach((el, key) => { el.hidden = key !== tab.id; });
  };

  function wireLunchPicker(scope) {
    const sel = scope.querySelector("#lunch-week");
    const out = scope.querySelector("#lunch-week-body");
    if (!sel || !out || !lunch?.rotation) return;
    sel.addEventListener("change", () => {
      const w = lunch.rotation.find(x => String(x.week) === sel.value);
      if (w) out.innerHTML = lunchSlots(w);
    });
  }

  buttons.forEach(b => b.addEventListener("click", () => {
    location.hash = b.dataset.tab;   // 交給 hashchange 統一切換，網址永遠對得上畫面
  }));
  addEventListener("hashchange", () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
})();
