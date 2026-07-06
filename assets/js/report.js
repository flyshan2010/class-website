/* 學生學習報告：家長輸入座號＋查詢碼 → 瀏覽器端解密顯示（資料以 AES-GCM 加密存放） */
(async () => {
  const c = await App.init("report");
  const main = document.getElementById("main");
  const accent = c.moduleColors.report || "#10AC84";

  const showForm = (msg = "") => {
    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>📊 學生學習報告</h2>
      <div class="card report-gate" style="--accent:${accent}">
        <p>輸入<strong>座號</strong>與老師發的<strong>查詢碼</strong>，查看孩子的學習分析報告。</p>
        <form id="report-form" class="report-form" autocomplete="off">
          <label>座號<input id="rp-seat" type="number" min="1" max="99" required inputmode="numeric" /></label>
          <label>查詢碼<input id="rp-code" type="password" required /></label>
          <button type="submit">🔓 查看報告</button>
        </form>
        ${msg ? `<p class="report-error">${msg}</p>` : ""}
        <p class="meta" style="margin-top:10px">🔒 報告內容經加密保護，只有輸入正確查詢碼才能看到；查詢碼請向老師索取，不要外流。</p>
      </div>`;
    document.getElementById("report-form").addEventListener("submit", async e => {
      e.preventDefault();
      const seat = document.getElementById("rp-seat").value.trim();
      const code = document.getElementById("rp-code").value.trim();
      const btn = e.target.querySelector("button");
      btn.disabled = true; btn.textContent = "解密中…";
      try {
        const res = await fetch(`data/reports/${seat}.json`, { cache: "no-cache" });
        if (!res.ok) throw new Error("noseat");
        const report = await decrypt(await res.json(), seat, code);
        showReport(report);
      } catch (err) {
        showForm(err.message === "noseat" ? "這個座號目前沒有已發布的報告，請確認座號或詢問老師。" : "查詢碼不正確，請再試一次或詢問老師。");
      }
    });
  };

  const b64d = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));

  async function decrypt(payload, seat, code) {
    const baseKey = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(`${Number(seat)}:${code}`), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64d(payload.salt), iterations: 150000, hash: "SHA-256" },
      baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(payload.iv) }, key, b64d(payload.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // 五向度雷達圖（SVG）
  const radarSVG = radar => {
    const names = Object.keys(radar);
    const cx = 130, cy = 120, r = 82;
    const pt = (i, ratio) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / names.length;
      return [cx + r * ratio * Math.cos(a), cy + r * ratio * Math.sin(a)];
    };
    const ring = ratio => names.map((_, i) => pt(i, ratio).map(n => n.toFixed(1)).join(",")).join(" ");
    const valuePoly = names.map((n, i) => pt(i, Math.max(0, Math.min(5, radar[n])) / 5).map(x => x.toFixed(1)).join(",")).join(" ");
    const labels = names.map((n, i) => {
      const [x, y] = pt(i, 1.24);
      return `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="13" fill="#57606f">${App.esc(n)}</text>`;
    }).join("");
    return `
      <svg viewBox="0 0 260 250" class="report-radar" role="img" aria-label="五向度雷達圖">
        ${[1, 0.8, 0.6, 0.4, 0.2].map(rt => `<polygon points="${ring(rt)}" fill="none" stroke="#e8e4d8" />`).join("")}
        ${names.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0].toFixed(1)}" y2="${pt(i, 1)[1].toFixed(1)}" stroke="#e8e4d8" />`).join("")}
        <polygon points="${valuePoly}" fill="rgba(29,209,161,.35)" stroke="#1DD1A1" stroke-width="2.5" stroke-linejoin="round" />
        ${names.map((n, i) => `<circle cx="${pt(i, radar[n] / 5)[0].toFixed(1)}" cy="${pt(i, radar[n] / 5)[1].toFixed(1)}" r="3.5" fill="#10AC84" />`).join("")}
        ${labels}
      </svg>`;
  };

  const GRADE_COLORS = { "考試成績": "#54A0FF", "作業成績": "#FF6B81", "上課參與": "#1DD1A1", "生活常規": "#FECA57" };
  const SUBJ_EMOJI = { "國語": "📖", "數學": "🔢", "社會": "🌏", "人際互動": "🙌", "生活技能": "🎒" };
  const SUBJ_COLORS = { "國語": "#FF6B81", "數學": "#54A0FF", "社會": "#FECA57", "人際互動": "#FF9F43", "生活技能": "#1DD1A1" };

  function showReport(report, periodIdx = report.periods.length - 1) {
    const p = report.periods[periodIdx];
    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>📊 學生學習分析報告</h2>
      <div class="report-toolbar">
        <div class="report-tabs">
          ${report.periods.map((x, i) => `<button class="${i === periodIdx ? "active" : ""}" data-i="${i}">${App.esc(x.period)}</button>`).join("")}
        </div>
        <button id="report-exit" class="report-exit">🔒 離開報告</button>
      </div>

      <div class="card" style="--accent:${accent}">
        <div class="report-head">
          <div class="report-student">
            <div class="avatar">🧑‍🎓</div>
            <div><strong>${App.esc(report.name)}</strong><div class="meta">座號 ${App.esc(report.seat)} ・ ${App.esc(p.period)}</div></div>
          </div>
          <div class="report-overview">
            ${radarSVG(p.radar)}
            <div class="report-grades">
              ${Object.entries(p.grades).filter(([, v]) => v).map(([k, v]) => `
                <div class="grade-chip" style="--gc:${GRADE_COLORS[k] || "#54A0FF"}">
                  <span class="k">${App.esc(k)}</span><span class="v">${App.esc(v)}</span>
                </div>`).join("")}
            </div>
          </div>
        </div>
      </div>

      <h3 class="report-sec-title">📚 各科詳細狀況與建議</h3>
      <div class="report-subjects">
        ${p.subjects.filter(s => s.state || s.advice).map(s => `
          <div class="report-subject" style="--sc:${SUBJ_COLORS[s.name] || "#54A0FF"}">
            <div class="head">${SUBJ_EMOJI[s.name] || "📘"} ${App.esc(s.name)}</div>
            ${s.state ? `<p><strong>狀態：</strong>${App.esc(s.state)}</p>` : ""}
            ${s.advice ? `<p><strong>建議：</strong>${App.esc(s.advice)}</p>` : ""}
          </div>`).join("")}
      </div>

      <div class="report-bottom">
        ${App.lines(p.highlights).length ? `
        <div class="card" style="--accent:#FECA57">
          <h3>💡 學生亮點</h3>
          <div class="recap-highlights">${App.lines(p.highlights).map(h => `<span class="recap-chip">${App.esc(h)}</span>`).join("")}</div>
        </div>` : ""}
        ${(p.shortGoal || p.longGoal) ? `
        <div class="card" style="--accent:#54A0FF">
          <h3>🎯 學習目標</h3>
          ${p.shortGoal ? `<p>📈 <strong>短期：</strong>${App.esc(p.shortGoal)}</p>` : ""}
          ${p.longGoal ? `<p>🚀 <strong>長期：</strong>${App.esc(p.longGoal)}</p>` : ""}
        </div>` : ""}
        ${App.lines(p.parentTips).length ? `
        <div class="card" style="--accent:#FF9F43">
          <h3>🤝 家長協助建議</h3>
          ${App.ul(p.parentTips)}
        </div>` : ""}
      </div>
      <p class="meta" style="text-align:center;margin-top:6px">🔒 本頁內容僅供 ${App.esc(report.name)} 的家長參考，請勿截圖外傳。</p>`;

    main.querySelectorAll(".report-tabs button").forEach(b =>
      b.onclick = () => showReport(report, Number(b.dataset.i)));
    document.getElementById("report-exit").onclick = () => showForm();
  }

  showForm();
})();
