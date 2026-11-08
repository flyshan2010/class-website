/* 📰 校刊挑選頁（DL 線，SPEC_校刊挑選.md）
 * 資料：代理 yearbook_list（本學年作文批改列＋名冊姓名，教師口令）→ 本頁挑選、排序、修訂 → 下載 Word → yearbook_mark（Notion 記錄繳交）。
 * 規則與 Word：window.Yearbook（assets/js/yearbook-core.js，與 node 測試同一支）。
 * 草稿（選了哪幾篇、修訂、主題）只存這台電腦 localStorage「yearbook-draft-<學年><學期>」；繳交後 Notion 有定稿，換電腦開啟會從 Notion 帶回。 */
(function () {
  "use strict";
  const Y = window.Yearbook;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const TCH_KEY = "yearbook-teacher-v1";
  let proxyUrl = null, cls = null, year = "", essays = [], sem = "上", D = null, busy = false;

  // ── 代理 ──
  function pw() { try { return sessionStorage.getItem("teacherPw") || ""; } catch (e) { return ""; } }
  async function call(body) {
    const res = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ pw: pw() }, body)) });
    const data = await res.json();
    if (!data.ok && data.error === "口令錯誤") {
      try { sessionStorage.removeItem("teacherPw"); } catch (e) {}
      gate("口令已失效，請回教師專區重新登入。");
      throw new Error("口令錯誤");
    }
    return data;
  }
  function gate(msg) { $("app").hidden = true; $("gate").hidden = false; if (msg) $("gateMsg").textContent = msg; }
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); setTimeout(() => t.classList.remove("on"), 2200); }
  function status(m, bad) { const el = $("status"); el.textContent = m || ""; el.classList.toggle("bad", !!bad); }

  // ── 草稿 ──
  const dKey = () => "yearbook-draft-" + year + sem;
  function loadDraft() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(dKey()) || "null"); } catch (e) {}
    if (!d) {
      // 本機沒有草稿 → 若 Notion 已有本學期繳交紀錄，從定稿帶回（換電腦也接得上）
      const label = year + sem, marked = essays.filter(e => e.mark === label);
      d = { pick: [], edits: {}, pgbrk: true, fromNotion: marked.length > 0 };
      marked.map(e => ({ e: e, f: Y.splitFinal(e.final) })).sort((a, b) => (a.f.order || 99) - (b.f.order || 99))
        .forEach(({ e, f }) => { d.pick.push(e.id); d.edits[e.id] = { title: f.title, text: f.text, theme: f.theme }; });
    }
    d.pick = d.pick.filter(id => essays.some(e => e.id === id));   // 已刪的列不留
    return d;
  }
  function save() { try { localStorage.setItem(dKey(), JSON.stringify(D)); } catch (e) {} }
  const teacher = () => $("tch").value.trim();
  const work = id => { const e = essays.find(x => x.id === id); return e ? Object.assign({}, e, D.edits[id] || {}) : null; };
  const pool = () => essays.filter(e => e.sem === sem);
  const picked = () => D.pick.map(work).filter(Boolean);

  // ── 畫面 ──
  function renderRule() {
    const r = Y.RULES[cls.grade] || Y.RULES[4], due = Y.dueOf(year, sem);
    const left = Math.ceil((new Date(due + "T23:59:59+08:00") - new Date()) / 864e5);
    $("rule").innerHTML = Y.themesOf(cls.grade, sem).map(t => `<span class="tag">${esc(t)}</span>`).join("") +
      `<span class="tag gold">${r.min}–${r.max} 字</span><span class="tag gold">每班 ${Y.MIN_N}–${Y.MAX_N} 篇・一人一件</span>` +
      (r.note ? `<span class="tag gold">${esc(r.note)}</span>` : "") +
      `<span class="tag ${left <= 7 ? "warn" : "ok"}">截止 ${due.slice(5).replace("-", "/")}・${left >= 0 ? "還有 " + left + " 天" : "已過 " + (-left) + " 天"}</span>`;
  }
  function badges(w) { return Y.issues(w, cls.grade, sem).map(i => `<span class="tag ${i.lv}">${esc(i.m)}</span>`).join(""); }
  function renderPool() {
    const list = pool().map(e => work(e.id)).sort((a, b) => Y.GRADE_ORDER.indexOf(a.grade) - Y.GRADE_ORDER.indexOf(b.grade) || a.seat - b.seat);
    $("poolEmpty").hidden = list.length > 0;
    $("pool").innerHTML = list.map(w => {
      const on = D.pick.includes(w.id), dup = !on && D.pick.some(id => (work(id) || {}).seat === w.seat);
      const dis = !on && (dup || !w.name);
      return `<div class="card ${on ? "on" : ""}">
        <div class="hd"><b>${esc(w.title || "（無題目）")}</b><span class="meta">座號 ${w.seat}・${esc(w.name || "？")}・${esc(w.genre || "—")}・等第 ${esc(w.grade || "—")}・${esc(w.date)}</span>
          <span class="sp"></span>
          <button class="btn small ${on ? "" : "primary"}" data-t="${w.id}" ${dis ? "disabled" : ""}>${on ? "移出" : dup ? "已有作品" : !w.name ? "需人工" : "選入"}</button></div>
        <div class="badges">${badges(w)}${w.mark ? `<span class="tag ok">已交 ${esc(w.mark)}</span>` : ""}</div>
        <details><summary>看全文</summary><pre>${esc(w.text)}</pre></details></div>`;
    }).join("");
    $("pool").querySelectorAll("[data-t]").forEach(b => b.onclick = () => toggle(b.dataset.t));
  }
  function toggle(id) {
    const i = D.pick.indexOf(id);
    if (i >= 0) D.pick.splice(i, 1);
    else { if (D.pick.length >= Y.MAX_N) return toast("最多 " + Y.MAX_N + " 篇"); D.pick.push(id); }
    save(); renderAll();
  }
  function renderOrder() {
    const themes = Y.themesOf(cls.grade, sem);
    $("orderEmpty").hidden = D.pick.length > 0;
    $("order").innerHTML = picked().map((w, k) => `<li>
      <div class="row"><input type="text" value="${esc(w.title)}" data-e="${w.id}" data-f="title" aria-label="題目">
        <span class="meta">${esc(w.name)}</span>
        <button class="btn small" data-mv="${k}" data-d="-1" ${k === 0 ? "disabled" : ""} aria-label="上移">↑</button>
        <button class="btn small" data-mv="${k}" data-d="1" ${k === D.pick.length - 1 ? "disabled" : ""} aria-label="下移">↓</button>
        <button class="btn small" data-t="${w.id}" aria-label="移出">✕</button></div>
      <div class="row2"><select data-e="${w.id}" data-f="theme"><option value="">選主題…</option>${themes.map(t => `<option ${w.theme === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
        ${w.themeAuto ? `<span class="tag gold" title="依題目與內文關鍵字自動判斷，可直接改">🤖 依題目判斷</span>` : ""}
        <button class="btn small ghost" data-reset="${w.id}" title="把題目、內文還原成批改時的原文">↺ 還原原文</button>
        <button class="btn small" data-polish="${w.id}" title="把目前內文送去微修（改動 ≤5%）">✨ 微修</button></div>
      <div class="badges">${badges(w)}</div>
      <textarea data-e="${w.id}" data-f="text">${esc(w.text)}</textarea>${polishBox(w)}</li>`).join("");
    const o = $("order");
    o.querySelectorAll("[data-t]").forEach(b => b.onclick = () => toggle(b.dataset.t));
    o.querySelectorAll("[data-mv]").forEach(b => b.onclick = () => {
      const k = +b.dataset.mv, j = k + (+b.dataset.d);
      [D.pick[k], D.pick[j]] = [D.pick[j], D.pick[k]]; save(); renderAll();
    });
    o.querySelectorAll("[data-reset]").forEach(b => b.onclick = () => {
      if (!confirm("還原成批改時的原文？這篇的修訂會清掉（主題保留）。")) return;
      const th = (D.edits[b.dataset.reset] || {}).theme;
      D.edits[b.dataset.reset] = th ? { theme: th } : {}; save(); renderAll();
    });
    o.querySelectorAll("[data-polish]").forEach(b => b.onclick = () => sendPolish([b.dataset.polish]));
    o.querySelectorAll("[data-adopt]").forEach(b => b.onclick = () => {
      const w = work(b.dataset.adopt), p = Y.parsePolish(w.polish);
      if (!Y.polishGate(p.base, p.revised).every(g => g.ok)) return toast("建議稿沒過把關，不能採用");
      if (w.text !== p.base && !confirm("送出微修後你又改過這篇內文；採用會以建議稿取代目前內文，確定？")) return;
      (D.edits[w.id] = D.edits[w.id] || {}).text = p.revised; seen(w); toast("已採用微修建議");
    });
    o.querySelectorAll("[data-skip]").forEach(b => b.onclick = () => seen(work(b.dataset.skip)));
    o.querySelectorAll("[data-e]").forEach(el => el.onchange = () => {
      const ed = (D.edits[el.dataset.e] = D.edits[el.dataset.e] || {});
      ed[el.dataset.f] = el.value;
      if (el.dataset.f === "theme") delete ed.themeAuto;   // 老師自己選過＝不再標自動
      save(); renderAll();
    });
  }
  let ok = false;
  function renderChecks() {
    const list = Y.checks(picked(), { grade: cls.grade, sem: sem, teacher: teacher() });
    ok = !list.some(([c]) => c === "bad");
    $("checks").innerHTML = list.map(([c, m]) => `<li class="${c}">${esc(m)}</li>`).join("");
    $("dl").disabled = !ok; $("done").disabled = !ok || busy;
    $("dl").title = ok ? "" : "檢核有⛔項目，修正後才能下載";
  }
  function renderPaper() {
    const ws = picked(), fn = Y.fileName(cls.code, sem);
    $("fname").textContent = "檔名：" + fn + "（全班一個 Word 檔；標題標楷體 16 號粗體，作者與內文標楷體 14 號）";
    $("paper").innerHTML = ws.length ? ws.map((w, k) =>
      (k && D.pgbrk ? '<div class="pb"></div>' : k ? '<p class="p">&nbsp;</p>' : "") +
      `<p class="t">${esc(w.title)}</p><p class="by">${esc(Y.byline(w, cls, teacher()))}</p>` +
      String(w.text).split("\n").map(l => `<p class="p">${esc(l) || "&nbsp;"}</p>`).join("")).join("")
      : '<div class="empty">選入作品後，這裡會出現 Word 的樣子</div>';
    $("award").textContent = ws.length ? ws.map(w => `座號 ${w.seat} ${w.name}〈${w.title}〉`).join("、") : "—";
    const label = year + sem, marked = essays.filter(e => e.mark === label);
    $("record").innerHTML = marked.length
      ? `✅ Notion 已記錄 ${esc(label)} 繳交 ${marked.length} 篇：${marked.map(e => esc(e.name)).join("、")}`
      : `尚未記錄 ${esc(label)} 繳交`;
    $("fromNotion").hidden = !D.fromNotion;
  }
  // 選入但還沒有主題的作品 → 依題目自動判斷（Y.guessTheme）並標記 themeAuto；老師改過選單就清掉標記
  function autoTheme() {
    let changed = false;
    D.pick.forEach(id => {
      const w = work(id);
      if (!w || w.theme) return;
      const t = Y.guessTheme(w, cls.grade, sem);
      if (!t) return;
      D.edits[id] = Object.assign(D.edits[id] || {}, { theme: t, themeAuto: true }); changed = true;
    });
    if (changed) save();
  }
  function renderAll() { autoTheme(); renderRule(); renderPool(); renderOrder(); renderChecks(); renderPaper(); }

  // ── ✨ 一鍵微修（SPEC_校刊挑選.md §7）──
  // 看過（採用或不採用）的建議記在草稿 polishSeen，Notion 欄位不動；欄位內容變了（再送一次）就會再出現
  function seen(w) { (D.polishSeen = D.polishSeen || {})[w.id] = w.polish; save(); renderAll(); }
  function polishBox(w) {
    const p = Y.parsePolish(w.polish);
    if (!p.state || (D.polishSeen || {})[w.id] === w.polish) return "";
    if (p.state === "pending") return `<div class="polish">⏳ 已送出微修（${esc(p.at)}）：請對 Claude Code 說「校刊微修」，完成後按「🔄 讀取微修結果」。</div>`;
    if (p.state === "manual") return `<div class="polish"><span class="tag warn">需人工</span> ${esc(p.reason)}（請自己在上面改） <button class="btn small ghost" data-skip="${w.id}">知道了</button></div>`;
    const gate = Y.polishGate(p.base, p.revised), pass = gate.every(g => g.ok);
    const html = Y.diff(p.base, p.revised).map(o => o.t === "=" ? esc(o.s) : o.t === "-" ? `<del>${esc(o.s)}</del>` : `<ins>${esc(o.s)}</ins>`).join("");
    return `<div class="polish"><div class="row"><b>✨ 微修建議</b><span class="meta">${esc(p.at)}</span>` +
      gate.map(g => `<span class="tag ${g.ok ? "ok" : "warn"}">${esc(g.m)}</span>`).join("") +
      (w.text !== p.base ? `<span class="tag gold">送出後內文又改過</span>` : "") + `</div>` +
      `<div class="diff">${html}</div><div class="row">` +
      (pass ? `<button class="btn small primary" data-adopt="${w.id}">採用</button>` : `<span class="tag warn">⛔ 沒過程式把關，不能採用</span>`) +
      `<button class="btn small" data-skip="${w.id}">不採用</button><span class="meta">紅色刪掉、綠色新增</span></div></div>`;
  }
  async function sendPolish(ids) {
    const ws = ids.map(work).filter(Boolean);
    if (!ws.length) return toast("尚未選入作品");
    status("送出微修中…");
    try {
      const r = await call({ action: "yearbook_polish", items: ws.map(w => ({ id: w.id, text: w.text })) });
      if (!r.ok) return status("❌ " + r.error, true);
      await load(true);
      status(`✨ 已送出 ${r.count} 篇微修（${r.at}）：請對 Claude Code 說「校刊微修」，完成後按「🔄 讀取微修結果」`);
    } catch (e) { if (e.message !== "口令錯誤") status("❌ 連線失敗：" + e.message, true); }
  }

  // ── 動作 ──
  function switchSem(s) {
    sem = s; D = loadDraft();
    document.querySelectorAll("#semSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.s === sem)));
    $("pgbrk").checked = D.pgbrk; renderAll();
  }
  function bind() {
    document.querySelectorAll("#semSeg button").forEach(b => b.onclick = () => switchSem(b.dataset.s));
    try { $("tch").value = localStorage.getItem(TCH_KEY) || ""; } catch (e) {}
    $("tch").oninput = () => { try { localStorage.setItem(TCH_KEY, $("tch").value); } catch (e) {} renderChecks(); renderPaper(); };
    $("polishAll").onclick = () => sendPolish(D.pick.slice());
    $("polishLoad").onclick = async () => {
      try { if (await load(true)) { const n = picked().filter(w => Y.parsePolish(w.polish).state === "done").length; status(`已讀取：選入的作品有 ${n} 篇微修建議`); } }
      catch (e) { if (e.message !== "口令錯誤") status("❌ 連線失敗：" + e.message, true); }
    };
    $("pgbrk").onchange = () => { D.pgbrk = $("pgbrk").checked; save(); renderPaper(); };
    $("auto").onclick = () => {
      if (D.pick.length && !confirm("用建議清單取代目前選的作品？（修訂內容會保留）")) return;
      D.pick = Y.suggest(pool(), cls.grade, sem); save(); renderAll();
      toast(D.pick.length ? "建議選入 " + D.pick.length + " 篇，主題已依題目判斷，請確認、調整" : "沒有合規的作品可建議");
    };
    $("dl").onclick = () => {
      const bytes = Y.buildDocx(picked(), cls, teacher(), D.pgbrk);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      a.download = Y.fileName(cls.code, sem); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    };
    $("done").onclick = async () => {
      const ws = picked();
      if (!confirm(`確定已把 ${Y.fileName(cls.code, sem)}（${ws.length} 篇）交給教務處？\n會在 Notion 記錄「${year + sem}」繳交與定稿；同學期之前記錄的會被這次取代。`)) return;
      busy = true; renderChecks(); status("寫入 Notion 中…");
      try {
        const r = await call({ action: "yearbook_mark", sem: sem, items: ws.map(w => ({ id: w.id, title: w.title.trim(), text: w.text, theme: w.theme })) });
        if (!r.ok) { status("❌ " + r.error, true); return; }
        status(`✅ 已記錄 ${r.label} 繳交 ${r.count} 篇（${r.at}）${r.cleared ? `，取代先前 ${r.cleared} 篇` : ""}`);
        await load(true);
      } catch (e) { if (e.message !== "口令錯誤") status("❌ 連線失敗：" + e.message, true); }
      finally { busy = false; renderChecks(); }
    };
  }
  async function load(keepStatus) {
    if (!keepStatus) status("讀取作文中…");
    const r = await call({ action: "yearbook_list" });
    if (!r.ok) { status("❌ " + r.error, true); return false; }
    year = r.year; essays = r.essays || [];
    $("yearLbl").textContent = year;
    if (!keepStatus) status(`已讀取 ${year} 學年作文 ${essays.length} 篇（上學期 ${essays.filter(e => e.sem === "上").length}・下學期 ${essays.filter(e => e.sem === "下").length}）`);
    D = loadDraft(); renderAll();
    return true;
  }

  async function init() {
    if (!pw()) return gate();
    $("gate").hidden = true; $("app").hidden = false;
    try {
      const c = await (await fetch("data/site-config.json?t=" + Date.now(), { cache: "no-cache" })).json();
      proxyUrl = c.updateProxyUrl;
      cls = Y.parseClass(c.className);
      if (!proxyUrl) return status("❌ 班網設定沒有代理網址（updateProxyUrl）", true);
      if (!cls) return status("❌ 班網設定的班級名稱看不出年級（" + c.className + "）", true);
      $("clsLbl").textContent = c.className;
      // 預設學期＝今天落在哪一學期（2–7 月下學期）
      const m = new Date().getMonth() + 1;
      sem = m >= 2 && m <= 7 ? "下" : "上";
      bind();
      if (await load()) switchSem(sem);
    } catch (e) { if (e.message !== "口令錯誤") status("❌ 讀取失敗：" + e.message, true); }
  }
  init();
})();
