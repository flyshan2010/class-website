/* 學生學習報告：家長輸入座號＋查詢碼 → 瀏覽器端解密顯示（資料以 AES-GCM 加密存放）
   功能：示意圖式版面、頭貼、A4 列印、去識別化 */
(async () => {
  const c = await App.init("report");
  const main = document.getElementById("main");
  const accent = c.moduleColors.report || "#10AC84";

  const showForm = (msg = "") => {
    document.body.classList.remove("report-open");
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

  // 去識別化：座號拿掉、姓名只留姓（例「30 王小明」→「王○明」）
  const maskName = full => {
    const name = String(full).replace(/^\s*\d+\s*/, "").replace(/（.*?）|\(.*?\)/g, "").trim();
    if (name.length <= 1) return name || "○○○";
    return name[0] + "○".repeat(Math.max(1, name.length - 2)) + (name.length > 2 ? name[name.length - 1] : "");
  };

  // 五向度雷達圖（SVG）
  const radarSVG = radar => {
    const names = Object.keys(radar);
    const cx = 130, cy = 118, r = 78;
    const pt = (i, ratio) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / names.length;
      return [cx + r * ratio * Math.cos(a), cy + r * ratio * Math.sin(a)];
    };
    const ring = ratio => names.map((_, i) => pt(i, ratio).map(n => n.toFixed(1)).join(",")).join(" ");
    const valuePoly = names.map((n, i) => pt(i, Math.max(0, Math.min(5, radar[n])) / 5).map(x => x.toFixed(1)).join(",")).join(" ");
    const labels = names.map((n, i) => {
      const [x, y] = pt(i, 1.26);
      return `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="13" fill="#57606f">${App.esc(n)}</text>`;
    }).join("");
    return `
      <svg viewBox="0 0 260 246" class="report-radar" role="img" aria-label="五向度雷達圖">
        ${[1, 0.8, 0.6, 0.4, 0.2].map(rt => `<polygon points="${ring(rt)}" fill="none" stroke="#e8e4d8" />`).join("")}
        ${names.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0].toFixed(1)}" y2="${pt(i, 1)[1].toFixed(1)}" stroke="#e8e4d8" />`).join("")}
        <polygon points="${valuePoly}" fill="rgba(29,209,161,.35)" stroke="#1DD1A1" stroke-width="2.5" stroke-linejoin="round" />
        ${names.map((n, i) => `<circle cx="${pt(i, radar[n] / 5)[0].toFixed(1)}" cy="${pt(i, radar[n] / 5)[1].toFixed(1)}" r="3.5" fill="#10AC84" />`).join("")}
        ${labels}
      </svg>`;
  };

  const GRADE_COLORS = { "內容評量": "#54A0FF", "作業成績": "#FF6B81", "上課參與": "#1DD1A1", "生活常規": "#FECA57" };
  const SUBJ_EMOJI = { "國語": "📖", "數學": "🔢", "社會": "🌏", "人際互動": "🙌", "生活技能": "🎒" };
  const SUBJ_COLORS = { "國語": "#FF6B81", "數學": "#54A0FF", "社會": "#FECA57", "人際互動": "#FF9F43", "生活技能": "#1DD1A1" };

  // 理財表現：依儲蓄率給一句正向、可行動的收支觀察（金融教育）
  const financeNote = fin => {
    const r = fin && fin.savingsRate;
    if (r == null) return "開始記帳，觀察自己的收支";
    if (r >= 60) return "量入為出，很會存錢 👍";
    if (r >= 30) return "收支平衡，可以再多存一點";
    if (r >= 0) return "花費偏多，記得留點錢儲蓄";
    return "支出超過收入，先緩一緩消費";
  };

  // 期考成績級距圖表 v2：解析考週「考試成績摘要」→ 各科「分數級距分布長條＋我的落點★＋全班平均▽」。
  // 依成績評量規定：不呈現個人三科平均與名次；解析失敗退回純文字，向後相容。
  const examChart = raw => {
    if (!raw) return "";
    const text = String(raw).replace(/<br\s*\/?>/gi, "\n"); // 相容 <br> 與換行兩種分隔
    const subjRe = /(國語|數學|社會)\s*(\d+)\s*（\s*班平均\s*([\d.]+)\s*）/g;
    const subjects = [];
    let m;
    while ((m = subjRe.exec(text))) subjects.push({ name: m[1], score: +m[2], avg: +m[3] });
    if (!subjects.length) return `<p style="white-space:pre-line">${App.esc(text)}</p>`;
    const bandsBy = {}; // 科目 → {級距label: 人數}
    for (const line of App.lines(text)) {
      const bm = line.match(/^(國語|數學|社會)級距[：:]\s*(.+)$/);
      if (bm) {
        const o = {};
        bm[2].split(/[｜|]/).forEach(seg => {
          const g = seg.match(/(.+?)[：:]\s*(\d+)\s*人/);
          if (g) o[g[1].trim()] = +g[2];
        });
        bandsBy[bm[1]] = o;
      }
    }
    // 由低到高的五個分數級距（顯示用；相容來源 90-100 標籤）
    const BANDS = [
      { keys: ["60以下"], label: "60↓" },
      { keys: ["60-69"], label: "60-69" },
      { keys: ["70-79"], label: "70-79" },
      { keys: ["80-89"], label: "80-89" },
      { keys: ["90-100", "90以上"], label: "90↑" },
    ];
    // 分數 → 在五等寬級距軸上的百分位（含級距內插，方便 ★/▽ 精準定位）
    const scorePct = sc => {
      let seg, frac;
      if (sc >= 90) { seg = 4; frac = Math.min(1, (sc - 90) / 10); }
      else if (sc >= 80) { seg = 3; frac = (sc - 80) / 10; }
      else if (sc >= 70) { seg = 2; frac = (sc - 70) / 10; }
      else if (sc >= 60) { seg = 1; frac = (sc - 60) / 10; }
      else { seg = 0; frac = Math.max(0, Math.min(1, sc / 60)); }
      return Math.max(2, Math.min(98, (seg + frac) / 5 * 100));
    };
    const meSeg = sc => sc >= 90 ? 4 : sc >= 80 ? 3 : sc >= 70 ? 2 : sc >= 60 ? 1 : 0;
    return `
      <div class="exam-chart">
        <div class="exam-legend">
          <span class="exl"><i class="ex-i-me">★</i>我的分數</span>
          <span class="exl"><i class="ex-i-avg">▽</i>全班平均</span>
          <span class="exl exl-dim">長條數字＝該級距人數</span>
        </div>
        <div class="exam-grid">
          <div class="exam-hrow exam-head">
            <span>科目</span><span>我的分數</span><span>全班分數級距分布</span><span>班平均</span>
          </div>
          ${subjects.map(s => {
            const o = bandsBy[s.name] || {};
            const mp = scorePct(s.score), ap = scorePct(s.avg), mb = meSeg(s.score);
            return `
            <div class="exam-hrow">
              <span class="ex-subj">${SUBJ_EMOJI[s.name] || "📘"} ${App.esc(s.name)}</span>
              <span class="ex-score">${s.score}</span>
              <div class="ex-dist">
                <div class="ex-bands">
                  ${BANDS.map((b, i) => {
                    const n = b.keys.reduce((v, k) => v + (o[k] || 0), 0);
                    return `<div class="ex-band ex-b${i}${i === mb ? " ex-b-me" : ""}"><span class="ex-bn">${n}</span><span class="ex-bl">${b.label}</span></div>`;
                  }).join("")}
                </div>
                <span class="ex-mark ex-mark-me" style="left:${mp}%">★</span>
                <span class="ex-mark ex-mark-avg" style="left:${ap}%">▽</span>
              </div>
              <span class="ex-avg">${s.avg}</span>
            </div>`;
          }).join("")}
        </div>
        <p class="exam-note">※ 長條為全班各分數級距的人數分布；★是孩子的分數落點、▽是全班平均，方便對照孩子在班上的位置（依規定不呈現個人排名）。</p>
      </div>`;
  };

  function showReport(report, periodIdx = report.periods.length - 1, anon = false) {
    document.body.classList.add("report-open");
    const p = report.periods[periodIdx];
    const displayName = anon ? maskName(report.name) : report.name;
    const seatText = anon ? "──" : App.esc(report.seat);
    const avatar = (!anon && report.avatar)
      ? `<img class="avatar-img" src="${report.avatar}" alt="頭貼" />`
      : `<div class="avatar">🧑‍🎓</div>`;

    // 週次多時用下拉選單，少時用按鈕
    const periodPicker = report.periods.length > 5
      ? `<select id="report-period">${report.periods.map((x, i) =>
          `<option value="${i}" ${i === periodIdx ? "selected" : ""}>${App.esc(x.period)}</option>`).join("")}</select>`
      : `<div class="report-tabs">${report.periods.map((x, i) =>
          `<button class="${i === periodIdx ? "active" : ""}" data-i="${i}">${App.esc(x.period)}</button>`).join("")}</div>`;

    main.innerHTML = `
      <div class="report-toolbar no-print">
        ${periodPicker}
        <div class="report-actions">
          <button id="report-anon" class="report-tool ${anon ? "on" : ""}">🕶️ 去識別化${anon ? "：開" : ""}</button>
          <button id="report-print" class="report-tool">🖨️ 列印報告</button>
          <button id="report-exit" class="report-exit">🔒 離開</button>
        </div>
      </div>

      <div class="report-sheet">
        <h2 class="report-title">✨ 學生學習分析報告 ✨</h2>

        <div class="report-top">
          <div class="report-id-card">
            ${avatar}
            <p><strong>姓名：</strong>${App.esc(displayName)}</p>
            <p><strong>座號：</strong>${seatText}</p>
            <p class="meta">${App.esc(p.period)}</p>
            ${(c.showReportBalance !== false && !anon && report.finance)
              ? `<div class="report-finance">
                   <div class="fin-bal">🏦 存款 <strong>${report.finance.balance}</strong> 崑山幣</div>
                   ${report.finance.income > 0 ? `
                   <div class="fin-row"><span>收入 ${report.finance.income}</span><span>支出 ${report.finance.expense}</span></div>
                   <div class="fin-rate">💰 儲蓄率 <strong>${report.finance.savingsRate != null ? report.finance.savingsRate + "%" : "—"}</strong></div>
                   <div class="fin-note">${App.esc(financeNote(report.finance))}</div>` : ""}
                 </div>`
              : ((c.showReportBalance !== false && report.balance != null && !anon)
                  ? `<p class="report-balance">🏦 班級存款 <strong>${report.balance}</strong> 崑山幣</p>` : "")}
          </div>
          <div class="report-overview-card">
            <span class="report-badge" style="--bc:#54A0FF">整體學習狀況概覽</span>
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

        <span class="report-badge" style="--bc:#FF9F43">各科詳細狀況與建議</span>
        <div class="report-subjects">
          ${(() => {
            const shown = p.subjects.filter(s => s.state || s.advice);
            // 無空白保底：整週各科皆無內容時，仍給中性一句，避免出現空白區塊
            if (!shown.length) return `
            <div class="report-subject" style="--sc:#54A0FF; grid-column:1 / -1">
              <div class="head">📘 本週各科</div>
              <p>本週無特別記錄，各科學習狀況穩定，請孩子維持目前的學習節奏。</p>
            </div>`;
            return shown.map(s => `
            <div class="report-subject" style="--sc:${SUBJ_COLORS[s.name] || "#54A0FF"}">
              <div class="head">${SUBJ_EMOJI[s.name] || "📘"} ${App.esc(s.name)}</div>
              ${s.state ? `<p><strong>狀態：</strong>${App.esc(s.state)}</p>` : ""}
              ${s.advice ? `<p><strong>建議：</strong>${App.esc(s.advice)}</p>` : ""}
            </div>`).join("");
          })()}
        </div>

        ${p.examSummary ? `
        <div class="report-box" style="--bc:#EE5253; margin-top:12px">
          <span class="report-badge" style="--bc:#EE5253">📊 定期評量成績與全班級距</span>
          ${examChart(p.examSummary)}
        </div>` : ""}

        <div class="report-bottom">
          ${App.lines(p.highlights).length ? `
          <div class="report-box" style="--bc:#FECA57">
            <span class="report-badge" style="--bc:#FECA57">💡 學生亮點</span>
            <div class="recap-highlights">${App.lines(p.highlights).map(h => `<span class="recap-chip">${App.esc(h)}</span>`).join("")}</div>
          </div>` : ""}
          ${(p.shortGoal || p.longGoal) ? `
          <div class="report-box" style="--bc:#54A0FF">
            <span class="report-badge" style="--bc:#54A0FF">🎯 學習目標</span>
            ${p.shortGoal ? `<p>📈 <strong>短期：</strong>${App.esc(p.shortGoal)}</p>` : ""}
            ${p.longGoal ? `<p>🚀 <strong>長期：</strong>${App.esc(p.longGoal)}</p>` : ""}
          </div>` : ""}
          ${App.lines(p.parentTips).length ? `
          <div class="report-box" style="--bc:#FF9F43">
            <span class="report-badge" style="--bc:#FF9F43">🤝 家長協助建議</span>
            ${App.ul(p.parentTips)}
          </div>` : ""}
        </div>
        <p class="report-footnote">${anon ? "本報告已去識別化。" : `本報告僅供 ${App.esc(displayName)} 的家長參考，請勿外傳。`}　${App.esc(c.schoolYear)} ${App.esc(c.className)}</p>
      </div>`;

    main.querySelectorAll(".report-tabs button").forEach(b =>
      b.onclick = () => showReport(report, Number(b.dataset.i), anon));
    const sel = document.getElementById("report-period");
    if (sel) sel.onchange = () => showReport(report, Number(sel.value), anon);
    document.getElementById("report-anon").onclick = () => showReport(report, periodIdx, !anon);
    document.getElementById("report-print").onclick = () => window.print();
    document.getElementById("report-exit").onclick = () => showForm();
  }

  showForm();
})();
