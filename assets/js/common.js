/* 共用：載入設定、渲染頁首/導覽/頁尾、小工具 */
const App = {
  config: null,

  // 導覽列收成 5 主項＋更多：其餘的塞進「更多」下拉，手機／桌機都不必橫向長滑一排。
  MAIN_NAV_IDS: ["home", "contactbook", "announcements", "report"],

  // 頂部導覽列與首頁選單用的分頁清單。濾掉三種：
  //   hidden: true          → 老師手動關的草稿頁（輸網址仍看得到），要開放得自己改回 false
  //   autoHidden: true      → 該頁目前沒有任何內容，由每次同步自動判定（見 sync-notion.mjs）。
  //                           資料一進來就自動變 false、分頁自己回到導覽列，老師不必記得改。
  //   navPlacement: "about" → 入口刻意放在「🌈 關於我們」的分頁列裡，不占頂部導覽的位置
  visibleNav(c = this.config) {
    return (c?.nav ?? []).filter(n => !n.hidden && !n.autoHidden && n.navPlacement !== "about");
  },

  // 取某一個分頁的設定（含 hidden／navPlacement），給各頁自行決定要不要放入口
  navItem(id, c = this.config) {
    return (c?.nav ?? []).find(n => n.id === id) || null;
  },

  async fetchJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`載入失敗：${path}`);
    return res.json();
  },

  async init(activeId) {
    this.config = await this.fetchJSON("data/site-config.json");
    const c = this.config;
    document.title = `${c.siteTitle}｜${document.body.dataset.pageTitle || ""}`.replace(/｜$/, "");
    // 讓 CSS 能針對單一頁面調整（例：首頁有 S.T.A.R. 海報，頁首的 motto 就不重複出現）
    if (activeId) document.body.classList.add(`page-${activeId}`);

    document.getElementById("site-header").innerHTML = `
      <div class="school">${c.schoolYear} ${c.schoolName}</div>
      <h1>${c.className} 班級網站</h1>
      <div class="motto">${c.motto}</div>`;

    // site-config.json 的 nav 項可加 "hidden": true ——頁面照樣部署得到、輸網址看得到，
    // 但不出現在導覽列與首頁選單。老師想公開時把該項改成 false 即可，不必動程式。
    const navItems = this.visibleNav(c);
    const mainItems = navItems.filter(n => this.MAIN_NAV_IDS.includes(n.id));
    const moreItems = navItems.filter(n => !this.MAIN_NAV_IDS.includes(n.id));
    const moreActive = moreItems.some(n => n.id === activeId);
    // 全部分頁都渲染出來，且**照 site-config 的原順序**——桌機就是原本平鋪一排的樣子。
    // 手機（≤719px）由 CSS 隱藏 .nav-secondary、改用「⋯ 更多」下拉；主項的相對順序不變，
    // 所以不必再用 flex order 搬位置。
    document.getElementById("site-nav").innerHTML = `
      ${navItems.map(n => {
        const cls = [this.MAIN_NAV_IDS.includes(n.id) ? "" : "nav-secondary", n.id === activeId ? "active" : ""]
          .filter(Boolean).join(" ");
        return `<a href="${n.href}" class="${cls}">${n.icon} ${n.label}</a>`;
      }).join("")}
      <div class="nav-more${moreActive ? " active" : ""}">
        <button type="button" class="nav-more-btn${moreActive ? " active" : ""}" aria-haspopup="true" aria-expanded="false">⋯ 更多</button>
        <div class="nav-more-panel">
          ${moreItems.map(n => `<a href="${n.href}" class="${n.id === activeId ? "active" : ""}">${n.icon} ${n.label}</a>`).join("")}
        </div>
      </div>`;
    // 告訴 CSS「12 個分頁都已經平鋪出來了」，桌機才可以放心收掉「⋯ 更多」。
    // 這個 class 是防呆：瀏覽器若快取到舊版 common.js（沒渲染次要分頁），
    // body 上就不會有 nav-flat，「更多」照常出現，導覽列不會只剩 4 個按鈕。
    document.body.classList.add("nav-flat");

    const moreWrap = document.querySelector(".nav-more");
    const moreBtn = document.querySelector(".nav-more-btn");
    const morePanel = document.querySelector(".nav-more-panel");
    // 面板用 fixed 定位，開啟時依按鈕實際座標夾在視窗內——導覽列還沒滑到底、按鈕貼在螢幕邊緣時，面板也不會被切掉。
    const placeMorePanel = () => {
      if (!morePanel) return;
      const btnRect = moreBtn.getBoundingClientRect();
      const panelW = morePanel.offsetWidth || 170;
      const left = Math.min(Math.max(8, btnRect.right - panelW), window.innerWidth - panelW - 8);
      morePanel.style.top = `${btnRect.bottom + 8}px`;
      morePanel.style.left = `${left}px`;
    };
    moreBtn?.addEventListener("click", e => {
      e.stopPropagation();
      const opening = !moreWrap.classList.contains("open");
      moreWrap.classList.toggle("open", opening);
      moreBtn.setAttribute("aria-expanded", opening);
      if (opening) placeMorePanel();
    });
    document.addEventListener("click", () => moreWrap?.classList.remove("open"));
    window.addEventListener("resize", () => { if (moreWrap?.classList.contains("open")) placeMorePanel(); });

    document.getElementById("site-footer").innerHTML =
      `${c.schoolYear} ${c.schoolName} ${c.className} ❤ 本站由老師與 AI 共同維護
       <span id="footer-synced" style="opacity:.5"></span>
       <a href="teacher.html" title="教師專區" style="text-decoration:none;opacity:.45;margin-left:6px">🧑‍🏫</a>`;
    this.renderSyncedAt();

    // 各模組代表色
    const accent = c.moduleColors[activeId];
    if (accent) document.documentElement.style.setProperty("--accent", accent);
    return c;
  },

  // 班級口號「🌟 S.T.A.R. 閃耀之星」海報：放大字首 S-T-A-R ＋ 小星星／火花。
  // 資料在 data/site-config.json 的 spar 欄（repo 管理，Notion 同步不會覆蓋）。
  // 2026-08-14 由 SPAR（Safety／Proactivity／Accountability／Respect）改版為
  // S.T.A.R.（Secure 注意安全／Thank 尊重感恩／Action 主動積極／Responsible 認真負責）。
  // 內部 class 名 .spar-* 沿用不改——純內部命名，改了要動五個檔卻沒有可見效益。
  // compact＝首頁用的橫幅版（只有字母＋中文）；完整版用於「關於我們」。
  sparPoster(spar, compact = false) {
    if (!spar?.items?.length) return "";
    return `
      <div class="spar-poster ${compact ? "compact" : ""}">
        <div class="spar-head">
          <span class="spar-spark">✨</span>
          <span class="spar-title">${this.esc(spar.title || "S.T.A.R.")}</span>
          <span class="spar-spark">✨</span>
          ${spar.subtitle && !compact ? `<div class="spar-sub">${this.esc(spar.subtitle)}</div>` : ""}
        </div>
        <div class="spar-items">
          ${spar.items.map(it => `
            <div class="spar-item" style="--sc:${this.esc(it.color || "#54A0FF")}">
              <span class="spar-letter" aria-hidden="true">${this.esc(it.letter)}</span>
              <div class="spar-text">
                <div class="spar-zh">${this.esc(it.zh)}</div>
                <div class="spar-en">${this.esc(it.en)}</div>
                ${it.desc && !compact ? `<div class="spar-desc">${this.esc(it.desc)}</div>` : ""}
              </div>
            </div>`).join("")}
        </div>
      </div>`;
  },

  // 每日小叮嚀：用班級口號 S.T.A.R. 四則輪播，依日期決定（同一天全班看到同一則）。
  dailyTip(spar, iso) {
    const items = spar?.items ?? [];
    if (!items.length) return null;
    const n = Number(String(iso || this.todayISO()).replace(/-/g, "")) || 0;
    return items[n % items.length];
  },

  // 「當天聯絡簿」四格卡（本日功課／提醒事項／攜帶物品／每日小叮嚀），
  // 沿用教室黑板的分區，方便學生照抄、家長一眼看完。首頁與聯絡簿頁共用。
  // day＝contactbook.json 的一列；opts.date 可單獨指定要標示的日期——
  // 首頁固定標「今天」，就算今天沒有資料也照樣畫四格（顯示「今日沒有功課喔」），
  // 免得家長／學生把下一個上課日的功課誤看成今天要交的。
  chalkBoard(day, spar, opts = {}) {
    const { title = "當天聯絡簿", footer = "", date = day?.date,
            hwEmpty = "今日沒有功課喔 🎉" } = opts;
    const panel = (cls, icon, name, text, empty, tick = true) => {
      const items = this.lines(text);
      return `
        <section class="cb-panel ${cls}">
          <h3>${icon} ${name}</h3>
          ${items.length
            ? `<ul class="cb-list ${tick ? "tick" : ""}">${items.map(t => `<li>${this.esc(t)}</li>`).join("")}</ul>`
            : `<p class="cb-empty">${empty}</p>`}
        </section>`;
    };
    const tip = this.dailyTip(spar, date);
    return `
      <div class="chalkboard">
        <div class="cb-head">
          <h2 class="cb-title">📒 ${this.esc(title)}</h2>
          <span class="cb-date">${date ? this.fmtDate(date) : "尚未開始"}</span>
        </div>
        ${date ? `
        <div class="cb-grid">
          ${panel("hw", "✏️", "本日功課", day?.homework, hwEmpty)}
          ${panel("note", "📌", "提醒事項", day?.notes, "今天沒有特別的提醒")}
          ${panel("bring", "🎒", "攜帶物品", day?.bring, "不用帶特別的東西")}
          <section class="cb-panel tip">
            <h3>🌟 每日小叮嚀</h3>
            ${tip
              ? `<p class="cb-tip-zh"><span class="cb-tip-letter">${this.esc(tip.letter)}</span>${this.esc(tip.zh)}</p>
                 <p class="cb-tip-desc">${this.esc(tip.desc || tip.en || "")}</p>`
              : '<p class="cb-empty">今天也要當個閃耀的自己 ✨</p>'}
          </section>
        </div>`
          : '<p class="cb-none">本學期的聯絡簿還沒開始，開學後就會出現囉！</p>'}
        ${footer ? `<p class="cb-more">${footer}</p>` : ""}
      </div>`;
  },

  // 頁尾「最後同步」：正常顯示日期時間；超過 36 小時（每日 3 次同步的容錯）顯示紅字提醒
  async renderSyncedAt() {
    const el = document.getElementById("footer-synced");
    if (!el) return;
    try {
      const { at } = await this.fetchJSON("data/synced-at.json");
      const d = new Date(at);
      const hrs = (Date.now() - d.getTime()) / 3.6e6;
      const stamp = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      el.textContent = ` ｜ 最後同步 ${stamp}`;
      if (hrs > 36) {
        el.textContent = ` ｜ ⚠️ 資料已 ${Math.floor(hrs / 24)} 天未更新（最後同步 ${stamp}）`;
        el.style.color = "#c0392b";
        el.style.opacity = "1";
      }
    } catch { /* 同步時間檔缺失不影響頁尾 */ }
  },

  fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
    const w = "日一二三四五六"[d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}（${w}）`;
  },

  // 短日期：只有月/日，不含星期
  fmtDateShort(iso) {
    if (!iso) return "";
    const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },

  // 行事曆事件的日期字串：跨日→「8/7（五）～8/9（日）」；
  // 單日有時間→「8/7（五） 07:40–11:10」（全天事件不加時間）。
  // 時間來自 Google 日曆，已在 sync-gcal.mjs 換算成台北時間。
  fmtEventDate(e) {
    if (!e?.date) return "";
    if (e.endDate && e.endDate !== e.date) return `${this.fmtDate(e.date)} ～ ${this.fmtDate(e.endDate)}`;
    const t = e.startTime ? ` ${e.startTime}${e.endTime ? `–${e.endTime}` : ""}` : "";
    return `${this.fmtDate(e.date)}${t}`;
  },

  todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  },

  // 將多行文字轉為 <li> 列表（後台一行一項）
  lines(s) {
    return String(s ?? "").split(/\n+/).map(t => t.trim()).filter(Boolean);
  },

  ul(s) {
    const items = this.lines(s);
    return items.length ? `<ul>${items.map(t => `<li>${this.esc(t)}</li>`).join("")}</ul>` : "";
  }
};
