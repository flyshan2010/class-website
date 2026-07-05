(async () => {
  await App.init("announcements");
  const all = await App.fetchJSON("data/announcements.json").catch(() => []);

  const imgs = a => (a.images || []).length ? `
    <div class="photo-grid" style="margin-top:10px">
      ${a.images.map(src => `<img src="${App.esc(src)}" alt="公告圖片" loading="lazy" />`).join("")}
    </div>` : "";

  const render = list => list.length ? [...list]
    .sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date))
    .map(a => `
      <section class="card">
        <h3>${a.pinned ? '<span class="badge pin">置頂</span> ' : ""}<span class="badge cat-${App.esc(a.category || "其他")}">${App.esc(a.category || "公告")}</span> ${App.esc(a.title)}</h3>
        <p class="meta">${App.fmtDate(a.date)}</p>
        <div>${App.lines(a.content).map(t => `<p>${App.esc(t)}</p>`).join("")}</div>
        ${imgs(a)}
        ${a.link ? `<p><a href="${App.esc(a.link)}" target="_blank" rel="noopener">🔗 相關連結</a></p>` : ""}
      </section>`).join("") : '<p class="empty-hint">目前沒有公告</p>';

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📣 公告</h2>
    <div class="tabs">
      <button id="tab-class" class="active">班級公告</button>
      <button id="tab-school">學校公告</button>
    </div>
    <div id="ann-list"></div>`;

  const list = document.getElementById("ann-list");
  const tabC = document.getElementById("tab-class");
  const tabS = document.getElementById("tab-school");
  const show = which => {
    tabC.classList.toggle("active", which === "班級");
    tabS.classList.toggle("active", which === "學校");
    list.innerHTML = render(all.filter(a => (a.source || "班級") === which));
  };
  tabC.onclick = () => show("班級");
  tabS.onclick = () => show("學校");
  show("班級");

  // 點公告圖片放大
  list.addEventListener("click", e => {
    if (e.target.tagName !== "IMG") return;
    const box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = `<button class="close" aria-label="關閉">×</button><img src="${e.target.src}" alt="" />`;
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  });
})();
