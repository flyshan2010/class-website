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

  // 📈 平時評量分頁（BT 線，老師 2026-10-17 定案；版面照「平時評量分頁範本」）：
  // 資料是 sync 端算好的 report.quiz（規則正本 scripts/classos/lib/term-quiz.mjs），前端只畫、不重算。
  // 只看孩子自己：不放全班平均、不排名。顏色＝教學 DS 國語／數學 accent、社會 accent-2（與數學藍拉開）。
  const QUIZ_SUBJ = [["國語", "#B23A2E"], ["數學", "#1F5FA8"], ["社會", "#6B4423"]];
  const QUIZ_IDX = -1; // 平時評量不是一個期別，用 -1 代表這個分頁
  const md = iso => { const [, m, d] = String(iso).split("-"); return `${Number(m)}/${Number(d)}`; };
  function quizChart(q) {
    const pts = QUIZ_SUBJ.map(([s, c]) => ({ s, c, items: (q.subjects[s]?.items || []).filter(x => !x.absent) }));
    const dates = [...new Set(pts.flatMap(p => p.items.map(x => x.date)))].sort();
    if (!dates.length) return "";
    const all = pts.flatMap(p => p.items.map(x => x.score));
    const lo = Math.min(60, Math.floor(Math.min(...all) / 10) * 10);
    const W = 640, H = 260, L = 40, R = 610, T = 20, B = 220;
    const x = d => dates.length === 1 ? (L + R) / 2 : L + 20 + (R - L - 40) * dates.indexOf(d) / (dates.length - 1);
    const y = v => B - (B - T) * (v - lo) / (100 - lo);
    const ticks = []; for (let v = lo; v <= 100; v += 10) ticks.push(v);
    const every = Math.ceil(dates.length / 8);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="國語、數學、社會平時考分數折線圖" class="quiz-chart">
      ${ticks.map(v => `<line x1="${L}" y1="${y(v)}" x2="${R + 15}" y2="${y(v)}" stroke="#eef0f3"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#6b7280">${v}</text>`).join("")}
      ${dates.map((d, i) => i % every ? "" : `<text x="${x(d)}" y="${B + 24}" text-anchor="middle" font-size="11" fill="#6b7280">${md(d)}</text>`).join("")}
      ${pts.map(p => p.items.length ? `
        <polyline fill="none" stroke="${p.c}" stroke-width="2.5" points="${p.items.map(it => `${x(it.date)},${y(it.score)}`).join(" ")}"/>
        ${p.items.map(it => `<circle cx="${x(it.date)}" cy="${y(it.score)}" r="4" fill="${p.c}"><title>${App.esc(p.s)} ${md(it.date)} ${App.esc(it.name)} ${it.score}</title></circle>`).join("")}` : "").join("")}
    </svg>
    <div class="quiz-legend">${QUIZ_SUBJ.map(([s, c]) => `<span><i style="background:${c}"></i>${s}</span>`).join("")}</div>`;
  }
  function quizSheet(report, seatText) {
    const q = report.quiz;
    const trend = t => !t ? `<span class="quiz-flat">還不到 2 次，先看不出走勢</span>`
      : `近 ${t.k} 次比前 ${t.k} 次 ${t.delta >= 3 ? `<span class="quiz-up">▲ ${t.delta}</span>` : t.delta <= -3 ? `<span class="quiz-down">▼ ${Math.abs(t.delta)}</span>` : `<span class="quiz-flat">— ${Math.abs(t.delta)}</span>`}`;
    const kpi = ([s, c]) => {
      const v = q.subjects[s] || {};
      return `<div class="quiz-kpi" style="--c:${c}"><div class="h">${s}</div>
        <div class="big">${v.avg ?? "—"}</div>
        <div class="s">${v.n ? `考了 ${v.n} 次・最近一次 ${v.latest}` : "這段期間還沒有平時考"}${v.absent ? `・缺考 ${v.absent} 次（不計入）` : ""}</div>
        <div class="s">${v.n ? trend(v.trend) : ""}</div></div>`;
    };
    const rows = items => items.map(it => `<tr><td>${md(it.date)}</td><td>${App.esc(it.name)}</td>
      <td class="n">${it.absent ? `缺考 <span class="quiz-badge">不計入</span>` : it.score}</td></tr>`).join("");
    const detail = ([s, c]) => {
      const v = q.subjects[s];
      return v?.items?.length ? `<div class="quiz-subj" style="color:${c}">${s}（平均 ${v.avg ?? "—"}）</div>
        <table class="quiz-table"><thead><tr><th>日期</th><th>評量</th><th class="n">分數</th></tr></thead><tbody>${rows(v.items)}</tbody></table>` : "";
    };
    const exam = q.stage === "期末" ? "期末考" : "期中考";
    return `
      <div class="report-sheet report-quiz">
        <h2 class="report-title">📈 平時評量表現 📈</h2>
        <p class="quiz-sub">${App.esc(q.term)}・${exam}前（${md(q.from)}～${md(q.to)}）・座號 ${seatText}　｜　更新到${App.esc(q.updated.label)}（${md(q.updated.date)}）</p>
        <div class="quiz-kpis">${QUIZ_SUBJ.map(kpi).join("")}</div>
        ${q.prevAvg ? `<p class="quiz-muted">期中考前平時考平均：${QUIZ_SUBJ.map(([s]) => `${s} ${q.prevAvg[s] ?? "—"}`).join("／")}</p>` : ""}

        <div class="report-box quiz-box" style="--bc:#54A0FF">
          <span class="report-badge" style="--bc:#54A0FF">各科分數走勢（每個點是一次平時考）</span>
          ${quizChart(q)}
          ${q.tip ? `<div class="quiz-tip">💡 複習建議：${App.esc(q.tip)}</div>` : ""}
          <p class="quiz-muted">只看孩子自己的進步，不放全班平均、不排名。</p>
        </div>

        <div class="report-box quiz-box" style="--bc:#8395A7">
          <span class="report-badge" style="--bc:#8395A7">每次評量明細</span>
          ${QUIZ_SUBJ.map(detail).join("")}
          ${q.others?.length ? `<div class="quiz-subj" style="color:#6b7280">其他科目（參考，不算入平考）</div>
            <table class="quiz-table"><tbody>${q.others.map(o => `<tr><td>${md(o.date)}</td><td>${App.esc(o.subject)}　${App.esc(o.name)}</td>
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
          <p class="quiz-muted">${exam}後老師確認平時考平均，才寫進學期成績；這裡只顯示到目前為止、已發布週次的平時考。</p>
        </div>
      </div>`;
  }

  function showReport(report, periodIdx = defaultIdx(report.periods), anon = false) {
    document.body.classList.add("report-open");
    const isQuiz = periodIdx === QUIZ_IDX && !!report.quiz;
    if (periodIdx === QUIZ_IDX && !isQuiz) periodIdx = defaultIdx(report.periods);
    const p = isQuiz ? {} : report.periods[periodIdx];
    const isTerm = p.reportType === "期末總報告";
    const isEssay = p.reportType === "作文批改";
    const displayName = anon ? maskName(report.name) : report.name;
    const seatText = anon ? "──" : App.esc(report.seat);
    const avatar = (!anon && report.avatar)
      ? `<img class="avatar-img" src="${report.avatar}" alt="頭貼" />`
      : `<div class="avatar">🧑‍🎓</div>`;

    // 先分類再選期別（2026-10-15 老師要求）：「📊 學習報告」＝每週＋期末總報告、「✍️ 作文」＝作文批改。
    // 兩類都有才顯示分類鈕；類內筆數多時用下拉選單，少時用按鈕。作文以「✍️ 題目」標示。
    // 2026-10-17 加第三類「📈 平時評量」（report.quiz，不是期別、只有一頁）。
    const catOf = x => x.reportType === "作文批改" ? "essay" : "report";
    const cat = isQuiz ? "quiz" : catOf(p);
    const idxs = cat2 => cat2 === "quiz" ? (report.quiz ? [QUIZ_IDX] : [])
      : report.periods.map((x, i) => catOf(x) === cat2 ? i : -1).filter(i => i >= 0);
    const inCat = isQuiz ? [] : idxs(cat);
    const quizN = report.quiz ? QUIZ_SUBJ.reduce((a, [s]) => a + (report.quiz.subjects[s]?.items?.length || 0), 0) : 0;
    const catCount = { report: idxs("report").length, essay: idxs("essay").length, quiz: quizN };
    const tabLabel = x => x.reportType === "作文批改"
      ? `✍️ ${x.essay?.title || x.period}` : x.period;
    const catList = [["report", "📊 學習報告"], ["essay", "✍️ 作文"], ["quiz", "📈 平時評量"]].filter(([k]) => catCount[k]);
    const catTabs = catList.length >= 2
      ? `<div class="report-cats" role="tablist">${catList.map(([k, t]) =>
          `<button role="tab" aria-selected="${k === cat}" class="${k === cat ? "active" : ""}" data-cat="${k}">${t}<small>${catCount[k]}</small></button>`).join("")}</div>`
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

    main.innerHTML = toolbar + (isQuiz ? quizSheet(report, seatText) : isEssay ? essaySheet() : dashOverview(report, periodIdx) + `
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
          ${(p.works || []).length ? `
          <div class="work-grid">
            ${p.works.map(w => w.photos.map(u => `
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
          </div>` : `
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
      b.onclick = () => { const l = idxs(b.dataset.cat); if (l.length) showReport(report, l[l.length - 1], anon); });
    const sel = document.getElementById("report-period");
    if (sel) sel.onchange = () => showReport(report, Number(sel.value), anon);
    document.getElementById("report-anon").onclick = () => showReport(report, periodIdx, !anon);
    document.getElementById("report-print").onclick = () => window.print();
    document.getElementById("report-exit").onclick = () => showForm();
  }

  showForm();
})();
