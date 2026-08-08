(async () => {
  const c = await App.init("about");
  const [about, duties, lunch, seating] = await Promise.all([
    App.fetchJSON("data/about.json").catch(() => null),
    App.fetchJSON("data/duties.json").catch(() => null),
    App.fetchJSON("data/lunch.json").catch(() => null),
    App.fetchJSON("data/seating.json").catch(() => null),
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

  // ── 公約 × 班規 × 獎懲對照 ──
  // 制度鏈：四大理念 → 公約（往哪走）→ 班規（什麼可以不可以）→ 獎懲（做到／做不到怎麼辦）。
  // 正本＝Notion「📜 班級獎懲規定（崑山幣加扣標準）」＋ docs/班級經營與生活常規.md；
  // 行為文字與金額全部照抄該頁正向表／偏差表，**要改就三處一起改**（本檔、📜 頁、制度正本 md）。
  const CLASS_RULES = [
    {
      n: "1", title: "說話有禮貌，也有分寸", idea: "尊重他人",
      rules: ["② 待人有禮貌"],
      good: [
        { act: "主動問好、應對有禮、好好說話化解不愉快", coin: "+5" },
        { act: "用語氣化解同學衝突、幫兩邊和好", coin: "+10" },
      ],
      bad: [
        { act: "說話不禮貌、取外號、頂嘴", fix: "當面道歉，再用有禮貌的說法重說一次", coin: "−5" },
      ],
    },
    {
      n: "2", title: "想法不一樣，也能好好相處", idea: "尊重他人",
      rules: ["⑤ 上課守秩序"],
      good: [
        { act: "討論時先聽完再回應、接納不同意見修正自己", coin: "+5" },
        { act: "分組合作完成任務、接納不同的同學一起玩", coin: "+5" },
        { act: "吵架後主動道歉和好、把關係修回來", coin: "+10" },
      ],
      bad: [
        { act: "打斷、嘲笑同學發言", fix: "先道歉，練習聽完再回應", coin: "−5" },
        { act: "衝突動口（罵人、挑釁）", fix: "道歉，並和老師約定下次要改說的話", coin: "−5" },
        { act: "衝突動手（推人、打人）", fix: "先道歉，負責讓對方重新感到安全（例如：一起完成一週合作任務）", coin: "−10" },
      ],
    },
    {
      n: "3", title: "看見需要，主動幫忙", idea: "主動關懷",
      rules: ["⑧ 口說好話"],
      good: [
        { act: "幫同學老師搬東西、教同學功課、主動服務", coin: "+5" },
        { act: "主動照顧受傷或難過的同學、看到沒人做的事主動補上", coin: "+10" },
      ],
      bad: [
        { act: "同學求助時刻意不理，還故意擋著不讓別人幫", fix: "補做一次同樣的服務", coin: "−5" },
      ],
    },
    {
      n: "4", title: "照顧自己，也照顧別人的安全", idea: "注意安全",
      rules: ["⑥ 走廊（教室）不奔跑"],
      good: [
        { act: "提醒同學小心、自己先停下來不做危險動作、排隊不推擠", coin: "+5" },
        { act: "制止危險行為、發現危險主動報告老師、幫受傷同學求助", coin: "+10" },
      ],
      bad: [
        { act: "奔跑追逐、危險動作、拿掃具玩鬧", fix: "靜坐反省 5 分鐘，並向被撞到、嚇到的人道歉", coin: "−5" },
      ],
    },
    {
      n: "5", title: "答應的事，努力完成", idea: "認真負責",
      rules: ["① 上學（課）不遲到", "③ 打掃要認真", "④ 作業要用心", "⑦ 管好自己（自律）"],
      good: [
        { act: "作業準時又確實、答應的任務如期完成", coin: "+5" },
        { act: "克服困難完成任務、主動重做到好", coin: "+10" },
      ],
      bad: [
        { act: "作業缺交、複習卷沒交", fix: "下課補寫完成（欠的時間自己補回來）", coin: "−5" },
        { act: "答應的工作或幹部職務擺爛", fix: "用下課時間，補做好", coin: "−5" },
      ],
    },
  ];

  // 不屬於單一條公約、上課時間共通的兩條（📜 頁偏差表「共同」列前兩條）
  const CLASS_RULES_CLASSTIME = [
    { act: "干擾上課（講話、吵到旁邊同學）", fix: "安靜上課，並把落掉的進度補齊", coin: "−5" },
    { act: "一直提醒還是繼續干擾", fix: "到教室後座位聽課，下課靜坐反省 5 分鐘，並把落掉的進度補齊", coin: "−10" },
  ];

  const 抽獎池 = ["作業減少", "豁免金牌", "合作社物品（不超過 20 元）", "三天不午睡",
    "蓋好兒童卡三格", "二十元禮券", "獎勵金牌", "再抽一次"];

  // 以「班規」為主標題、公約退為小標籤——學生要先看到的是自己該守的那一條規則。
  const ruleCard = (r, i) => `
    <div class="rule-card rules-c${i % 5}">
      <div class="rule-card-head">
        <div class="rule-names">
          ${r.rules.map(x => `<span class="rule-name-big">${App.esc(x)}</span>`).join("")}
        </div>
      </div>
      <div class="rule-covenant">🤝 公約 ${App.esc(r.n)}｜${App.esc(r.title)}</div>
      <div class="rule-cols">
        <div class="rule-col good">
          <div class="rule-col-head">✅ 做到的樣子</div>
          ${r.good.map(g => `
          <div class="rule-row">
            <span class="rr-act">${App.esc(g.act)}</span>
            <span class="rr-coin">🪙 ${App.esc(g.coin)}</span>
          </div>`).join("")}
        </div>
        <div class="rule-col bad">
          <div class="rule-col-head">⚠️ 沒做到怎麼辦</div>
          ${r.bad.map(b => `
          <div class="rule-row">
            <span class="rr-act">${App.esc(b.act)}
              <em class="rr-fix">改過方式：${App.esc(b.fix)}</em></span>
            <span class="rr-coin">🪙 ${App.esc(b.coin)}</span>
          </div>`).join("")}
        </div>
      </div>
    </div>`;

  const rulesLadder = () => `
    <div class="rule-cards">${CLASS_RULES.map(ruleCard).join("")}</div>

    <div class="rule-card rule-card-common">
      <div class="rule-card-head">
        <div class="rule-names"><span class="rule-name-big">上課時間</span></div>
      </div>
      <div class="rule-covenant">🤝 五條公約都適用</div>
      <div class="rule-col bad">
        ${CLASS_RULES_CLASSTIME.map(b => `
        <div class="rule-row">
          <span class="rr-act">${App.esc(b.act)}
            <em class="rr-fix">改過方式：${App.esc(b.fix)}</em></span>
          <span class="rr-coin">🪙 ${App.esc(b.coin)}</span>
        </div>`).join("")}
      </div>
    </div>

    <div class="rule-card rule-card-serious">
      <div class="rule-card-head">
        <div class="rule-names"><span class="rule-name-big">🚨 重大安全事件</span></div>
      </div>
      <div class="rule-col bad">
        <div class="rule-row">
          <span class="rr-act">重大安全事件、霸凌、性平
            <em class="rr-fix">處理方式：依校內相關防治準則流程處理</em></span>
          <span class="rr-coin">🪙 −15</span>
        </div>
      </div>
    </div>

    <ul class="rule-notes">
      <li><b>扣到 0 就停</b>，不會變成負的。</li>
      <li><b>當天同一不當行為第一次改過，不扣點</b>；若再有，則需改過且扣點。</li>
      <li>另外還有亮點、進步獎、比賽獲獎、布可星球等獎勵，詳見「🏦 小小銀行」。</li>
    </ul>`;

  // ── 一日作息與常規（執行層 routine）──
  // 正本＝docs/班級經營與生活常規.md §二（時間軸）與 §二之二（課堂五流程），此處為學生版精簡文字。
  const DAILY_ROUTINE = [
    { time: "07:20–07:40", name: "早晨入班", sop: "掛包包 ➜ 放水壺 ➜ 依科目交作業到指定籃；回座整理桌面或抄聯絡簿" },
    { time: "07:40–08:00", name: "環境晨掃", sop: "聽到打掃音樂就拿掃具 ➜ 做完自己的分工 ➜ 07:55 前收尾，掃具哪裡拿哪裡放" },
    { time: "08:00–08:35", name: "朝會／晨讀", sop: "晨讀安靜看課外書，桌上只留書；朝會聽到集合訊號 1 分鐘內整隊" },
    { time: "08:35–12:00", name: "上午課堂", sop: "預備鐘響回教室 ➜ 擺課本、坐好、拿文具；發言先舉手" },
    { time: "12:00–12:30", name: "午餐", sop: "洗手排隊 ➜ 打飯戴口罩不說話 ➜ 專心用餐；收好餐盒、擦桌子、清腳下" },
    { time: "12:30–13:30", name: "潔牙午休", sop: "12:40 前刷完牙、上完廁所 ➜ 12:40 關燈，全班安靜午休" },
    { time: "13:30–15:30", name: "下午課堂", sop: "午休鐘響起身，預備鐘準時進教室；討論小聲，教具圖書 100% 歸位" },
    { time: "15:30–16:00", name: "整理放學", sop: "清桌面和腳下 ➜ 抄好檢查聯絡簿 ➜ 椅子靠攏 ➜ 靜坐等待、依序整隊" },
  ];

  const LESSON_FLOWS = [
    { n: "①", name: "進教室", sop: "安靜進教室 ➜ 放好書包物品 ➜ 準備下一節要用的東西" },
    { n: "②", name: "發材料", sop: "依序領取 ➜ 檢查齊不齊全 ➜ 缺了立刻舉手；拿到自己的，看看旁邊同學缺不缺" },
    { n: "③", name: "發言", sop: "先舉手 ➜ 等老師點名 ➜ 站好、清楚說" },
    { n: "④", name: "小組討論", sop: "專心討論 ➜ 輪流發言 ➜ 一起完成任務；想法不同就說「我想法不一樣，因為……」" },
    { n: "⑤", name: "收拾", sop: "整理桌面 ➜ 物品歸位 ➜ 檢查乾淨才離開；收好自己的，再看看小組還有沒有沒收的" },
  ];

  const routineCard = () => `
    <div class="routine-list">
      ${DAILY_ROUTINE.map(r => `
      <div class="routine-row">
        <span class="rt-time">${App.esc(r.time)}</span>
        <span class="rt-name">${App.esc(r.name)}</span>
        <span class="rt-sop">${App.esc(r.sop)}</span>
      </div>`).join("")}
    </div>
    <div class="routine-sub">🔁 上課常規</div>
    <div class="routine-list">
      ${LESSON_FLOWS.map(f => `
      <div class="routine-row flow">
        <span class="rt-time">${App.esc(f.n)}</span>
        <span class="rt-name">${App.esc(f.name)}</span>
        <span class="rt-sop">${App.esc(f.sop)}</span>
      </div>`).join("")}
    </div>
    <p class="duty-score-note">
      班級常規沒做到（例如：進教室、排隊、收拾這些「怎麼做」的流程），沒做好就重做一次練到會，<b>不扣點</b>。
    </p>`;

  const luckyDrawCard = () => `
    <p class="meta">連續兩週都沒有違規紀錄，就可以抽一次獎（8 選 1）。</p>
    <div class="draw-pool">
      ${抽獎池.map((x, i) => `<span class="draw-chip">${i + 1}. ${App.esc(x)}</span>`).join("")}
    </div>
    <p class="duty-score-note">抽獎是「連續兩週都做得好」的里程碑獎勵，和崑山幣（每次的即時回饋）並行，不衝突。</p>`;

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
          ${rulesLadder()}
        </section>
        <section class="card" style="border-top-color:var(--mint)">
          <h3>🎁 連續兩週沒有違規，可以抽獎</h3>
          ${luckyDrawCard()}
        </section>`,
    },
    {
      id: "routines", icon: "🕗", label: "作息與常規",
      html: () => `
        <section class="card" style="border-top-color:var(--sky)">
          <h3>🕗 一日作息與常規（Routines）</h3>
          <p class="meta">常規是「怎麼做」——每天照著做，班上就會順。</p>
          ${routineCard()}
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
