(async () => {
  await App.init("announcements");
  const raw = await App.fetchJSON("data/announcements.json").catch(() => []);
  const today = App.todayISO();
  // 預排公告（2026-08-30）：日期.start ＝ 上架日，還沒到就當作不存在。
  // 同步端已經先過濾一次（未來公告根本不會寫進 JSON），這裡只是雙保險——
  // 舊快取／手改過的 JSON 也不會讓家長提早看到。
  const all = raw.filter(a => !a.date || a.date <= today);

  // 起迄日（2026-08-14）：expiry＝實際下架日（含當天），由同步端算好
  //   ─ Notion「日期」欄填成區間 → end 就是下架日
  //   ─ 沒填 → 發布日 +30 天
  // 過期的不是消失，是收進「歷史公告」分頁，家長回頭找得到。
  const DEFAULT_DAYS = 30;
  const addDays = (iso, n) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const expiryOf = a => a.expiry || a.endDate || addDays(a.date, DEFAULT_DAYS);
  const isExpired = a => expiryOf(a) < today;
  const dayDiff = iso => Math.round((new Date(iso + "T00:00:00") - new Date(today + "T00:00:00")) / 864e5);

  // 舊資料（同步還沒跑過）沒有 id，就地補一個穩定值，錨點才不會失效
  const idOf = a => a.id || `x${a.date.replace(/-/g, "")}${
    [...`${a.title}`].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 0).toString(36)}`;

  // 相對日期只在「近幾天」有意義；再久就留空，不要重複印一次同樣的日期
  const ago = iso => {
    const n = dayDiff(iso);
    if (n === 0) return "今天";
    if (n === -1) return "昨天";
    if (n > 0) return `${n} 天後`;
    if (n >= -6) return `${-n} 天前`;
    if (n >= -30) return `${Math.round(-n / 7)} 週前`;
    return "";
  };

  const imgs = a => (a.images || []).length ? `
    <div class="photo-grid" style="margin-top:10px">
      ${a.images.map(src => `<img src="${App.esc(src)}" alt="公告圖片" loading="lazy" />`).join("")}
    </div>` : "";

  // 內文長就摺疊：先露前 3 行，其餘點「看全文」再展開——一頁能一眼掃完幾則標題，
  // 而不是被一則長公告佔滿整個畫面。
  //
  // 2026-08-14 改用自製按鈕，不用 <details>：details 的 summary 必須是第一個子元素，
  // 展開後那行「看全文」會卡在第 3 行與其餘內文中間，手機上讀起來被硬生生打斷。
  // 按鈕放在最後，展開後它自然落到全文末尾，變成「收合」，閱讀不會被切開。
  const FOLD_LINES = 3;
  const body = a => {
    const ls = App.lines(a.content);
    if (!ls.length) return "";
    const p = t => `<p>${App.esc(t)}</p>`;
    if (ls.length <= FOLD_LINES) return `<div class="ann-body">${ls.map(p).join("")}</div>`;
    return `
      <div class="ann-body">
        ${ls.slice(0, FOLD_LINES).map(p).join("")}
        <div class="ann-rest" hidden>${ls.slice(FOLD_LINES).map(p).join("")}</div>
        <button type="button" class="ann-toggle" aria-expanded="false"
                data-more="看全文（還有 ${ls.length - FOLD_LINES} 行）" data-less="收合 ▲">
          看全文（還有 ${ls.length - FOLD_LINES} 行）
        </button>
      </div>`;
  };

  const card = a => {
    const exp = expiryOf(a);
    const left = dayDiff(exp);
    const expired = left < 0;
    // 只在快下架（3 天內）時提醒，平常不占版面
    const expTag = expired
      ? `<span class="ann-exp done">已於 ${App.fmtDateShort(exp)} 下架</span>`
      : left <= 3 ? `<span class="ann-exp soon">${left === 0 ? "今天最後一天" : `再 ${left} 天下架`}</span>` : "";
    return `
      <section class="card ann-card cat-${App.esc(a.category || "其他")}${a.pinned ? " pinned" : ""}${expired ? " expired" : ""}"
               id="ann-${App.esc(idOf(a))}">
        <div class="ann-head">
          <div class="ann-tags">
            ${a.pinned ? '<span class="badge pin">置頂</span>' : ""}
            <span class="badge src-${App.esc(a.source || "班級")}">${App.esc(a.source || "班級")}公告</span>
            <span class="badge cat-${App.esc(a.category || "其他")}">${App.esc(a.category || "公告")}</span>
          </div>
          <div class="ann-when"><time datetime="${App.esc(a.date)}">${App.fmtDate(a.date)}</time>${
            ago(a.date) ? `<span class="ago">${ago(a.date)}</span>` : ""}</div>
        </div>
        <h3 class="ann-title">${App.esc(a.title)}</h3>
        ${expTag}
        ${body(a)}
        ${imgs(a)}
        ${a.link ? `<p class="ann-actions"><a class="ann-link" href="${App.esc(a.link)}" target="_blank" rel="noopener">🔗 開啟相關連結</a></p>` : ""}
      </section>`;
  };

  const render = list => {
    if (!list.length) return '<p class="empty-hint">目前沒有公告</p>';
    const sorted = [...list].sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date));
    const top = sorted.filter(a => a.pinned);
    const rest = sorted.filter(a => !a.pinned);
    return (top.length ? `<div class="ann-pinned-zone">${top.map(card).join("")}</div>` : "")
      + rest.map(card).join("");
  };

  const live = all.filter(a => !isExpired(a));
  const past = all.filter(isExpired);
  const groups = {
    "班級": live.filter(a => (a.source || "班級") === "班級"),
    "學校": live.filter(a => (a.source || "班級") === "學校"),
    "歷史": past,
  };

  document.getElementById("main").innerHTML = `
    <h2 class="page-title"><span class="dot"></span>📣 公告</h2>
    <div class="tabs">
      <button data-tab="班級" class="active">班級公告${groups["班級"].length ? `（${groups["班級"].length}）` : ""}</button>
      <button data-tab="學校">學校公告${groups["學校"].length ? `（${groups["學校"].length}）` : ""}</button>
      <button data-tab="歷史">歷史公告${groups["歷史"].length ? `（${groups["歷史"].length}）` : ""}</button>
    </div>
    <div id="ann-list"></div>`;

  const list = document.getElementById("ann-list");
  const tabs = [...document.querySelectorAll(".tabs button")];
  const show = which => {
    tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === which));
    list.innerHTML = render(groups[which] || []);
  };
  tabs.forEach(b => b.onclick = () => show(b.dataset.tab));

  // 看全文／收合：按鈕在內文最後，展開後它落到全文末尾，不會卡在中間打斷閱讀
  list.addEventListener("click", e => {
    const btn = e.target.closest(".ann-toggle");
    if (!btn) return;
    const rest = btn.parentElement.querySelector(".ann-rest");
    const open = btn.getAttribute("aria-expanded") === "true";
    if (rest) rest.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    btn.textContent = open ? btn.dataset.more : btn.dataset.less;
  });

  // 首頁點公告標題會帶 #ann-<id> 過來：自動切到那則所在的分頁、展開全文、捲過去並高亮
  const focusFromHash = () => {
    const id = decodeURIComponent(location.hash.replace(/^#ann-/, ""));
    if (!location.hash.startsWith("#ann-")) { show("班級"); return; }
    const hit = all.find(a => idOf(a) === id);
    show(!hit ? "班級" : isExpired(hit) ? "歷史" : (hit.source || "班級"));
    const el = document.getElementById(`ann-${id}`);
    if (!el) return;
    el.querySelectorAll("button.ann-toggle[aria-expanded='false']").forEach(b => b.click());
    el.classList.add("ann-focus");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => el.classList.remove("ann-focus"), 2600);
  };
  focusFromHash();
  window.addEventListener("hashchange", focusFromHash);

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
