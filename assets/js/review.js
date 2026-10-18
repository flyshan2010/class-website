// 📚 觀念複習卡（BY 線，老師 2026-10-18 定案範本 ClassOS_v3.5_藍圖/觀念複習卡與錯題公開_範本.html）
// 資料：data/review-cards.json（sync 從 Notion「📚 觀念複習卡」只讀「上架」卡）。無個資、不含平時卷原題。
// 每科一頁：review.html?s=社會#地形特徵 → 直接跳到該張卡（學習報告的複習建議與錯題都連到這裡）。
(async () => {
  await App.init("review");
  const main = document.getElementById("main");
  const data = await App.fetchJSON("data/review-cards.json").catch(() => ({ subjects: [], cards: [] }));
  // 顏色與學習報告平時評量同一組（教學 DS 國語／數學 accent、社會 accent-2）
  const COLOR = { 國語: "#B23A2E", 數學: "#1F5FA8", 社會: "#6B4423" };
  const ICON = { 國語: "📖", 數學: "🔢", 社會: "🗺️" };
  const subjects = data.subjects || [];
  const want = new URLSearchParams(location.search).get("s");
  const subj = subjects.includes(want) ? want : subjects[0];
  const esc = App.esc.bind(App);
  const segs = rt => (rt || []).map(([t, b]) => b ? `<b>${esc(t)}</b>` : esc(t)).join("");
  const SEC = { 重點整理: ["rc-key", "📌 重點整理"], 例題示範: ["rc-ex", "✏️ 例題示範"], 自我檢查: ["rc-chk", "✅ 自我檢查"] };

  // 區塊 → HTML；連續的清單項併成一個 <ul>／<ol>
  function blocks(list) {
    let html = "", open = "";
    const close = () => { if (open) { html += `</${open}>`; open = ""; } };
    for (const b of list || []) {
      const tag = b.ul ? "ul" : b.ol ? "ol" : "";
      if (tag !== open) { close(); if (tag) { html += `<${tag}>`; open = tag; } }
      if (tag) html += `<li>${segs(b.ul || b.ol)}${b.kids?.length ? blocks(b.kids) : ""}</li>`;
      else if (b.toggle) html += `<details class="rc-ans"><summary>${segs(b.toggle) || "答案"}（寫完再看）</summary>${blocks(b.kids)}</details>`;
      else if (b.p) html += `<p>${segs(b.p)}</p>`;
    }
    close();
    return html;
  }
  const card = c => {
    const href = /^https:\/\//.test(c.href || "") ? esc(c.href) : "";
    return `<article class="rc-card" id="${esc(c.name)}" style="--c:${COLOR[c.subject] || "#6b7280"}">
      <div class="rc-hd"><h3>${ICON[c.subject] || "📚"} ${esc(c.name)}</h3>
        <span class="rc-tag">${esc(c.subject)}${c.term ? `・${esc(c.term)}` : ""}</span>
        ${c.lessons?.length ? `<span class="rc-muted">相關課次：${c.lessons.map(esc).join("、")}</span>` : ""}</div>
      ${c.sections.map(s => {
        const [cls, label] = SEC[s.title] || ["rc-plain", esc(s.title)];
        return `<section class="${cls}">${label ? `<div class="rc-st">${label}</div>` : ""}${blocks(s.blocks)}</section>`;
      }).join("")}
      ${href ? `<p class="rc-muted">📖 想再看一次上課內容：<a href="${href}" target="_blank" rel="noopener">${esc(c.lessons?.[0] || "教學頁")}</a></p>` : ""}
    </article>`;
  };

  const mine = (data.cards || []).filter(c => c.subject === subj);
  main.innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📚 觀念複習卡</h2>
    <p class="rc-muted">一個觀念一張卡：先看重點和例題，再自己做「自我檢查」，寫完才打開答案。學習報告裡的 👉 複習卡 會直接帶你到要加強的那一張。</p>
    ${subjects.length > 1 ? `<nav class="rc-tabs">${subjects.map(s => `<a href="review.html?s=${encodeURIComponent(s)}" class="${s === subj ? "active" : ""}" style="--c:${COLOR[s]}">${ICON[s] || ""} ${esc(s)}</a>`).join("")}</nav>` : ""}
    ${mine.length ? `<div class="rc-toc">${mine.map(c => `<a href="#${encodeURIComponent(c.name)}" style="--c:${COLOR[c.subject]}">${esc(c.name)}</a>`).join("")}</div>
      ${mine.map(card).join("")}` : `<p class="empty-hint">${want && !subjects.includes(want) ? `${esc(want)}還沒有上架的觀念複習卡。` : "還沒有上架的觀念複習卡。"}</p>`}`;

  // 從報告點進來（#卡名）→ 捲到那張卡並短暫標亮
  const jump = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id && document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "instant" }); // 全站 scroll-behavior:smooth，跳卡片不要慢慢滑
    el.classList.add("rc-hit"); setTimeout(() => el.classList.remove("rc-hit"), 2400);
  };
  requestAnimationFrame(jump);
  window.addEventListener("hashchange", jump);
})();
