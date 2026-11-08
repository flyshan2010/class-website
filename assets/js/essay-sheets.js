/* 教師專區「📝 作文說明單」（SPEC_作文說明單 §4，老師 2026-11-09）
 * - 題目清單＝data/essay-sheets.json（公開、無個資）：三版 PDF 下載＋網頁版連結，檔案都在教材庫 lessons/。
 * - 分層名單＝data/essay-tiers.json（教師口令加密，只有座號＋最弱步驟）；預設收合，點開才解密（共用 TeacherDash.unlock）。
 * - 做新的一課：一句話交辦「作文說明單：第○課〈題目〉」→ 路由 R21 → 收件匣待審，老師在 Claude Code 對話中完成。 */
(function () {
  const LESSONS = "https://flyshan2010.github.io/lessons/";
  const TIERS = ["基礎版", "進階版", "挑戰版"];
  const COL = { 基礎版: "#2f9e44", 進階版: "#1c7ed6", 挑戰版: "#e8590c" };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fileOf = (s, tier) => s.file.replace("{版}", tier);
  const href = (s, tier, ext) => LESSONS + encodeURIComponent(s.folder) + "/" + encodeURIComponent(fileOf(s, tier) + ext);
  let tiersP = null; // 同一頁只解一次

  const tierCol = (s, tier) => `
    <div class="es-tier" style="border-top:4px solid ${COL[tier]};padding:8px 10px;background:#fafafa;border-radius:8px">
      <b style="color:${COL[tier]}">${tier}</b>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <a class="badge" href="${href(s, tier, ".pdf")}" download="${esc(fileOf(s, tier))}.pdf">⬇️ PDF</a>
        <a class="badge" href="${href(s, tier, ".html")}" target="_blank" rel="noopener">🌐 網頁版</a>
      </div>
      <div class="es-seats meta" data-tier="${tier}" style="margin-top:6px"></div>
    </div>`;

  const card = s => `
    <div class="es-sheet" data-id="${esc(s.id)}" style="border:1px solid #eee;border-radius:10px;padding:10px 12px;margin-top:10px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <b>${esc(s.name)}</b><span class="meta">${esc(s.genre)}${s.date ? "・" + esc(s.date) : ""}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px">
        ${TIERS.map(t => tierCol(s, t)).join("")}
      </div>
      <details class="es-who" style="margin-top:8px">
        <summary class="meta" style="cursor:pointer">👥 誰用哪一版（點開才顯示；只顯示座號）</summary>
        <div class="es-who-body meta" style="margin-top:6px"></div>
      </details>
    </div>`;

  function fill(box, s, entry) {
    const body = box.querySelector(".es-who-body");
    if (!entry) { body.textContent = "這一題還沒有分層名單（班網同步後才會出現）。"; return; }
    if (entry.error) { body.innerHTML = `<span style="color:#c0392b">${esc(entry.error)}</span>`; return; }
    const tiers = entry.tiers || {};
    box.querySelectorAll(".es-seats").forEach(el => {
      const list = tiers[el.dataset.tier] || [];
      el.innerHTML = list.length
        ? `<b>${list.length} 人</b>：` + list.map(([seat, weak]) => `${seat}${weak ? `<small style="color:#888">(${esc(weak)})</small>` : ""}`).join("、")
        : "（無）";
    });
    const extra = Object.keys(tiers).filter(k => !TIERS.includes(k));
    body.innerHTML = (entry.note ? esc(entry.note) : "名單已顯示在各版下方。") +
      (extra.length ? `<br><span style="color:#c0392b">另有：${extra.map(k => `${esc(k)} ${tiers[k].map(x => x[0]).join("、")}`).join("；")}</span>` : "");
  }

  async function reveal(box, s) {
    const body = box.querySelector(".es-who-body");
    body.textContent = "解密中…";
    let r;
    try { r = await (tiersP ||= window.TeacherDash.unlock("data/essay-tiers.json")); }
    catch { tiersP = null; body.textContent = "還沒有分層名單檔（班網同步後才會出現）。"; return; }
    if (r.data) return fill(box, s, r.data.tiers?.[s.id]);
    tiersP = null;
    body.innerHTML = `<span>口令和登入口令不同，請輸入設定 TEACHER_DASH_PW 時用的口令：</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"><input class="es-pw" type="password" autocomplete="off" placeholder="儀表板口令"
        style="flex:1;min-width:0;padding:6px;border:1px solid #ccc;border-radius:8px" /><button class="es-pw-btn emotion-draw" style="margin:0;width:auto;padding:6px 14px">解開</button></div>`;
    const go = async () => {
      const pw = body.querySelector(".es-pw").value.trim(); if (!pw) return;
      const r2 = await window.TeacherDash.unlock("data/essay-tiers.json", pw).catch(() => ({ need: true }));
      if (!r2.data) { body.querySelector(".es-pw").value = ""; body.querySelector(".es-pw").placeholder = "口令不正確"; return; }
      tiersP = Promise.resolve(r2); fill(box, s, r2.data.tiers?.[s.id]);
    };
    body.querySelector(".es-pw-btn").onclick = go;
    body.querySelector(".es-pw").onkeydown = e => { if (e.key === "Enter") go(); };
  }

  window.EssaySheets = {
    async mount() {
      const el = document.getElementById("essay-body");
      if (!el) return;
      let sheets = [];
      try { sheets = (await App.fetchJSON("data/essay-sheets.json")).sheets || []; } catch { /* 下面顯示空 */ }
      el.innerHTML = sheets.length ? sheets.map(card).join("") : `<p class="empty-hint">還沒有已上線的作文說明單。</p>`;
      el.querySelectorAll(".es-sheet").forEach(box => {
        const s = sheets.find(x => x.id === box.dataset.id);
        const det = box.querySelector(".es-who");
        let done = false;
        det.addEventListener("toggle", () => { if (det.open && !done) { done = true; reveal(box, s); } });
      });
    },
  };
})();
