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
      `${c.schoolYear} ${c.schoolName} ${c.className} ❤ 本站由老師與 AI 共同維護`;

    // 各模組代表色
    const accent = c.moduleColors[activeId];
    if (accent) document.documentElement.style.setProperty("--accent", accent);
    return c;
  },

  fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
    const w = "日一二三四五六"[d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}（${w}）`;
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
