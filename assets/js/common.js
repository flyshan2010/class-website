/* 共用：載入設定、渲染頁首/導覽/頁尾、小工具 */
const App = {
  config: null,

  async fetchJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`載入失敗：${path}`);
    return res.json();
  },

  async init(activeId) {
    this.config = await this.fetchJSON("data/site-config.json");
    const c = this.config;
    document.title = `${c.siteTitle}｜${document.body.dataset.pageTitle || ""}`.replace(/｜$/, "");

    document.getElementById("site-header").innerHTML = `
      <div class="school">${c.schoolYear} ${c.schoolName}</div>
      <h1>${c.className} 班級網站</h1>
      <div class="motto">${c.motto}</div>`;

    document.getElementById("site-nav").innerHTML = c.nav
      .map(n => `<a href="${n.href}" class="${n.id === activeId ? "active" : ""}">${n.icon} ${n.label}</a>`)
      .join("");

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

  // 班級口號「SPAR 閃耀亮點」海報：放大字首 S-P-A-R ＋ 小星星／火花。
  // 資料在 data/site-config.json 的 spar 欄（repo 管理，Notion 同步不會覆蓋）。
  // compact＝首頁用的橫幅版（只有字母＋中文）；完整版用於「關於我們」。
  sparPoster(spar, compact = false) {
    if (!spar?.items?.length) return "";
    return `
      <div class="spar-poster ${compact ? "compact" : ""}">
        <div class="spar-head">
          <span class="spar-spark">✨</span>
          <span class="spar-title">${this.esc(spar.title || "SPAR")}</span>
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

  // 每日小叮嚀：用班級口號 SPAR 四則輪播，依日期決定（同一天全班看到同一則）。
  dailyTip(spar, iso) {
    const items = spar?.items ?? [];
    if (!items.length) return null;
    const n = Number(String(iso || this.todayISO()).replace(/-/g, "")) || 0;
    return items[n % items.length];
  },

  // 黑板風「當天聯絡簿」：四格（本日功課／提醒事項／攜帶物品／每日小叮嚀），
  // 版面比照教室黑板，方便學生照抄、家長一眼看完。首頁與聯絡簿頁共用。
  // day＝contactbook.json 的一列（可為 undefined＝沒資料，仍會畫出空黑板，版面不塌）。
  chalkBoard(day, spar, opts = {}) {
    const { title = "當天聯絡簿", footer = "" } = opts;
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
    const tip = this.dailyTip(spar, day?.date);
    return `
      <div class="chalkboard">
        <div class="cb-head">
          <h2 class="cb-title">📒 ${this.esc(title)}</h2>
          <span class="cb-date">${day ? this.fmtDate(day.date) : "尚未開始"}</span>
        </div>
        ${day ? `
        <div class="cb-grid">
          ${panel("hw", "✏️", "本日功課", day.homework, "今天沒有功課，好好休息！")}
          ${panel("note", "📌", "提醒事項", day.notes, "今天沒有特別的提醒")}
          ${panel("bring", "🎒", "攜帶物品", day.bring, "不用帶特別的東西")}
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
