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
    // 教師儀表板「點座號」連過來（report.html#seat=N）：只預填座號，查詢碼仍要自己輸入
    const pre = (location.hash.match(/^#seat=(\d{1,2})$/) || [])[1];
    if (pre) { document.getElementById("rp-seat").value = pre; document.getElementById("rp-code").focus(); }
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
  // 等第標準說明（老師 2026-09-13 要求：給家長與孩子參考）。只列特優／優／甲；
  // 正本＝docs/學生評分標準.md，改標準時兩處一起改。
  const GRADE_GUIDE = [
    // 2026-09-28 起照「評分標準 v2」：每天算量尺分數、一週五天相加（正本 ClassOS_v3.5_藍圖/SPEC_學習報告評分標準v2.md §4）
    ["內容評量", ["各科評量依每週節數加權平均 90 分以上（國5・數4・社3・綜2・健1・活力Go1）",
                "加權平均 80–89 分",
                "加權平均 70–79 分，或本週沒有評量"]],
    ["作業成績", ["一週作業分數 7 以上（每天完成＝1，甲上＝2、甲上上＝3，未交或要訂正每份 −1）",
                "一週作業分數 6（例：天天完成，有一次甲上）",
                "一週作業分數 5 以下（天天完成＝5＝本分）"]],
    ["上課參與", ["一週上課分數 10 以上（每天：盡本分＝1，主動參與＝2，帶動別人＝3，帶全班＝4；課堂負向再扣）",
                "一週上課分數 6–9（至少一天主動舉手發表或上台）",
                "一週上課分數 5 以下（五天都盡本分＝5）"]],
    ["生活常規", ["一週生活分數 20 以上（每天：準時、打掃達標、潔牙各 1，支援或主動 +1，帶動同學 +2 以上）",
                "一週生活分數 16–19（至少一次支援或主動）",
                "一週生活分數 15 以下（天天三項都做到＝15＝本份）"]],
  ];
  const gradeGuide = () => `
    <p class="grade-guide-hint">💡 「甲」是基準＝這週穩定、符合期待。等第只看本週紀錄，請搭配下方建議與亮點一起看。</p>
    <details class="grade-guide">
      <summary>📏 等第怎麼看？（特優・優・甲 的標準）</summary>
      <p class="grade-guide-note">等第由高到低是 <strong>特優 ＞ 優 ＞ 甲</strong>。<strong>「甲」是基準，代表這週表現穩定、符合期待，不是退步</strong>；這週沒有特別紀錄時也是甲。<br>等第只反映<strong>這一週</strong>老師記錄到的事件，請搭配下方「各科詳細狀況與建議」和「學生亮點」一起看，不要只看等級。</p>
      <div class="grade-guide-grid">
        ${GRADE_GUIDE.map(([k, rows]) => `
          <div class="grade-guide-card" style="--gc:${GRADE_COLORS[k]}">
            <div class="head">${k}</div>
            <dl>${["特優", "優", "甲"].map((g, i) => `<dt>${g}</dt><dd>${rows[i]}</dd>`).join("")}</dl>
          </div>`).join("")}
      </div>
    </details>`;
  const SUBJ_EMOJI = { "國語": "📖", "數學": "🔢", "社會": "🌏", "人際互動": "🙌", "生活技能": "🎒" };
  // 五向度配色＝方案 A（2026-10-16 老師裁定；五色兩兩可分，紅綠色弱另靠期末曲線線尾標名輔助）
  const SUBJ_COLORS = { "國語": "#c2185b", "數學": "#2a78d6", "社會": "#eda100", "人際互動": "#e8590c", "生活技能": "#1baf7a" };

  // 理財表現：依儲蓄率給一句正向、可行動的收支觀察（金融教育）
  const financeNote = fin => {
    const r = fin && fin.savingsRate;
    if (r == null) return "開始記帳，觀察自己的收支";
    if (r >= 60) return "量入為出，很會存錢 👍";
    if (r >= 30) return "收支平衡，可以再多存一點";
    if (r >= 0) return "花費偏多，記得留點錢儲蓄";
    return "支出超過收入，先緩一緩消費";
  };

  // 累積經驗值（XP）與稱號（2026-08-14 雙貨幣制）
  // XP 只加總「薪水」與「獎勵金」，消費與扣點都不會讓它變少——它記的是
  // 「做過多少好事、扛過多少責任」，不是「現在還剩多少錢」。
  // 刻意只顯示自己的 XP 與下一階，不做全班排序（XP 只增不減，公開排名等於
  // 一張永遠追不上的排行榜，與成績不排名同一個道理）。
  // 兩條軌分開顯示，孩子才看得出「我是把本分做穩」還是「我還多做了什麼」：
  //   責任 XP＝幹部週薪＋打掃＋午餐＋班級常規獎勵（做好本分就會穩定累積）
  //   貢獻 XP＝正向行為＋亮點＋進步獎（額外的努力與付出）
  const xpBlock = fin => {
    if (!fin || fin.xp == null) return "";
    const t = fin.xpTitle;
    const duty = fin.xpDuty ?? 0, merit = fin.xpMerit ?? 0;
    const total = Math.max(1, duty + merit);
    return `
      <div class="fin-xp">
        <div class="xp-head">
          <span class="xp-title">${App.esc(t ? `${t.emoji} ${t.name}` : "🌱 新芽")}</span>
          <span class="xp-num">累積 XP <strong>${fin.xp}</strong></span>
        </div>
        ${(duty || merit) ? `
        <div class="xp-bar" role="img" aria-label="責任 XP ${duty}、貢獻 XP ${merit}">
          <span class="xp-seg duty" style="width:${(duty / total * 100).toFixed(1)}%"></span>
          <span class="xp-seg merit" style="width:${(merit / total * 100).toFixed(1)}%"></span>
        </div>
        <div class="xp-split">
          <span><i class="dot duty"></i>責任 ${duty}<small>本分做好</small></span>
          <span><i class="dot merit"></i>貢獻 ${merit}<small>額外付出</small></span>
        </div>` : ""}
        ${t && t.next ? `<div class="xp-next">再 ${t.toNext} XP 就是 ${App.esc(t.next)}</div>`
                      : '<div class="xp-next">已經是最高稱號，繼續帶著大家一起前進 ✨</div>'}
        <div class="xp-hint">XP＝薪水＋獎勵金的累積，<b>花錢、被扣點都不會減少</b>；它記錄你做過的每一件事。</div>
      </div>`;
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

  // 期末總報告：五向度逐週成長曲線（折線圖，資料取自本學期各週報告的雷達分數）
  // 作品照片：Google Drive 分享連結轉縮圖網址（非 Drive 連結原樣使用）
  const workImg = u => {
    const m = String(u).match(/drive\.google\.com\/file\/d\/([\w-]+)/);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1200` : u;
  };

  // 作品照片（Notion 上傳、加密落地版）：報告解開後才抓照片檔，用報告內附的金鑰解密成 blob 顯示
  const hydrateWorks = root => root.querySelectorAll("img[data-enc]").forEach(async img => {
    try {
      const res = await fetch(img.dataset.enc, { cache: "force-cache" });
      if (!res.ok) throw new Error(res.status);
      const key = await crypto.subtle.importKey("raw", b64d(img.dataset.k), "AES-GCM", false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(img.dataset.iv) }, key, await res.arrayBuffer());
      const url = URL.createObjectURL(new Blob([plain], { type: img.dataset.type }));
      img.src = url;
      img.closest("a")?.setAttribute("href", url);
    } catch {
      img.alt = "（照片暫時無法顯示）";
    }
  });

  const growthChart = periods => {
    // 只取每週列：期末總報告不入曲線；作文批改列沒有五向度分數（radar 為 undefined）也必須排除
    const weeks = periods.filter(x => x.reportType !== "期末總報告" && x.reportType !== "作文批改");
    if (weeks.length < 2)
      return `<p class="meta" style="padding:16px">本學期週報資料不足，無法繪製成長曲線（至少需 2 週）。</p>`;
    const dims = ["國語", "數學", "社會", "人際互動", "生活技能"];
    const W = 560, H = 165, padL = 26, padR = 72, padT = 10, padB = 24, n = weeks.length;
    const x = i => padL + (W - padL - padR) * (n === 1 ? 0.5 : i / (n - 1));
    const y = v => padT + (H - padT - padB) * (1 - (Math.max(1, Math.min(5, v)) - 1) / 4);
    const grid = [1, 2, 3, 4, 5].map(v =>
      `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="#eee" />` +
      `<text x="${padL - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="11" fill="#9a9a8e">${v}</text>`).join("");
    const xlabels = weeks.map((w, i) => {
      const m = String(w.period).match(/第(.+?)週/);
      return `<text x="${x(i).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="11" fill="#9a9a8e">${App.esc(m ? m[1] : i + 1)}</text>`;
    }).join("");
    const lines = dims.map(d => {
      const col = SUBJ_COLORS[d];
      const pts = weeks.map((w, i) => `${x(i).toFixed(1)},${y(w.radar[d] || 3).toFixed(1)}`).join(" ");
      const dots = weeks.map((w, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(w.radar[d] || 3).toFixed(1)}" r="2.5" fill="${col}" />`).join("");
      return `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" />${dots}`;
    }).join("");
    // 線尾直接標名（色覺輔助）：依末值排序，相鄰標籤至少相隔 14px 避免重疊
    const ends = dims.map(d => ({ d, yy: y(weeks[n - 1].radar[d] || 3) })).sort((a, b) => a.yy - b.yy);
    ends.forEach((e, i) => { if (i && e.yy - ends[i - 1].yy < 14) e.yy = ends[i - 1].yy + 14; });
    const endLabels = ends.map(e =>
      `<text x="${(x(n - 1) + 8).toFixed(1)}" y="${(e.yy + 4).toFixed(1)}" font-size="12" fill="#2d3436">${e.d}</text>`).join("");
    const legend = dims.map(d =>
      `<span class="growth-leg"><i style="background:${SUBJ_COLORS[d]}"></i>${SUBJ_EMOJI[d] || ""}${d}</span>`).join("");
    return `<div class="growth-wrap"><svg viewBox="0 0 ${W} ${H}" class="growth-svg" role="img" aria-label="五向度逐週成長曲線">${grid}${lines}${endLabels}${xlabels}</svg><div class="growth-legend">${legend}</div></div>`;
  };

  // 預設開啟「最後一筆非作文批改」的報告（週報/期末總報告）；全部都是作文時才顯示作文。
  const defaultIdx = periods => {
    for (let i = periods.length - 1; i >= 0; i--) if (periods[i].reportType !== "作文批改") return i;
    return periods.length - 1;
  };

  // 🧪 我的創造提案（SPEC_創造提案線上版 §6）：草稿不進報告；每週與期末都顯示同一份（提案跨週進行）
  const PROPOSAL_COLOR = { "計畫審核中": "#F0932B", "計畫需修改": "#E67E22", "計畫不通過": "#8395A7", "試行中": "#54A0FF",
    "成果審核中": "#9B59B6", "延長試行": "#FF6B81", "成果通過": "#10AC84", "成果未通過": "#8395A7" };
  const proposalBox = (report, anon) => {
    const list = report.proposals || [];
    if (!list.length) return "";
    const row = (k, v) => v ? `<p style="white-space:pre-line"><strong>${k}：</strong>${App.esc(v)}</p>` : "";
    return `
        <div class="report-box" style="--bc:#8E44AD; margin-top:12px">
          <span class="report-badge" style="--bc:#8E44AD">🧪 我的創造提案</span>
          ${list.map(x => `
          <div class="proposal-report">
            <p><span class="badge" style="background:${PROPOSAL_COLOR[x.status] || "#8395A7"};color:#fff">${App.esc(x.status)}</span>
              <strong>${App.esc(x.name)}</strong>${x.type ? `　<span class="meta">${App.esc(x.type)}</span>` : ""}
              ${x.trial.length ? `<span class="meta">　試行 ${x.trial.map(d => App.esc(App.fmtDateShort(d))).join("～")}</span>` : ""}</p>
            ${row("問題", x.problem)}${row("點子", x.idea)}${row("成功標準", x.criteria)}
            ${x.achieve ? `<p><strong>成果：</strong>${App.esc(x.achieve)}${x.before || x.after ? `（試行前 ${App.esc(x.before || "—")} → 試行後 ${App.esc(x.after || "—")}）` : ""}</p>` : ""}
            ${row("反思", x.reflection)}
            ${row("老師對計畫的意見", x.planComment)}${row("老師的成果回饋", x.resultComment)}
            ${x.naming ? `<p>🏷️ <strong>獲頒命名權</strong>${x.namingName && !anon ? `：「${App.esc(x.namingName)}」` : ""}</p>` : ""}
          </div>`).join("")}
          ${anon ? "" : `<p class="meta no-print"><a href="proposal.html">✏️ 到「創造提案」頁繼續填寫或看進度</a></p>`}
        </div>`;
  };

  // 📊 學習總覽（儀表板）：放在報告單上方，只用報告物件既有欄位，不需新資料。
  // 只在「每週／期末」分類顯示；作文分類不顯示。列印時隱藏（報告單照舊印 A4）。
  const DASH_DIMS = ["國語", "數學", "社會", "人際互動", "生活技能"];
  const dashSpark = (vals, col, labels) => {
    const W = 200, H = 64, pad = 6, n = vals.length;
    if (n < 2) return "";
    const x = i => pad + i * (W - pad * 2) / (n - 1), y = v => H - pad - (Math.max(1, Math.min(5, v)) - 1) / 4 * (H - pad * 2);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="dash-spark" role="img" aria-label="逐週分數">
      <line x1="${pad}" x2="${W - pad}" y1="${y(3)}" y2="${y(3)}" stroke="#e6e2d6" stroke-dasharray="3 3"/>
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(n - 1)}" cy="${y(vals[n - 1])}" r="4" fill="${col}" stroke="#fff" stroke-width="2"/>
      ${vals.map((v, i) => `<rect x="${x(i) - 12}" y="0" width="24" height="${H}" fill="transparent"><title>第 ${App.esc(labels[i])} 週：${v} 分</title></rect>`).join("")}
    </svg>`;
  };
  const dashDelta = (now, prev) => {
    if (prev == null) return `<span class="dash-delta flat">—</span>`;
    const d = Math.floor((now - prev) * 10 + 0.5) / 10;
    if (d === 0) return `<span class="dash-delta flat">● 持平</span>`;
    return d > 0 ? `<span class="dash-delta up">▲ ${d} 比上週</span>` : `<span class="dash-delta down">▼ ${-d} 比上週</span>`;
  };
  const dashOverview = (report, periodIdx) => {
    const p = report.periods[periodIdx];
    if (p.reportType === "作文批改") return "";
    // 到「目前選的這一期」為止的每週列（往回看歷史週時，圖表也跟著停在那一週）
    const weeks = report.periods.slice(0, periodIdx + 1).filter(x => x.reportType === "每週" && x.radar);
    const cur = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
    const wk = x => (String(x.period).match(/第(.+?)週/) || [, "?"])[1];
    const essays = report.periods.filter(x => x.reportType === "作文批改");
    const lastEssay = essays[essays.length - 1];
    const hiN = App.lines(p.highlights).length, hiPrev = prev ? App.lines(prev.highlights).length : null;
    const fin = report.finance;
    const kpi = (icon, k, v, unit, note) => `
      <div class="dash-kpi"><div class="k">${icon} ${k}</div><div class="v">${v}<small> ${unit}</small></div>${note}</div>`;
    const kpis = [
      kpi("🌟", "本週亮點", hiN, "則", hiPrev == null ? "" : dashDelta(hiN, hiPrev)),
      fin ? kpi("🏦", "崑山幣存款", fin.balance, "幣", `<span class="dash-delta flat">儲蓄率 ${fin.savingsRate ?? "—"}%</span>`) : "",
      kpi("📝", "內容評量", App.esc(p.grades?.["內容評量"] || "—"), "", `<span class="dash-delta flat">作業 ${App.esc(p.grades?.["作業成績"] || "—")}・參與 ${App.esc(p.grades?.["上課參與"] || "—")}</span>`),
      lastEssay ? kpi("✍️", "最新作文", App.esc(lastEssay.essay.grade || "—"), "", `<span class="dash-delta flat">〈${App.esc(lastEssay.essay.title)}〉${App.esc(App.fmtDateShort(lastEssay.period))}</span>`) : "",
    ].join("");
    const multiples = cur ? DASH_DIMS.map(d => {
      const vals = weeks.map(w => w.radar[d] || 3);
      return `<div class="dash-sm"><div class="dash-sm-name"><i style="background:${SUBJ_COLORS[d]}"></i>${d}</div>
        <div class="dash-sm-now">${cur.radar[d]}</div>${dashDelta(cur.radar[d], prev?.radar[d])}
        ${dashSpark(vals, SUBJ_COLORS[d], weeks.map(wk))}</div>`;
    }).join("") : "";
    // 最近動態：最新在上，點了直接切到那一期
    const feed = report.periods.map((x, i) => ({ x, i })).reverse().slice(0, 5).map(({ x, i }) => {
      const t = x.reportType === "作文批改" ? `✍️ 作文〈${App.esc(x.essay.title)}〉${App.esc(x.essay.grade)}`
        : x.reportType === "期末總報告" ? "🌟 學期總報告" : `📊 第 ${App.esc(wk(x))} 週學習報告`;
      // 期末總報告的「期間」不一定含「第N週」，固定顯示「期末」
      const when = x.reportType === "作文批改" ? App.fmtDateShort(x.period) : x.reportType === "期末總報告" ? "期末" : `第${wk(x)}週`;
      return `<li${i === periodIdx ? ' class="on"' : ""}><span class="when">${App.esc(when)}</span><span>${t}</span>
        <button type="button" class="dash-go" data-i="${i}">${i === periodIdx ? "正在看" : "打開 →"}</button></li>`;
    }).join("");
    return `
      <section class="dash no-print" aria-label="學習總覽">
        <div class="dash-head"><h3>📊 學習總覽</h3><span class="meta">到 ${App.esc(p.period)} 為止・下方是本期完整報告</span></div>
        <div class="dash-kpis">${kpis}</div>
        <div class="dash-row">
          <div class="dash-card">
            <h4>五向度逐週變化 <small>1–5 分；滑過看每週分數</small></h4>
            <div class="dash-multiples">${multiples || '<p class="meta">累積 2 週以上才會出現趨勢圖。</p>'}</div>
          </div>
          <div class="dash-card">
            <h4>最近動態</h4>
            <ul class="dash-feed">${feed}</ul>
          </div>
        </div>
      </section>`;
  };

  // 📈 學習評量（DI 線 v3.1，老師 2026-11-07 定案；原 BT 線 📈 平時評量＋DG 線 📝 期中評量合併，期末考也在這裡）：
  // 資料是 sync 端算好的 report.evals（每學期一筆；規則正本 scripts/classos/lib/term-trail.mjs、term-quiz.mjs），前端只畫、不重算。
  // 只看孩子自己：不放全班平均、不排名。顏色＝教學 DS 國語／數學 accent、社會 accent-2（與數學藍拉開）。
  const QUIZ_SUBJ = [["國語", "#B23A2E"], ["數學", "#1F5FA8"], ["社會", "#6B4423"]];
  const EVAL_IDX = -1; // 學習評量不是一個期別，用 -1 代表這個分頁
  const md = iso => { const [, m, d] = String(iso).split("-"); return `${Number(m)}/${Number(d)}`; };
  // 📈 學習評量・頂端整學期軌跡（DI 線 v3.1）：四格表＋三科同一張折線，資料是 sync 端算好的 ev.trail（規則正本 term-trail.mjs）
  const evDl = (a, b) => a == null || b == null ? "" : b > a ? `<span class="ev-dl up">▲ ${b - a}</span>`
    : b < a ? `<span class="ev-dl down">▼ ${a - b}</span>` : `<span class="ev-dl">＝ 持平</span>`;
  const EV_STEPS = [["s1", "①", "期中前平時卷"], ["mid", "②", "期中考"], ["s3", "③", "期末前平時卷"], ["fin", "④", "期末考"]];
  function trailTable(ev, sel) {
    const head = `<tr><th class="s"></th>${EV_STEPS.map(([, n, t]) => `<th>${n}<br>${t}</th>`).join("")}</tr>`;
    const rows = QUIZ_SUBJ.map(([s, c]) => {
      const t = ev.trail.subjects[s];
      if (!t) return "";
      return `<tr style="--c:${c}"><td class="subj">${s}</td>${t.cells.map((v, i) => {
        const ex = i % 2 === 1, prev = t.cells.slice(0, i).filter(x => x != null).pop();
        return v == null ? `<td class="none${ex ? " exam" : ""}">—</td>`
          : `<td class="${ex ? "exam" : ""}${EV_STEPS[i][0] === sel ? " sel" : ""}"><b>${v}</b><br>${prev != null ? evDl(prev, v)
            : t.n[i] != null ? `<span class="quiz-muted">${t.n[i]} 份</span>` : ""}</td>`;
      }).join("")}</tr>`;
    }).join("");
    return `<table class="ev-trail">${head}${rows}</table>`;
  }
  function trailChart(ev) {
    const { s1, s3 } = ev.trail.slots, total = s1 + s3 + 2;
    const W = 460, H = 240, L = 30, R = 454, T = 28, B = 192;
    const X = i => L + 26 + (R - L - 52) * i / (total - 1);
    const Y = v => B - (B - T) * (Math.max(v, 40) - 40) / 60;
    const band = (a, b, t, f) => `<rect x="${X(a) - 22}" y="${T - 22}" width="${X(b) - X(a) + 44}" height="${B - T + 20}" rx="8" fill="${f}"/>
      <text x="${(X(a) + X(b)) / 2}" y="${T - 6}" text-anchor="middle" font-size="13" fill="#6b7280">${t}</text>`;
    const grid = [40, 60, 80, 100].map(v => `<line x1="${L}" x2="${R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eef0f3"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="#9ca3af">${v}</text>`).join("");
    const lines = QUIZ_SUBJ.map(([s, c]) => {
      const pts = ev.trail.subjects[s]?.points || [];
      if (!pts.length) return "";
      return `<path d="${pts.map((p, k) => `${k ? "L" : "M"}${X(p.slot)},${Y(p.score)}`).join("")}" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>`
        + pts.map(p => p.exam
          ? `<text x="${X(p.slot)}" y="${Y(p.score) + 8}" text-anchor="middle" font-size="22" fill="${c}"><title>${s} ${App.esc(p.name)} ${p.score}</title>★</text>`
          : `<circle cx="${X(p.slot)}" cy="${Y(p.score)}" r="5.5" fill="#fff" stroke="${c}" stroke-width="3"><title>${s} ${md(p.date)} ${App.esc(p.name)} ${p.score}</title></circle>`).join("");
    }).join("");
    const lab = i => i < s1 ? `第${i + 1}卷` : i === s1 ? "期中考" : i <= s1 + s3 ? `第${i - s1}卷` : "期末考";
    const fs = total > 8 ? 11 : 14;
    const xl = Array.from({ length: total }, (_, i) => `<text x="${X(i)}" y="${B + 22}" text-anchor="middle" font-size="${fs}" fill="#57606f">${lab(i)}</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="ev-chart" role="img" aria-label="國語、數學、社會整學期分數軌跡">
      ${band(0, s1 - 1, "期中前平時卷", "#f5f8ff")}${band(s1, s1, "期中考", "#fff3f3")}${band(s1 + 1, s1 + s3, "期末前平時卷", "#f5f8ff")}${band(total - 1, total - 1, "期末考", "#fff3f3")}
      ${grid}${lines}${xl}</svg>
      <div class="quiz-legend" style="justify-content:center">${QUIZ_SUBJ.map(([s, c]) => `<span><i style="background:${c}"></i>${s}</span>`).join("")}<span>● 平時卷　★ 期中考／期末考</span></div>`;
  }
  // 🔍 錯題分析與複習建議（BY 線，老師 2026-10-18 定案範本 ClassOS_v3.5_藍圖/觀念複習卡與錯題公開_範本.html）：
  // sync 端算好 ev.s1／ev.s3 的 analysis（規則正本 scripts/classos/lib/quiz-errors.mjs），前端只畫。
  // 錯題明細發布即公開、預設展開；正確答案（ans）與試卷連結開放日前 sync 根本不放，這裡只顯示鎖頭說明。
  // 每條建議與每道錯題連到「📚 觀念複習卡」（card；對不到卡＝null，不放連結）。
  const QUIZ_COLOR = Object.fromEntries(QUIZ_SUBJ);
  const httpsOnly = u => /^https:\/\//.test(String(u || "")) ? App.esc(u) : "";
  const cardOnly = u => /^review\.html\?s=[^"<>\s]+$/.test(String(u || "")) ? App.esc(u) : "";
  const cardLink = (u, text) => cardOnly(u) ? `<a href="${cardOnly(u)}" target="_blank" rel="noopener">${text}</a>` : "";
  const rateColor = r => r < 60 ? "#D63031" : r < 80 ? "#E67E22" : "#10AC84";
  // 2026-10-26 老師定案範本 v2 ClassOS_v3.5_藍圖/錯題分析依科目整理_範本.html：
  // 頂端「📌 先複習這幾個」（所有卷一起算，同科同知識點只看最新那份，取最低 3 個、只收 80% 以下）；
  // 科目分頁帶燈號（看最近一份卷最低知識點：<60 紅、<80 橘、其餘綠）與「N 項要加強」；同科新卷在上且預設展開，
  // 舊卷淡化收成一行；標題列「看詳細／收起」；要加強標籤直接連複習卡；長條只畫 80% 以下；複習建議最多 5 條、錯題預設展開。
  const bars = kp => `<div class="qa-kp">${kp.map(k => `<div class="qa-kn">${App.esc(k.name)}</div>
    <div class="qa-bar"><i style="width:${k.rate}%;background:${rateColor(k.rate)}"></i></div><div class="qa-pct">${k.rate}%</div>`).join("")}</div>`;
  const cardBtn = u => cardOnly(u) ? `<a class="qa-btn-card" href="${cardOnly(u)}" target="_blank" rel="noopener">👉 複習卡</a>` : "";
  // 知識點 → 複習卡：先找複習建議，再找同知識點的錯題
  const cardOf = (e, name) => [...(e.tips || []).filter(t => t.name === name), ...(e.wrong || []).filter(w => w.tag === name)]
    .map(x => x.card).find(cardOnly) || null;
  const byNewest = (a, b) => String(b.date).localeCompare(String(a.date));
  const QA_LIGHT = e => { const m = Math.min(...e.kp.map(k => k.rate)); return m < 60 ? "🔴" : m < 80 ? "🟠" : "🟢"; };
  function quizFocus(list) {
    const seen = new Map();
    [...list].sort(byNewest).forEach(e => e.kp.forEach(k => { const key = `${e.subject}|${k.name}`;
      if (!seen.has(key)) seen.set(key, { e, k }); }));
    const top = [...seen.values()].filter(x => x.k.rate < 80).sort((a, b) => a.k.rate - b.k.rate).slice(0, 3);
    if (!top.length) return `<div class="qa-focus"><h3>🎉 每份卷的知識點都在 80% 以上</h3>把錯的題目訂正一次就好。</div>`;
    return `<div class="qa-focus"><h3>📌 先複習這幾個</h3><ol>${top.map(({ e, k }, i) => `<li style="--c:${QUIZ_COLOR[e.subject] || "#6b7280"}">
      <span class="qa-num">${i + 1}</span><span class="qa-subj">${App.esc(e.subject)}</span><span>${App.esc(k.name)}</span><span class="qa-low">${k.rate}%</span><span class="quiz-muted">${App.esc(e.name)}</span>
      <span class="qa-go">${cardBtn(cardOf(e, k.name)) || `<span class="quiz-muted">看下方錯題訂正</span>`}</span></li>`).join("")}</ol></div>`;
  }
  // 一份卷的錯題分析卡（平時卷與 📝 期中評量共用）；prefix＝標題前綴（不給＝最新卷寫「最近一次・」）
  function qaExam(e, latest, prefix) {
    const weak = e.kp.filter(k => k.rate < 80).sort((a, b) => a.rate - b.rate);
    const fine = e.kp.filter(k => k.rate >= 80);
    const chips = weak.length ? weak.slice(0, 2).map(k => { const c = cardOnly(cardOf(e, k.name));
        return c ? `<a class="qa-chip link" href="${c}" target="_blank" rel="noopener">要加強：${App.esc(k.name)} ${k.rate}%</a>`
          : `<span class="qa-chip">要加強：${App.esc(k.name)} ${k.rate}%</span>`; }).join("")
      : `<span class="qa-chip ok">各知識點都很穩定 👍</span>`;
    const fineHtml = !fine.length ? "" : weak.length
      ? `<details class="qa-fine"><summary>✓ 其他 ${fine.length} 項都在 80% 以上（點開看）</summary>${bars(fine)}</details>` : bars(fine);
    const tips = e.tips.length ? `<ul class="qa-tips">${e.tips.map(t => `<li><b>💡 ${App.esc(t.name)}</b>：${App.esc(t.tip)}${t.card && cardOnly(t.card) ? `　${cardBtn(t.card)}` : ""}</li>`).join("")}</ul>`
      : `<div class="qa-tip">把錯的題目訂正一次就好。</div>`;
    const whole = e.review && httpsOnly(e.review.href)
      ? `<div class="quiz-muted">📖 <a href="${httpsOnly(e.review.href)}" target="_blank" rel="noopener">${App.esc(e.review.label || "整課觀念複習")}</a></div>` : "";
    const paper = e.unlocked && e.paper && httpsOnly(e.paper) ? `<div class="quiz-muted">📄 <a href="${httpsOnly(e.paper)}" target="_blank" rel="noopener">打開試卷</a></div>` : "";
    const lock = e.unlocked ? "" : `<div class="qa-lock">🔒 正確答案與試卷，${e.open ? `${md(e.open)}（解答開放日）起出現在這裡。` : "老師公布解答開放日後才會出現在這裡。"}</div>`;
    const showAns = e.unlocked && (e.wrong || []).some(w => "ans" in w);
    const wrong = !e.wrong?.length ? `<div class="qa-lock">這份卷全對，沒有錯題 🎉</div>${paper}`
      : `<details class="qa-wrong" open><summary>我錯的題目${showAns ? "與正確答案" : ""}（${e.wrong.length} 題）</summary>${paper}
        <div class="qa-tbl"><table class="quiz-table"><thead><tr><th>題目</th><th>知識點</th><th class="n">扣分</th>${showAns ? "<th>正確答案</th>" : ""}<th>複習</th></tr></thead><tbody>
        ${e.wrong.map(w => `<tr><td>${App.esc(w.label)}</td><td><span class="quiz-badge">${App.esc(w.tag)}</span></td><td class="n">−${w.lost}</td>${showAns ? `<td>${App.esc(w.ans ?? "")}</td>` : ""}<td>${cardLink(w.card, "卡片") || "—"}</td></tr>`).join("")}
        </tbody></table></div>${lock}</details>`;
    return `<details class="qa-exam${latest ? "" : " old"}" style="--c:${QUIZ_COLOR[e.subject] || "#6b7280"}"${latest ? " open" : ""}>
      <summary class="qa-h"><b>${prefix ?? (latest ? "最近一次・" : "")}${App.esc(e.name)}</b><span class="quiz-muted">${md(e.date)}</span><span><span class="qa-score">${e.score}</span> 分</span><span class="qa-toggle"></span><span class="qa-chips">${chips}</span></summary>
      <div class="qa-body">${weak.length ? bars(weak) : ""}${fineHtml}${tips}${whole}${wrong}</div></details>`;
  }
  function quizAnalysis(list) {
    if (!list?.length) return "";
    const one = qaExam;
    const known = QUIZ_SUBJ.map(([s]) => s);
    const subjects = [...known, ...new Set(list.map(e => e.subject).filter(s => !known.includes(s)))]
      .filter(s => list.some(e => e.subject === s));
    const bySubj = s => list.filter(e => e.subject === s).sort(byNewest);
    // 分頁：最近一卷分數＋比同科上一卷進退步；要加強（<80% 知識點）幾項＋比上一卷多／少幾項
    const weakN = e => e.kp.filter(k => k.rate < 80).length;
    const tabs = subjects.map((s, i) => { const [e, prev] = bySubj(s), n = weakN(e);
      const d = prev ? e.score - prev.score : null, dn = prev ? n - weakN(prev) : null;
      const delta = d === null ? `<span class="qa-dl">第 1 卷</span>` : d > 0 ? `<span class="qa-dl up">▲ ${d}</span>`
        : d < 0 ? `<span class="qa-dl down">▼ ${-d}</span>` : `<span class="qa-dl">＝ 持平</span>`;
      const weakDelta = !dn ? "" : dn < 0 ? `（比上次少 ${-dn} 項）` : `（比上次多 ${dn} 項）`;
      return `<button type="button" class="qa-tab" role="tab" style="--c:${QUIZ_COLOR[s] || "#6b7280"}" aria-selected="${i === 0}" data-qa-tab="${i}"><span class="qa-light">${QA_LIGHT(e)}</span>
        <span class="qa-tt"><span class="qa-t1">${App.esc(s)}<span class="qa-sc">最近 ${e.score} 分</span>${delta}</span><small>${n ? `要加強 ${n} 項` : "全部穩定"}${weakDelta}</small></span></button>`; }).join("");
    const panels = subjects.map((s, i) => `<div class="qa-panel" data-qa-panel="${i}"${i ? " hidden" : ""}>${bySubj(s).map((e, j) => one(e, j === 0)).join("")}</div>`).join("");
    return `<div class="report-box quiz-box" style="--bc:#E17055">
      <span class="report-badge" style="--bc:#E17055">🔍 錯題分析與複習建議</span>
      <p class="quiz-muted">每次平時卷改完，就會看到自己哪些地方要加強。只看自己，不放全班平均、不排名。</p>
      ${quizFocus(list)}
      <div class="qa-tabs" role="tablist">${tabs}</div>${panels}
      <details class="quiz-muted qa-howto"><summary>ⓘ 怎麼看這一區</summary>📌「先複習這幾個」＝三科所有平時卷裡得分率最低的知識點，最多 3 個（同一個知識點考過好幾次，看最近那一次）。分頁的燈：🔴 有知識點低於 60%、🟠 最低在 60–79%、🟢 全部 80% 以上（看該科最近一份卷）。分頁上的分數是該科最近一份卷，▲▼ 是比同科上一份卷多或少幾分（不同課的卷難度不同，當參考就好）；要加強＝得分率低於 80% 的知識點數。得分率＝這一類題目拿到的分數 ÷ 這一類的總分。複習建議依需要加強的程度排序，最多列 5 類。👉 複習卡＝這個觀念的重點、例題和自我檢查。錯的題目一發布就看得到；正確答案與試卷，到該卷自己的解答開放日才出現。</details>
    </div>`;
  }
  // 定期考版型（② 期中考／④ 期末考共用；DG 線 📝 期中評量定案範本延伸，DI 線 v3.1）：
  // 資料是 sync 端算好的 ev.mid／ev.fin（規則正本 scripts/classos/lib/midterm-report.mjs），前端只畫。
  // A 三科分數對照該段平時卷平均 → B 先複習這幾個 → C 平時卷錯過的觀念考試學會沒（依科目分組）→ D 各科錯題分析（沿用 qaExam）。
  // 🔁 依科目分組（老師 2026-11-07 v3.1）：每科小標＋學會 M／N＋進度條，✅ 在前；該科有錯題分析但沒有低於 80% 的觀念＝👍。
  // 該科沒有錯題分析（缺考、還在整理）＝不畫那一科，不可以說成 👍（U41）。
  function evGrowth(m) {
    const g = m.growth || [], name = App.esc(m.name);
    const withItem = QUIZ_SUBJ.filter(([s]) => m.subjects.some(x => x.subject === s && x.item));
    if (!withItem.length) return "";
    const okN = g.filter(x => x.ok).length;
    const blocks = withItem.map(([s, c]) => {
      const rows = g.filter(x => x.subject === s).sort((a, b) => (b.ok - a.ok) || (b.exam - a.exam));
      if (!rows.length) return `<div class="ev-g-sub" style="--c:${c}"><h4>${s}<small>平時卷沒有低於 80% 的知識點 👍</small></h4></div>`;
      const ok = rows.filter(x => x.ok).length;
      return `<div class="ev-g-sub" style="--c:${c}"><h4>${s}<small>${rows.length} 個知識點，學會 <b style="color:#047857">${ok}</b> 個</small></h4>
        <div class="ev-mini"><i style="width:${Math.floor(ok / rows.length * 100 + 0.5)}%"></i></div>
        <div class="ev-g-row head"><span>知識點</span><span class="n">平時卷</span><span class="n">${name}</span><span></span></div>
        ${rows.map(x => `<div class="ev-g-row"><span title="${App.esc(x.quizName)}">${App.esc(x.name)}</span><span class="n" style="color:${rateColor(x.quiz)}">${x.quiz}%</span>
          <span class="n" style="color:${rateColor(x.exam)};font-weight:700">${x.exam}%</span>
          ${x.ok ? `<span class="mg-tag ok">✅<i> 學會了</i></span>` : `<span class="mg-tag no">⚠️<i> 還要加強</i></span>`}</div>`).join("")}</div>`;
    }).join("");
    return `<div class="mid-growth"><h3>🔁 平時卷錯過的觀念，${name}學會了嗎？</h3>
      <p class="quiz-muted" style="margin:0 0 6px">${g.length ? `平時卷低於 80% 的 ${g.length} 個知識點，${name}有 <b style="color:#047857">${okN} 個</b> 到 80% 以上。` : "這段平時卷沒有低於 80% 的知識點 👍"}</p>
      ${blocks}</div>`;
  }
  function examStage(ev, k) {
    const m = ev[k], first = k === "mid", name = App.esc(m.name), subs = m.subjects;
    const byDate = {};
    subs.forEach(s => (byDate[s.date] = byDate[s.date] || []).push(s.subject));
    const dates = Object.keys(byDate).sort().map(d => `${byDate[d].join("、")} ${md(d)}`).join("，");
    const midScore = s => { const x = ev.mid?.subjects.find(y => y.subject === s); return x && !x.absent ? x.score : null; };
    const cards = subs.map(s => {
      const big = s.absent ? "缺考" : s.score ?? "—", ms = first ? null : midScore(s.subject);
      return `<div class="mid-card" style="--c:${QUIZ_COLOR[s.subject] || "#6b7280"}"><div class="s">${App.esc(s.subject)}</div>
        <div class="big">${big}${s.absent || s.score == null ? "" : "<small> 分</small>"}</div>
        <div class="vs">這段平時卷平均 ${s.quizAvg ?? "—"}${s.quizAvg != null ? " 分" : ""} ${evDl(s.quizAvg, s.score)}</div>
        ${!first && ms != null && s.score != null ? `<div class="vs">期中考 ${ms} → 期末考 ${s.score} ${evDl(ms, s.score)}</div>` : ""}</div>`;
    }).join("");
    const items = subs.filter(s => s.item).map(s => s.item);
    const weakAll = items.flatMap(e => e.kp.filter(k => k.rate < 80).map(k => ({ e, k }))).sort((a, b) => a.k.rate - b.k.rate).slice(0, 3);
    const focus = !items.length ? "" : !weakAll.length
      ? `<div class="qa-focus"><h3>🎉 每個知識點都在 80% 以上</h3>把錯的題目訂正一次就好。</div>`
      : `<div class="qa-focus"><h3>📌 先複習這幾個</h3><ol>${weakAll.map(({ e, k }, i) => `<li style="--c:${QUIZ_COLOR[e.subject] || "#6b7280"}">
        <span class="qa-num">${i + 1}</span><span class="qa-subj">${App.esc(e.subject)}</span><span>${App.esc(k.name)}</span><span class="qa-low">${k.rate}%</span>
        <span class="qa-go">${cardBtn(cardOf(e, k.name)) || `<span class="quiz-muted">看下方錯題訂正</span>`}</span></li>`).join("")}</ol></div>`;
    const weakN = e => e.kp.filter(k => k.rate < 80).length;
    const tabs = items.map((e, i) => `<button type="button" class="qa-tab" role="tab" style="--c:${QUIZ_COLOR[e.subject] || "#6b7280"}" aria-selected="${i === 0}" data-qa-tab="${i}"><span class="qa-light">${QA_LIGHT(e)}</span>
      <span class="qa-tt"><span class="qa-t1">${App.esc(e.subject)}<span class="qa-sc">${e.score} 分</span></span><small>${weakN(e) ? `要加強 ${weakN(e)} 項` : "全部穩定"}</small></span></button>`).join("");
    const panels = items.map((e, i) => `<div class="qa-panel" data-qa-panel="${i}"${i ? " hidden" : ""}>${qaExam(e, true, "")}</div>`).join("");
    return `
        <div class="report-box quiz-box" style="--bc:#E17055">
          <span class="report-badge" style="--bc:#E17055">${first ? "②" : "④"} ${App.esc(ev.term)} ${name}・錯題分析</span>
          <p class="quiz-muted">考試日：${App.esc(dates)}。只看自己，不放全班平均、不排名。</p>
          <div class="mid-scores">${cards}</div>
          ${focus}${evGrowth(m)}
          ${items.length ? `<div class="qa-tabs" role="tablist">${tabs}</div>${panels}` : `<p class="quiz-muted">錯題分析還在整理，整理好就會出現在這裡。</p>`}
          <details class="quiz-muted qa-howto"><summary>ⓘ 怎麼看這一段</summary>「這段平時卷平均」＝${name}前那一段每份平時卷的平均分（和平時卷段同一套算法）；▲▼ 是${name}比平時卷平均多或少幾分（題目範圍與難度不同，當參考就好）。得分率＝這一類題目拿到的分數 ÷ 這一類的總分。「平時卷 → ${name}」只列平時卷曾經低於 80% 的知識點（看考試前最近一份考到它的平時卷）：${name}到 80% 以上＝✅ 學會了。👉 複習卡＝這個觀念的重點、例題和自我檢查。錯的題目一發布就看得到；正確答案與試卷到解答開放日才出現。</details>
        </div>`;
  }
  // 科目分頁：報告是 innerHTML 重畫，所以掛在 document 上委派，只掛一次
  document.addEventListener("click", ev => {
    const b = ev.target.closest?.(".qa-tab"); if (!b) return;
    const box = b.closest(".quiz-box");
    box.querySelectorAll(".qa-tab").forEach(t => t.setAttribute("aria-selected", t === b));
    box.querySelectorAll(".qa-panel").forEach(p => { p.hidden = p.dataset.qaPanel !== b.dataset.qaTab; });
  });
  // A4 列印：三科全印、每份卷都展開
  window.addEventListener("beforeprint", () => document.querySelectorAll(".qa-exam, .qa-fine").forEach(d => { d.open = true; }));
  // 平時卷版型（① 期中前／③ 期末前共用；BT 線 📈 平時評量延伸，DI 線 v3.1）：各段走勢圖改由頂端整學期圖代替。
  function quizStage(ev, k) {
    const q = ev[k], first = k === "s1", exam = first ? "期中考" : "期末考";
    const kpi = ([s, c]) => {
      const v = q.subjects[s] || {}, done = (v.items || []).filter(x => !x.absent);
      const last = done[done.length - 1], prev = done[done.length - 2];
      return `<div class="quiz-kpi" style="--c:${c}"><div class="h">${s}</div>
        <div class="big">${v.avg ?? "—"}<small> 平均</small></div>
        <div class="s">${v.n ? `考了 ${v.n} 次・最近一次 ${v.latest} ${prev ? evDl(prev.score, last.score) : ""}` : "這段期間還沒有平時考"}${v.absent ? `・缺考 ${v.absent} 次（不計入）` : ""}</div>
        ${q.prevAvg && q.prevAvg[s] != null && v.avg != null ? `<div class="s">期中前平時卷平均 ${q.prevAvg[s]} → 現在 ${v.avg} ${evDl(q.prevAvg[s], v.avg)}</div>` : ""}</div>`;
    };
    const rows = items => items.map(it => `<tr><td>${md(it.date)}</td><td>${App.esc(it.name)}</td>
      <td class="n">${it.absent ? `缺考 <span class="quiz-badge">不計入</span>` : it.score}</td></tr>`).join("");
    const detail = ([s, c]) => {
      const v = q.subjects[s];
      return v?.items?.length ? `<div class="quiz-subj" style="color:${c}">${s}（平均 ${v.avg ?? "—"}）</div>
        <table class="quiz-table"><thead><tr><th>日期</th><th>評量</th><th class="n">分數</th></tr></thead><tbody>${rows(v.items)}</tbody></table>` : "";
    };
    return `
        <div class="report-box quiz-box" style="--bc:#54A0FF">
          <span class="report-badge" style="--bc:#54A0FF">${first ? "①" : "③"} ${first ? "期中前" : "期末前"}平時卷${ev.trail.state[k] === "now" ? "（進行中）" : ""}</span>
          <p class="quiz-muted">${md(q.from)}～${md(q.to)}</p>
          <div class="quiz-kpis">${QUIZ_SUBJ.map(kpi).join("")}</div>
          ${q.tip ? `<div class="quiz-tip">💡 複習建議：${App.esc(q.tip)}</div>` : ""}
        </div>
        ${quizAnalysis(q.analysis)}
        <div class="report-box quiz-box" style="--bc:#8395A7">
          <span class="report-badge" style="--bc:#8395A7">每次評量明細</span>
          ${QUIZ_SUBJ.map(detail).join("")}
          ${q.others?.length ? `<div class="quiz-subj" style="color:#6b7280">其他科目（參考，不算入平考）</div>
            <table class="quiz-table"><tbody>${q.others.map(o => `<tr><td>${md(o.date)}</td><td>${o.subject === "其他" ? App.esc(o.name) : `${App.esc(o.subject)}　${App.esc(o.name)}`}</td>
              <td class="n">${o.absent ? `缺考 <span class="quiz-badge">不計入</span>` : o.score}</td></tr>`).join("")}</tbody></table>` : ""}
        </div>
        <div class="report-box quiz-box" style="--bc:#10AC84">
          <span class="report-badge" style="--bc:#10AC84">平時成績怎麼算</span>
          <table class="quiz-calc">
            <tr><td>課堂表現（日常）</td><td>20%</td></tr>
            <tr><td>作業表現</td><td>10%</td></tr>
            <tr><td>平時考（＝上面國／數／社各科平均，四捨五入取整數，缺考不計入）</td><td>20%</td></tr>
            <tr><td><b>平時成績小計</b></td><td><b>50%</b></td></tr>
            <tr><td>定期評量（期中／期末考）</td><td>50%</td></tr>
          </table>
          <p class="quiz-muted">${exam}後老師確認平時考平均，才寫進學期成績；這裡顯示到目前為止已登記的平時考（老師登記後下次更新就會出現）。</p>
        </div>`;
  }
  // 📈 學習評量（DI 線 v3.1，老師 2026-11-07 定案；範本 ClassOS_v3.5_藍圖/學習軌跡_提案/範本_學習評量完整版_示意.html）：
  // 頂端整學期軌跡（每段都一樣）→ 四格階段列（打開停在最新那一段）→ 該段內容（平時卷版型／定期考版型）。只看自己。
  const EV_WHEN = { s1: "開學後第一份平時卷改完", mid: "期中考成績登記後", s3: "期中考後第一份平時卷改完", fin: "期末考成績登記後" };
  let evalStep = null; // 使用者點過的階段；切換分類或學生就回到最新那一段
  function evalSheet(report, seatText) {
    const ev = report.evals[report.evals.length - 1], st = ev.trail.state;
    const latest = EV_STEPS.map(([k]) => k).filter(k => st[k] !== "lock" && ev[k]).pop() || "s1";
    const sel = evalStep && st[evalStep] ? evalStep : latest;
    const [, n, t] = EV_STEPS.find(([k]) => k === sel);
    const steps = EV_STEPS.map(([k, sn, stt]) => `<button type="button" class="ev-step ${st[k]}${k === sel ? " sel" : ""}" data-ev-step="${k}">
      <span class="n">${sn}</span><span class="t">${stt}</span><span class="st">${st[k] === "lock" ? "🔒 還沒開始" : st[k] === "now" ? "● 進行中" : "✅ 完成"}</span></button>`).join("");
    const body = st[sel] === "lock" || !ev[sel]
      ? `<div class="report-box quiz-box" style="--bc:#9ca3af"><span class="report-badge" style="--bc:#9ca3af">${n} ${t}</span><div class="ev-lockbox"><b>🔒</b>${EV_WHEN[sel]}，就會出現在這裡。</div></div>`
      : sel === "s1" || sel === "s3" ? quizStage(ev, sel) : examStage(ev, sel);
    return `
      <div class="report-sheet report-quiz">
        <h2 class="report-title">📈 學習評量 📈</h2>
        <p class="quiz-sub">${App.esc(ev.term)}・座號 ${seatText}　｜　更新到${App.esc(ev.updated.label)}（${md(ev.updated.date)}）｜平時卷 → 期中考 → 平時卷 → 期末考</p>
        <div class="report-box quiz-box" style="--bc:#5F27CD">
          <span class="report-badge" style="--bc:#5F27CD">🧭 這學期的學習軌跡</span>
          ${trailTable(ev, sel)}
          <p class="quiz-muted">平時卷格＝那一段每份平時卷的平均；考試格＝期中考／期末考分數；▲▼＝比前一格多或少幾分；還沒考的格子先留「—」。藍框＝下面正在看的那一段。</p>
          ${trailChart(ev)}
          <p class="quiz-muted" style="text-align:center">只畫孩子自己的分數，不放全班平均、不排名。</p>
        </div>
        <div class="ev-steps no-print" role="tablist">${steps}</div>
        <p class="quiz-muted no-print" style="text-align:center">點上面的格子切換；打開時自動停在最新那一段，舊的內容隨時可以回頭看。</p>
        ${body}
      </div>`;
  }
  // 作品牆（週報「本週作品」與學期總結「學期作品牆」共用）
  const worksGrid = works => `
          <div class="work-grid">
            ${works.map(w => w.photos.map(u => `
            <figure class="work-item">
              ${typeof u === "string" ? `
              <a href="${App.esc(u)}" target="_blank" rel="noopener">
                <img class="work-img" src="${App.esc(workImg(u))}" alt="${App.esc(w.title)}" loading="lazy" />
              </a>` : `
              <a target="_blank" rel="noopener">
                <img class="work-img" data-enc="${App.esc(u.enc)}" data-k="${App.esc(u.k)}" data-iv="${App.esc(u.iv)}"
                     data-type="${App.esc(u.type)}" alt="${App.esc(w.title)}" />
              </a>`}
              <figcaption class="meta">
                ${w.subject ? `<span class="badge">${App.esc(w.subject)}</span> ` : ""}${App.esc(w.title)}
                ${w.caption ? `<br />${App.esc(w.caption)}` : ""}
              </figcaption>
            </figure>`).join("")).join("")}
          </div>`;
  // 🎓 學期總結（DI 線 v3.1）：原「期末總報告」搬過來再擴充。評量部分只看自己：不放全班平均、不排名、不放級距（裁定 5）。
  const LV_COLOR = { 優: "#047857", 甲: "#1F5FA8", 乙: "#B7791F", 丙: "#C05621", 丁: "#B03A2E" };
  const FOOT_KEYS = ["內容評量", "作業成績", "上課參與", "生活常規"];
  function termSheet(report, p, h) {
    const ev = (report.evals || []).find(e => String(p.period || "").includes(e.term));
    const keys = ev ? [ev.term, ev.termLabel] : [String(p.period || "").slice(0, 2)];
    const weeks = report.periods.filter(x => x.reportType === "每週" && keys.some(k => String(x.period).includes(k)));
    const wkOf = x => (String(x.period).match(/第(.+?)週/) || [, "?"])[1];
    const sm = ev?.summary;
    const box = (color, badge, inner) => `<div class="report-box quiz-box" style="--bc:${color}"><span class="report-badge" style="--bc:${color}">${badge}</span>${inner}</div>`;
    // 📈 評量軌跡：四格表＋各科一句話＋錯過的觀念學會幾個（各科 M／N）
    const verdict = l => l.verdict === "up" ? `<b style="color:#047857">進步 ${l.delta} 分</b>` : l.verdict === "down" ? `<b style="color:#B03A2E">少了 ${-l.delta} 分</b>` : l.verdict === "flat" ? "<b>保持穩定</b>" : "";
    const lines = sm ? sm.lines.map(l => { const [a, m, b, f] = l.cells.map(v => v ?? "—");
      return `<div style="--c:${QUIZ_COLOR[l.subject]}"><b style="color:${QUIZ_COLOR[l.subject]}">${l.subject}</b>：期中前平時卷平均 ${a} → 期中考 ${m} → 期末前平時卷平均 ${b} → 期末考 ${f}${verdict(l) ? `，${verdict(l)}` : ""}</div>`; }).join("") : "";
    const learned = sm ? sm.tracked.filter(x => x.ok).length : 0, left = sm ? sm.tracked.filter(x => !x.ok) : [];
    const growth = sm && sm.tracked.length ? `<div class="mid-growth"><h3>🔁 這學期錯過的觀念，學會了幾個？</h3>
      <div class="ev-meter"><i style="width:${Math.floor(learned / sm.tracked.length * 100 + 0.5)}%"></i></div>
      <p class="quiz-muted">平時卷低於 80% 的 ${sm.tracked.length} 個觀念，期中／期末考已經學會 <b style="color:#047857">${learned} 個</b>${left.length ? `，還有 ${left.length} 個（列在下面「寒假可以努力」）` : ""}。</p>
      <div class="ev-legend">${QUIZ_SUBJ.map(([s, c]) => `<span><b style="--lc:${c}">${s}</b> 學會 ${sm.bySubject[s].ok}／${sm.bySubject[s].n}</span>`).join("")}</div></div>` : "";
    const trail = !ev ? "" : box("#1F5FA8", "📈 這學期的評量軌跡", `${trailTable(ev, null)}${sm ? `<div class="ev-sum">${lines}</div>${growth}` : `<p class="quiz-muted">期末考成績登記後，這裡會出現各科一句話與觀念學會進度。</p>`}`);
    // 🗓️ 每週學習足跡：四項等第×每週＋好表現筆數（取代五向度逐週曲線，裁定 v3）
    const good = weeks.map(x => App.lines(x.highlights).length), gmax = Math.max(1, ...good);
    const strip = from => { const ws = weeks.slice(from, from + 10), pad = 10 - ws.length;
      const blank = `<span></span>`.repeat(pad);
      return `<div class="ev-strip"><span class="lab">週次</span>${ws.map(x => `<span class="h">${App.esc(wkOf(x))}</span>`).join("")}${blank}
        ${FOOT_KEYS.map(k => `<span class="lab">${k}</span>${ws.map(x => { const g = x.grades?.[k]; return `<span class="ev-cell g-${g ? App.esc(g) : "none"}">${g ? App.esc(g) : "—"}</span>`; }).join("")}${blank}`).join("")}
        <span class="lab">好表現</span>${ws.map((x, i) => `<span class="ev-bar" title="${good[from + i]} 則"><i style="height:${Math.floor(26 * good[from + i] / gmax + 0.5)}px"></i></span>`).join("")}${blank}</div>`; };
    const foot = weeks.length ? box("#1DD1A1", "🗓️ 每週學習足跡", `${Array.from({ length: Math.ceil(weeks.length / 10) }, (_, i) => strip(i * 10)).join("")}
      <p class="quiz-muted">格子＝那一週的等第（特優＞優＞甲＞乙）；綠色長條＝那一週老師記下的好表現（亮點）則數。</p>`) : "";
    // 🌱 品格與生活能力：開學初（最前 k 週平均）→ 學期末（最後 k 週平均），k＝min(3, 週數÷2)
    const selW = weeks.filter(x => x.sel), k = Math.min(3, Math.floor(selW.length / 2));
    const avgSel = (list, a) => Math.floor(list.reduce((s, x) => s + (x.sel[a] || 0), 0) / list.length * 10 + 0.5) / 10;
    const sel = k < 1 ? "" : box("#5F27CD", "🌱 品格與生活能力：開學初 → 學期末", `${Object.keys(selW[0].sel).map(a => {
      const s0 = avgSel(selW.slice(0, k), a), s1 = avgSel(selW.slice(-k), a), pc = v => (Math.max(1, Math.min(5, v)) - 1) / 4 * 100;
      const d = Math.floor((s1 - s0) * 10 + 0.5) / 10, lo = Math.min(pc(s0), pc(s1));
      return `<div class="ev-db"><span>${App.esc(a)}</span><div class="track"><span class="seg" style="left:${lo}%;width:${Math.abs(pc(s1) - pc(s0))}%"></span><span class="dot d0" style="left:${pc(s0)}%"></span><span class="dot d1" style="left:${pc(s1)}%"></span></div>
        <span style="color:${d > 0 ? "#047857" : d < 0 ? "#B03A2E" : "var(--ink-soft)"};font-weight:700">${d > 0 ? `↑${d}` : d < 0 ? `↓${-d}` : "＝"}</span></div>`; }).join("")}
      <p class="quiz-muted">○ 開學初（前 ${k} 週平均）　● 學期末（最後 ${k} 週平均）　滿分 5</p>`);
    const shown = (p.subjects || []).filter(s => s.state || s.advice);
    const subjects = shown.length ? `<span class="report-badge" style="--bc:#FF9F43">各科學期總評與建議</span>
        <div class="report-subjects">${shown.map(s => `
          <div class="report-subject" style="--sc:${SUBJ_COLORS[s.name] || "#54A0FF"}">
            <div class="head">${SUBJ_EMOJI[s.name] || "📘"} ${App.esc(s.name)}</div>
            ${s.state ? `<p><strong>狀態：</strong>${App.esc(s.state)}</p>` : ""}
            ${s.advice ? `<p><strong>建議：</strong>${App.esc(s.advice)}</p>` : ""}
          </div>`).join("")}</div>` : "";
    // 🏅 學期總成績：(期中考＋期末考)÷2 四捨五入換五等第（規則正本 term-trail.mjs），只給等第、不放級距（裁定 5、v3.1）
    const grades = !sm ? "" : box("#EE5253", "🏅 學期總成績", `<div class="ev-grades">${sm.grades.map(g => `<div style="--c:${QUIZ_COLOR[g.subject]}"><div class="h">${g.subject}</div>
        <span class="lv" style="--lc:${LV_COLOR[g.level] || "#9ca3af"}">${g.level || "—"}</span></div>`).join("")}</div>
      <div class="ev-legend">${[["優", "90 分以上"], ["甲", "80～89 分"], ["乙", "70～79 分"], ["丙", "60～69 分"], ["丁", "未滿 60 分"]].map(([g, t]) => `<span><b style="--lc:${LV_COLOR[g]}">${g}</b> ${t}</span>`).join("")}</div>
      <p class="quiz-muted">學期總成績＝（期中考＋期末考）÷ 2，四捨五入取整數後換成等第${sm.grades.some(g => !g.level) ? "；「—」＝有一次考試缺考或還沒登記，老師確認後再補" : ""}。</p>`);
    const works = box("#10AC84", "🎨 學期作品牆", (p.works || []).length ? worksGrid(p.works) : `<p class="work-empty meta">本學期作品陸續收錄中。</p>`);
    const hi = App.lines(p.growthHighlight).length ? box("#FECA57", "🌱 學期成長亮點", `<div class="recap-highlights">${App.lines(p.growthHighlight).map(x => `<span class="recap-chip">${App.esc(x)}</span>`).join("")}</div>`) : "";
    const itemOf = x => [ev?.fin, ev?.mid].map(e => e?.subjects.find(s => s.subject === x.subject)?.item).find(it => it && cardOf(it, x.name));
    const todo = left.length ? box("#54A0FF", "🎯 寒假可以努力的地方", `<p class="quiz-muted">這學期期中／期末考還沒到 80% 的觀念，寒假再複習一次：</p><ul class="ev-todo">${left.map(x => { const it = itemOf(x);
      return `<li><span class="mg-tag no">${App.esc(x.subject)}</span><b>${App.esc(x.name)}</b><span class="quiz-muted" style="margin:0">平時卷 ${x.quiz}% → 考試 ${x.exam}%</span>${it ? cardBtn(cardOf(it, x.name)) : ""}</li>`; }).join("")}</ul>`) : "";
    const tips = App.lines(p.parentTips).length ? box("#FF9F43", "🤝 家長協助建議", App.ul(p.parentTips)) : "";
    const goal = App.lines(p.nextGoal).length ? box("#54A0FF", "🚀 下學期目標", App.ul(p.nextGoal)) : "";
    return `
      <div class="report-sheet report-term report-quiz">
        <h2 class="report-title">🌟 ${App.esc(ev?.term || keys[0])} 學期總結 🌟</h2>
        <div class="report-top">
          <div class="report-id-card">
            ${h.avatar}
            <p><strong>姓名：</strong>${App.esc(h.displayName)}</p>
            <p><strong>座號：</strong>${h.seatText}</p>
            <p class="meta">${App.esc(p.period)}</p>
          </div>
          <div class="report-overview-card">
            <span class="report-badge" style="--bc:#5F27CD">📝 學期總評</span>
            ${App.lines(p.termComment).map(t => `<p>${App.esc(t)}</p>`).join("") || `<p class="meta">老師撰寫中。</p>`}
          </div>
        </div>
        ${trail}${foot}${sel}
        <div style="margin-top:12px">${subjects}</div>
        ${grades}${works}${hi}${todo}${tips}${goal}
        <p class="report-footnote">學期總結的評量部分只看孩子自己：不放全班平均、不排名、不放級距。${h.anon ? "本報告已去識別化。" : `本報告僅供 ${App.esc(h.displayName)} 的家長參考，請勿外傳。`}　${App.esc(c.schoolYear)} ${App.esc(c.className)}</p>
      </div>`;
  }
  const TERM_LOCK_IDX = -3; // 還沒有期末總報告時的 🎓 鎖定頁
  const termLockSheet = () => `
      <div class="report-sheet report-quiz">
        <h2 class="report-title">🎓 學期總結 🎓</h2>
        <div class="ev-lockbox"><b>🔒</b>學期結束、老師發布期末總報告後，就會出現在這裡：這學期的評量軌跡、每週學習足跡、品格與生活能力的變化、學期總成績、作品牆與寒假可以努力的地方。</div>
      </div>`;

  function showReport(report, periodIdx = defaultIdx(report.periods), anon = false) {
    document.body.classList.add("report-open");
    const hasEval = !!report.evals?.length;
    const isEval = periodIdx === EVAL_IDX && hasEval;
    const isTermLock = periodIdx === TERM_LOCK_IDX;
    if (periodIdx < 0 && !isEval && !isTermLock) periodIdx = defaultIdx(report.periods);
    const p = isEval || isTermLock ? {} : report.periods[periodIdx];
    const isTerm = p.reportType === "期末總報告";
    const isEssay = p.reportType === "作文批改";
    const displayName = anon ? maskName(report.name) : report.name;
    const seatText = anon ? "──" : App.esc(report.seat);
    const avatar = (!anon && report.avatar)
      ? `<img class="avatar-img" src="${report.avatar}" alt="頭貼" />`
      : `<div class="avatar">🧑‍🎓</div>`;

    // 先分類再選期別（2026-10-15 老師要求）；類內筆數多時用下拉選單，少時用按鈕。作文以「✍️ 題目」標示。
    // DI 線 v3.1（老師 2026-11-07）：📊 學習週報＝每週｜✍️ 作文｜📈 學習評量（report.evals，只有一頁）｜
    // 🎓 學期總結＝期末總報告（還沒發布＝淡色＋🔒，點了看鎖定說明）。
    const catOf = x => x.reportType === "作文批改" ? "essay" : x.reportType === "期末總報告" ? "term" : "week";
    const cat = isEval ? "eval" : isTermLock ? "term" : catOf(p);
    const periodIdxs = cat2 => report.periods.map((x, i) => catOf(x) === cat2 ? i : -1).filter(i => i >= 0);
    const idxs = cat2 => cat2 === "eval" ? (hasEval ? [EVAL_IDX] : [])
      : cat2 === "term" ? (periodIdxs("term").length ? periodIdxs("term") : [TERM_LOCK_IDX])
      : periodIdxs(cat2);
    const inCat = isEval || isTermLock ? [] : idxs(cat);
    const termLocked = !periodIdxs("term").length;
    const catCount = { week: periodIdxs("week").length, essay: periodIdxs("essay").length,
      eval: hasEval ? -1 : 0, term: periodIdxs("week").length || !termLocked ? -1 : 0 }; // -1＝顯示但不標筆數
    const tabLabel = x => x.reportType === "作文批改"
      ? `✍️ ${x.essay?.title || x.period}` : x.period;
    const catList = [["week", "📊 學習週報"], ["essay", "✍️ 作文"], ["eval", "📈 學習評量"], ["term", "🎓 學期總結"]].filter(([k]) => catCount[k]);
    const catTabs = catList.length >= 2
      ? `<div class="report-cats" role="tablist">${catList.map(([k, t]) => { const lock = k === "term" && termLocked;
          return `<button role="tab" aria-selected="${k === cat}" class="${k === cat ? "active" : ""}${lock ? " locked" : ""}" data-cat="${k}">${t}${lock ? " 🔒" : ""}${catCount[k] > 0 ? `<small>${catCount[k]}</small>` : ""}</button>`; }).join("")}</div>`
      : "";
    const periodPicker = catTabs + (inCat.length > 5
      ? `<select id="report-period">${inCat.map(i =>
          `<option value="${i}" ${i === periodIdx ? "selected" : ""}>${App.esc(tabLabel(report.periods[i]))}</option>`).join("")}</select>`
      : `<div class="report-tabs">${inCat.map(i =>
          `<button class="${i === periodIdx ? "active" : ""}" data-i="${i}">${App.esc(tabLabel(report.periods[i]))}</button>`).join("")}</div>`);

    const toolbar = `
      <div class="report-toolbar no-print">
        <div class="report-pickers">${periodPicker}</div>
        <div class="report-actions">
          <button id="report-anon" class="report-tool ${anon ? "on" : ""}">🕶️ 去識別化${anon ? "：開" : ""}</button>
          <button id="report-print" class="report-tool">🖨️ 列印報告</button>
          <button id="report-exit" class="report-exit">🔒 離開</button>
        </div>
      </div>
`;

    // ✍️ 作文批改報告（SPEC_作文批改 §8 D5）：與週報/期末結構完全不同，獨立一張版面。
    // 七個文字區塊照 essay-grading-batch PROMPT_v2.2 §4 的順序呈現；成績單由「項目｜等第｜建議」還原成表格。
    const essaySheet = () => {
      const e = p.essay || {};
      const block = (color, badge, text) => App.esc(String(text || "")).trim()
        ? `<div class="report-box" style="--bc:${color}; margin-top:12px">
             <span class="report-badge" style="--bc:${color}">${badge}</span>
             <p style="white-space:pre-line">${App.esc(text)}</p>
           </div>` : "";
      return `
      <div class="report-sheet report-essay">
        <h2 class="report-title">✍️ 作文批改報告 ✍️</h2>

        <div class="report-top">
          <div class="report-id-card">
            ${avatar}
            <p><strong>姓名：</strong>${App.esc(displayName)}</p>
            <p><strong>座號：</strong>${seatText}</p>
            <p class="meta">批改日期 ${App.esc(p.period)}</p>
          </div>
          <div class="report-overview-card">
            <span class="report-badge" style="--bc:#5F27CD">這一篇</span>
            <div class="report-grades" style="margin-top:8px">
              ${e.title ? `<div class="grade-chip" style="--gc:#5F27CD"><span class="k">題目</span><span class="v">${App.esc(e.title)}</span></div>` : ""}
              ${e.genre ? `<div class="grade-chip" style="--gc:#54A0FF"><span class="k">文體</span><span class="v">${App.esc(e.genre)}</span></div>` : ""}
              ${e.grade ? `<div class="grade-chip" style="--gc:#FF9F43"><span class="k">總評</span><span class="v">${App.esc(e.grade)}</span></div>` : ""}
            </div>
          </div>
        </div>

        ${block("#FECA57", "🌟 老師的開場", e.intro)}
        ${block("#EE5253", "🔍 一、抓漏任務", e.errorCheck)}
        ${block("#54A0FF", "📋 二、版面、字體與格式", e.formatCheck)}
        ${block("#10AC84", "🚀 三、寫作升級站", e.upgrade)}

        ${(e.scores || []).length ? `
        <div class="report-box" style="--bc:#FF9F43; margin-top:12px">
          <span class="report-badge" style="--bc:#FF9F43">🏆 四、閃亮亮成績單</span>
          <table class="essay-scores">
            <thead><tr><th>評分項目</th><th>等第</th><th>老師的建議</th></tr></thead>
            <tbody>${e.scores.map(c => `<tr><td>${App.esc(c[0] || "")}</td><td>${App.esc(c[1] || "")}</td><td>${App.esc(c[2] || "")}</td></tr>`).join("")}</tbody>
          </table>
        </div>` : ""}

        ${block("#5F27CD", "💬 老師的話", e.finalWords)}
        ${block("#10AC84", "✨ 老師的魔法潤飾（修改範文）", e.sample)}
        ${block("#8395A7", "📝 附錄：作文原文（AI 辨識手寫稿，以原稿為準）", e.original)}
        ${!anon && (e.photos || []).length ? `
        <div class="report-box essay-photos no-print" style="--bc:#8395A7">
          <span class="report-badge" style="--bc:#8395A7">📷 附錄：作文原稿照片（可對照上方原文）</span>
          <div class="work-grid">${e.photos.map((u, i) => `
            <figure class="work-item"><a target="_blank" rel="noopener">
              <img class="work-img" data-enc="${App.esc(u.enc)}" data-k="${App.esc(u.k)}" data-iv="${App.esc(u.iv)}"
                   data-type="${App.esc(u.type)}" alt="作文原稿第 ${i + 1} 頁" /></a>
              ${e.photos.length > 1 ? `<figcaption class="meta">第 ${i + 1} 頁</figcaption>` : ""}
            </figure>`).join("")}
          </div>
        </div>` : anon && (e.photos || []).length ? `
        <div class="report-box essay-photos no-print" style="--bc:#8395A7">
          <span class="report-badge" style="--bc:#8395A7">📷 附錄：作文原稿照片</span>
          <p class="meta">原稿照片上有手寫的姓名與座號，<strong>去識別化時不顯示</strong>（列印時也不印出）。按上方「🕶️ 去識別化：開」關閉後即可查看。</p>
        </div>` : ""}

        ${e.pdf ? `
        <p class="meta no-print" style="margin-top:12px">
          📄 <a href="${App.esc(e.pdf)}" target="_blank" rel="noopener">下載這篇的批改報告 PDF</a>
        </p>` : ""}

        <p class="report-footnote">${anon ? "本報告已去識別化。" : `本報告僅供 ${App.esc(displayName)} 的家長參考，請勿外傳。`}　${App.esc(c.schoolYear)} ${App.esc(c.className)}</p>
      </div>`;
    };

    main.innerHTML = toolbar + (isEval ? evalSheet(report, seatText) : isTermLock ? termLockSheet() : isEssay ? essaySheet()
      : isTerm ? termSheet(report, p, { avatar, displayName, seatText, anon }) : dashOverview(report, periodIdx) + `
      <div class="report-sheet${isTerm ? " report-term" : ""}">
        <h2 class="report-title">${isTerm ? "🌟 學期學習總報告 🌟" : "✨ 學生學習分析報告 ✨"}</h2>

        <div class="report-top">
          <div class="report-id-card">
            ${avatar}
            <p><strong>姓名：</strong>${App.esc(displayName)}</p>
            <p><strong>座號：</strong>${seatText}</p>
            <p class="meta">${App.esc(p.period)}</p>
            ${(c.showReportBalance !== false && report.finance)
              ? `<div class="report-finance">
                   <div class="fin-bal">🏦 存款 <strong>${report.finance.balance}</strong> 崑山幣</div>
                   ${report.finance.income > 0 ? `
                   <div class="fin-row"><span>收入 ${report.finance.income}</span><span>支出 ${report.finance.expense}</span></div>
                   <div class="fin-rate">💰 儲蓄率 <strong>${report.finance.savingsRate != null ? report.finance.savingsRate + "%" : "—"}</strong></div>
                   <div class="fin-note">${App.esc(financeNote(report.finance))}</div>` : ""}
                   ${xpBlock(report.finance)}
                 </div>`
              : ((c.showReportBalance !== false && report.balance != null)
                  ? `<p class="report-balance">🏦 班級存款 <strong>${report.balance}</strong> 崑山幣</p>` : "")}
          </div>
          <div class="report-overview-card">
            <span class="report-badge" style="--bc:#54A0FF">${isTerm ? "五向度逐週成長曲線" : "整體學習狀況概覽"}</span>
            <div class="report-overview${isTerm ? " report-overview-term" : ""}">
              ${isTerm ? growthChart(report.periods) : radarSVG(p.radar)}
              <div class="report-grades">
                ${Object.entries(p.grades).filter(([, v]) => v).map(([k, v]) => `
                  <div class="grade-chip" style="--gc:${GRADE_COLORS[k] || "#54A0FF"}">
                    <span class="k">${App.esc(k)}</span><span class="v">${App.esc(v)}</span>
                  </div>`).join("")}
              </div>
            </div>
          </div>
        </div>

        ${Object.values(p.grades).some(v => v) ? gradeGuide() : ""}

        ${(!isTerm && p.courseFocus) ? `
        <div class="report-box report-focus" style="--bc:#10AC84">
          <span class="report-badge" style="--bc:#10AC84">📚 本週課程重點（全班共同）</span>
          <div class="report-subjects report-focus-grid">
            ${["國語", "數學", "社會"].filter(s => p.courseFocus[s]).map(s => {
              // 「本週學〈…〉：重點…」→ 第一個冒號前粗體當標題（2026-10-02 範本定版）
              const t = String(p.courseFocus[s]), i = t.indexOf("：");
              return `
            <div class="report-subject" style="--sc:${SUBJ_COLORS[s]}">
              <div class="head">${SUBJ_EMOJI[s]} ${s}</div>
              ${i > 0 ? `<p><strong>${App.esc(t.slice(0, i))}</strong></p><p>${App.esc(t.slice(i + 1))}</p>` : `<p>${App.esc(t)}</p>`}
            </div>`;
            }).join("")}
          </div>
        </div>` : ""}

        <span class="report-badge" style="--bc:#FF9F43">${isTerm ? "各科學期總評與建議" : "各科詳細狀況與建議"}</span>
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

        ${(!isTerm && p.assess && window.AssessView) ? `<div style="margin-top:12px">${window.AssessView.parent(p.assess)}</div>` : ""}

        ${p.examSummary ? `
        <div class="report-box" style="--bc:#EE5253; margin-top:12px">
          <span class="report-badge" style="--bc:#EE5253">📊 ${isTerm ? "期末定期評量成績與全班級距" : "定期評量成績與全班級距"}</span>
          ${examChart(p.examSummary)}
        </div>` : ""}

        ${(isTerm && App.lines(p.termComment).length) ? `
        <div class="report-box" style="--bc:#5F27CD; margin-top:12px">
          <span class="report-badge" style="--bc:#5F27CD">📝 學期總評</span>
          ${App.lines(p.termComment).map(t => `<p>${App.esc(t)}</p>`).join("")}
        </div>` : ""}

        <div class="report-box work-box" style="--bc:#10AC84; margin-top:12px">
          <span class="report-badge" style="--bc:#10AC84">🎨 ${isTerm ? "學期作品牆" : "本週作品"}</span>
          ${(p.works || []).length ? worksGrid(p.works) : `
          <p class="work-empty meta">${isTerm ? "本學期作品陸續收錄中。" : "本週沒有新收錄的作品；老師上傳後會自動出現在這裡。"}</p>`}
        </div>

        ${proposalBox(report, anon)}

        <div class="report-bottom">
          ${isTerm ? `
          ${App.lines(p.growthHighlight).length ? `
          <div class="report-box" style="--bc:#FECA57">
            <span class="report-badge" style="--bc:#FECA57">🌱 學期成長亮點</span>
            <div class="recap-highlights">${App.lines(p.growthHighlight).map(h => `<span class="recap-chip">${App.esc(h)}</span>`).join("")}</div>
          </div>` : ""}
          ${App.lines(p.nextGoal).length ? `
          <div class="report-box" style="--bc:#54A0FF">
            <span class="report-badge" style="--bc:#54A0FF">🚀 下學期目標</span>
            ${App.ul(p.nextGoal)}
          </div>` : ""}
          ` : `
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
          `}
          ${(p.selNote || p.sel) ? `
          <div class="report-box" style="--bc:#5F27CD">
            <span class="report-badge" style="--bc:#5F27CD">🧠 SEL 觀察</span>
            ${p.sel ? `<div class="recap-highlights" style="margin-bottom:6px">${Object.entries(p.sel).map(([k, v]) => {
              const n = Math.max(1, Math.min(5, Math.round(v)));
              return `<span class="recap-chip">${App.esc(k)} ${"★".repeat(n)}${"☆".repeat(5 - n)}</span>`;
            }).join("")}</div>` : ""}
            ${p.selNote ? `<p style="white-space:pre-line">${App.esc(p.selNote)}</p>` : ""}
          </div>` : ""}
          ${App.lines(p.parentTips).length ? `
          <div class="report-box" style="--bc:#FF9F43">
            <span class="report-badge" style="--bc:#FF9F43">🤝 家長協助建議</span>
            ${App.ul(p.parentTips)}
          </div>` : ""}
        </div>
        <p class="report-footnote">${anon ? "本報告已去識別化。" : `本報告僅供 ${App.esc(displayName)} 的家長參考，請勿外傳。`}　${App.esc(c.schoolYear)} ${App.esc(c.className)}</p>
      </div>`);

    hydrateWorks(main);
    main.querySelectorAll(".report-tabs button").forEach(b =>
      b.onclick = () => showReport(report, Number(b.dataset.i), anon));
    main.querySelectorAll(".dash-go").forEach(b => b.onclick = () => showReport(report, Number(b.dataset.i), anon));
    // 切換分類＝開該類最新一筆
    main.querySelectorAll(".report-cats button").forEach(b =>
      b.onclick = () => { const l = idxs(b.dataset.cat); evalStep = null; if (l.length) showReport(report, l[l.length - 1], anon); });
    main.querySelectorAll(".ev-step").forEach(b => b.onclick = () => { evalStep = b.dataset.evStep; showReport(report, EVAL_IDX, anon); });
    const sel = document.getElementById("report-period");
    if (sel) sel.onchange = () => showReport(report, Number(sel.value), anon);
    document.getElementById("report-anon").onclick = () => showReport(report, periodIdx, !anon);
    document.getElementById("report-print").onclick = () => window.print();
    document.getElementById("report-exit").onclick = () => showForm();
  }

  showForm();
})();
