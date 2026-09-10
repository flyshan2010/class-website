/* 教師專區：口令驗證 → 一句話輸入／快速鍵／檔案上傳／任務狀態／一鍵更新班網
 * 資安：口令只存 sessionStorage、每次請求放 POST body；禁止進 URL query。
 * 後端＝Apps Script 代理 v2（scripts/apps-script-proxy-v2.gs），網址取自 site-config.updateProxyUrl。 */
(async () => {
  const c = await App.init("teacher");
  const main = document.getElementById("main");

  if (!c.updateProxyUrl) {
    main.innerHTML = `<section class="card"><h2>🧑‍🏫 教師專區</h2>
      <p class="empty-hint">尚未設定代理網址：請在 Notion「⚙️ 網站設定」新增「一鍵更新網址」並同步班網。</p></section>`;
    return;
  }

  // ---------- 共用：POST 呼叫代理（text/plain 避免 CORS preflight） ----------
  const api = async (action, params = {}) => {
    const pw = sessionStorage.getItem("teacherPw") || "";
    const res = await fetch(c.updateProxyUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, pw, ...params }),
    });
    return res.json();
  };

  // ---------- 口令閘（錯 3 次前端鎖 10 分；資安底線在代理端驗證） ----------
  const LOCK_KEY = "teacherLock";
  const lockInfo = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || {}; } catch { return {}; } };
  const locked = () => (lockInfo().until || 0) > Date.now();
  const recordFail = () => {
    const info = lockInfo();
    info.fails = (info.fails || 0) + 1;
    if (info.fails >= 3) { info.until = Date.now() + 10 * 60 * 1000; info.fails = 0; }
    localStorage.setItem(LOCK_KEY, JSON.stringify(info));
  };
  const clearFails = () => localStorage.removeItem(LOCK_KEY);

  const renderLogin = (msg = "") => {
    main.innerHTML = `
      <section class="card" style="max-width:420px;margin:24px auto">
        <h2>🧑‍🏫 教師專區</h2>
        <p class="meta">本頁僅供老師使用，請輸入口令。</p>
        <input id="pw-input" type="password" autocomplete="current-password" placeholder="口令"
               style="width:100%;padding:10px;font-size:1.1em;border:1px solid #ccc;border-radius:8px" />
        <button id="pw-btn" class="emotion-draw" style="margin-top:10px;width:100%">進入</button>
        <p class="meta" id="pw-msg" style="color:#c0392b">${App.esc(msg)}</p>
      </section>`;
    const input = document.getElementById("pw-input");
    const tryLogin = async () => {
      if (locked()) {
        const min = Math.ceil((lockInfo().until - Date.now()) / 60000);
        document.getElementById("pw-msg").textContent = `嘗試次數過多，請 ${min} 分鐘後再試。`;
        return;
      }
      const pw = input.value.trim();
      if (!pw) return;
      document.getElementById("pw-msg").textContent = "驗證中…";
      sessionStorage.setItem("teacherPw", pw);
      const res = await api("list_tasks", { limit: 1 }).catch(() => ({ ok: false, error: "連線失敗" }));
      if (res.ok) { clearFails(); renderPanel(); }
      else {
        sessionStorage.removeItem("teacherPw");
        if ((res.error || "").includes("口令")) recordFail();
        renderLogin(res.error || "驗證失敗，請再試一次");
      }
    };
    document.getElementById("pw-btn").addEventListener("click", tryLogin);
    input.addEventListener("keydown", e => { if (e.key === "Enter") tryLogin(); });
    input.focus();
  };

  // ---------- 主面板 ----------
  let attachments = []; // 已上傳待附掛的檔案連結

  const renderPanel = async () => {
    let quickKeys = [];
    try { quickKeys = (await App.fetchJSON("data/quick-keys.json")).keys || []; } catch {}

    // 左側快速鍵（同首頁 module-card 圖例）：前兩個開外部工具，其餘捲動到本頁區塊
    const MENU = [
      { icon: "🖥️", label: "班級工作台", href: "https://crimson-wind-7a22.changsheng0612.workers.dev/", color: "#5F27CD", ext: true },
      { icon: "🚀", label: "教學駕駛艙", href: "cockpit.html", color: "#54A0FF" },
      { icon: "🌅", label: "Morning Launch", href: "morning-launch.html", color: "#FF9F43" },
      { icon: "💬", label: "一句話交辦", href: "#sec-task", color: "#FF9F43" },
      { icon: "📋", label: "任務狀態", href: "#sec-status", color: "#48DBFB" },
      { icon: "🛒", label: "兌換申請", href: "#sec-redeem", color: "#F0932B" },
      { icon: "🎟️", label: "兌換券執行", href: "#sec-priv", color: "#9B59B6" },
      { icon: "🧪", label: "提案審核", href: "#sec-proposal", color: "#8E44AD" },
      { icon: "⚡", label: "班網維護", href: "#sec-site", color: "#10ac84" },
    ];

    main.innerHTML = `
      <div class="teacher-layout">
      <aside class="side-menu" aria-label="教師功能選單">
        ${MENU.map(m => `
          <a class="module-card" href="${m.href}" style="--mc:${m.color}"${m.ext ? ' target="_blank" rel="noopener"' : ""}>
            <span class="icon">${m.icon}</span>
            <span class="label">${m.label}</span>
          </a>`).join("")}
      </aside>
      <div class="teacher-main">

      <section class="card" id="sec-task" style="--accent:#FF9F43">
        <h2>💬 一句話交辦</h2>
        <p class="meta">寫一句話（例：「座號12 數學小考粗心 -1」），系統約 30 分內處理；也可先按快速鍵帶入範本。</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">
          ${quickKeys.map((k, i) => `<button class="badge qk-btn" data-i="${i}" style="cursor:pointer;border:none;font-size:.95em;padding:6px 10px">${App.esc(k.label)}</button>`).join("")}
        </div>
        <textarea id="task-text" rows="3" placeholder="請輸入要交辦的一句話…"
          style="width:100%;padding:10px;font-size:1.1em;border:1px solid #ccc;border-radius:8px"></textarea>
        <div id="attach-list" class="meta"></div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <label class="emotion-draw" style="margin:0;cursor:pointer">📷 附加照片／檔案
            <input id="file-input" type="file" accept="image/*,.pdf" multiple style="display:none" />
          </label>
          <button id="task-send" class="emotion-draw" style="margin:0">🚀 送出任務</button>
        </div>
        <p class="meta" id="task-msg"></p>
      </section>

      <section class="card" id="sec-status" style="--accent:#48DBFB">
        <h2>📋 任務狀態（最近 20 筆）</h2>
        <p class="meta">「待審」項目請點進 Notion 檢查後勾發布。</p>
        <div id="task-list"><p class="empty-hint">載入中…</p></div>
        <button id="task-refresh" class="emotion-draw" style="margin-top:8px">🔄 重新整理</button>
      </section>

      <section class="card" id="sec-redeem" style="--accent:#F0932B">
        <h2>🛒 兌換申請</h2>
        <p class="meta">學生在小小銀行送出的商店兌換申請。核可＝自動扣崑山幣＋商店庫存−1；處理完按「立即更新班網」，存摺與庫存才會更新到站上。</p>
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <button id="rd-tab-pending" class="emotion-draw" style="margin:0;width:auto;padding:8px 18px">🕐 待處理</button>
          <button id="rd-tab-all" class="emotion-draw" style="margin:0;width:auto;padding:8px 18px;opacity:.75">📜 購買明細（最近 50 筆）</button>
        </div>
        <div id="redeem-list"><p class="empty-hint">載入中…</p></div>
        <p class="meta">完整明細與搜尋請開 <a href="https://app.notion.com/p/c482ee9f57e549d09993a0c173fe9fb0" target="_blank" rel="noopener">Notion「🛒 兌換申請」</a>。</p>
      </section>

      <section class="card" id="sec-priv" style="--accent:#9B59B6">
        <h2>🎟️ 兌換券執行</h2>
        <p class="meta">學生換到的券全在這裡——特權券與文具／食物兌換券都算。學生要用時按「✅ 使用一次」扣掉次數；
          扣完自動移出清單。按錯了按「↩️ 撤銷」還原；不執行也不退幣按「🚫 作廢」；<strong>要把幣還給學生按「💰 退費」</strong>
          （幣立刻回到帳本、庫存加回、券收回）。<strong>這裡即時生效</strong>，學生存摺要等按「立即更新班網」才會更新。</p>
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center">
          <button id="pv-tab-holding" class="emotion-draw" style="margin:0;width:auto;padding:8px 18px">🎟️ 持有中</button>
          <button id="pv-tab-history" class="emotion-draw" style="margin:0;width:auto;padding:8px 18px;opacity:.75">📜 使用歷史</button>
          <input id="pv-filter" type="number" min="1" max="99" placeholder="座號篩選"
                 style="width:110px;padding:8px;border:1px solid #ccc;border-radius:8px" />
          <button id="pv-refresh" class="emotion-draw" style="margin:0;width:auto;padding:8px 18px">🔄 重新整理</button>
        </div>
        <div id="priv-list"><p class="empty-hint">載入中…</p></div>
      </section>

      <section class="card" id="sec-proposal" style="--accent:#8E44AD">
        <h2>🧪 提案審核</h2>
        <p class="meta">學生在班網「🧪 創造提案」線上填的計畫書（表一）與成果回報單（表二）。
          <strong>計畫通過＝帳本獎勵金 +10</strong>（XP 與幣一起）、<strong>成果通過＝+20 並自動頒 🏷️ 命名權券</strong>；同一件不會重複發。
          「修改／不通過／延長／未通過」要寫理由，學生在提案頁看得到。<strong>這裡即時生效</strong>；存摺、報告要按「立即更新班網」才更新。</p>
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <button id="pp-tab-review" class="emotion-draw" style="margin:0;width:auto;padding:8px 18px">🔔 待審核</button>
          <button id="pp-tab-all" class="emotion-draw" style="margin:0;width:auto;padding:8px 18px;opacity:.75">📜 本學年全部</button>
          <button id="pp-refresh" class="emotion-draw" style="margin:0;width:auto;padding:8px 18px">🔄 重新整理</button>
        </div>
        <div id="proposal-list"><p class="empty-hint">載入中…</p></div>
        <p class="meta">系統只記流程、不判品質——成果好不好由你決定。完整資料在
          <a href="https://app.notion.com/p/6c81bf751d4f402bb3421b81726d64ba" target="_blank" rel="noopener">Notion「🧪 創造提案」</a>。</p>
      </section>

      <section class="card" id="sec-site" style="--accent:#10ac84">
        <h2>⚡ 班網維護</h2>
        <button id="site-update" class="emotion-draw">🔄 立即更新班網</button>
        <p class="meta" id="site-update-msg"></p>
        <p class="meta" style="margin-top:6px"><a href="#" id="logout">登出教師專區</a></p>
      </section>

      </div>
      </div>`;

    // 快速鍵：帶入範本，游標停在「＿」處
    const ta = document.getElementById("task-text");
    document.querySelectorAll(".qk-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const k = quickKeys[Number(btn.dataset.i)];
        ta.value = k.text;
        ta.focus();
        const pos = k.text.indexOf("＿");
        if (pos >= 0) ta.setSelectionRange(pos, pos + 1);
        document.getElementById("task-msg").textContent = k.hint || "";
      });
    });

    // 檔案上傳（base64 → 代理 → Drive；上限 10MB/檔）
    const renderAttach = () => {
      document.getElementById("attach-list").innerHTML = attachments.length
        ? "已附加：" + attachments.map((a, i) => `${App.esc(a.name)} <a href="#" data-i="${i}" class="attach-del">✕</a>`).join("、")
        : "";
      document.querySelectorAll(".attach-del").forEach(x => x.addEventListener("click", e => {
        e.preventDefault();
        attachments.splice(Number(x.dataset.i), 1);
        renderAttach();
      }));
    };
    document.getElementById("file-input").addEventListener("change", async e => {
      const msg = document.getElementById("task-msg");
      for (const f of e.target.files) {
        if (f.size > 10 * 1024 * 1024) { msg.textContent = `❌ ${f.name} 超過 10MB，未上傳`; continue; }
        msg.textContent = `⏳ 上傳 ${f.name} 中…`;
        const base64 = await new Promise(ok => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result).split(",")[1]);
          r.readAsDataURL(f);
        });
        const res = await api("upload_file", { filename: f.name, base64, content_type: f.type })
          .catch(() => ({ ok: false, error: "連線失敗" }));
        if (res.ok) { attachments.push({ name: f.name, url: res.file_url }); msg.textContent = `✅ ${f.name} 已上傳`; }
        else msg.textContent = `❌ ${f.name} 上傳失敗：${res.error || ""}`;
      }
      e.target.value = "";
      renderAttach();
    });

    // 送出任務
    document.getElementById("task-send").addEventListener("click", async () => {
      const msg = document.getElementById("task-msg");
      const text = ta.value.trim();
      if (!text) { msg.textContent = "請先輸入一句話"; return; }
      if (text.includes("＿")) { msg.textContent = "請把「＿」改成實際內容（例如座號）再送出"; return; }
      msg.textContent = "⏳ 送出中…";
      const res = await api("submit_task", { text, attachment_urls: attachments.map(a => a.url) })
        .catch(() => ({ ok: false, error: "連線失敗" }));
      if (res.ok) {
        ta.value = ""; attachments = []; renderAttach();
        msg.textContent = "✅ 已收到，約 30 分內處理。可在下方任務狀態追蹤。";
        loadTasks();
      } else msg.textContent = `❌ ${res.error || "送出失敗"}`;
    });

    // 課堂工具送來的 #CM-EVENTS 任務包，原文是一長串 JSON，老師看不懂（2026-09-07 回饋）。
    // 這裡只改「顯示」：翻成一句話＋可展開的逐筆明細；送出與排程入庫的格式完全不動。
    const CM_TOOL = { board: "電子白板", arrive: "到校簽到", cleanup: "打掃檢核", homework: "作業清點",
                      lunch: "午餐檢核", teeth: "潔牙檢核", routine: "常規檢核（舊）" };
    // 2026-09-07 起任務原文第一行是白話標題、行尾帶 #CM-EVENTS v1，第二行起才是 JSON。
    // 舊格式（首行就是 #CM-EVENTS）一樣吃得下——收件匣裡還留著舊的那幾筆。
    const cmParse = text => {
      if (!/#CM-EVENTS/.test(text || "")) return null;
      const i = text.indexOf("{");
      if (i < 0) return null;
      try { return JSON.parse(text.slice(i)); } catch { return null; }
    };
    const cmView = pack => {
      const evs = pack.events || [];
      const by = {};
      evs.forEach(e => { const k = e.act || "（未填行為）"; by[k] = (by[k] || 0) + 1; });
      const acts = Object.entries(by).sort((a, b) => b[1] - a[1]);
      const head = `📋 ${CM_TOOL[pack.tool] || pack.tool || "課堂工具"}　` +
                   `${String(pack.date || "").slice(5).replace("-", "/")}　共 ${evs.length} 筆` +
                   (pack.parts > 1 ? `（第 ${pack.part}／${pack.parts} 段）` : "");
      const brief = acts.slice(0, 3).map(([a, n]) => `${a} ×${n}`).join("、") +
                    (acts.length > 3 ? ` 等 ${acts.length} 種` : "");
      const rows = evs.map(e => {
        const bits = [`座號 ${e.seat}`, e.act || "（未填行為）"];
        if (e.period) bits.push(e.period);
        if (e.count > 1) bits.push(`${e.count} 次`);
        if (e.coin !== undefined && e.coin !== "") bits.push(`${e.coin} 幣`);
        if (e.note) bits.push(e.note);
        return bits.join("　·　");
      });
      return { head, brief, rows };
    };
    const taskBody = text => {
      const pack = cmParse(text);
      if (!pack) return App.esc(text);
      const v = cmView(pack);
      return `<strong>${App.esc(v.head)}</strong>` +
        (v.brief ? `<br /><span class="meta">${App.esc(v.brief)}</span>` : "") +
        `<details style="margin-top:4px"><summary class="meta" style="cursor:pointer">看明細（${v.rows.length} 筆）</summary>` +
        `<span class="meta" style="display:block;line-height:1.9">${v.rows.map(r => App.esc(r)).join("<br />")}</span></details>`;
    };

    // 任務狀態清單（待審置頂＋醒目標記）
    const STATUS_STYLE = {
      "待審": "background:#ffe8cc;color:#b35c00", "待處理": "background:#fff3bf;color:#8a6d00",
      "處理中": "background:#d0ebff;color:#1864ab", "已完成": "background:#d3f9d8;color:#2b8a3e",
      "失敗": "background:#ffe3e3;color:#c92a2a", "已取消": "background:#eee;color:#666",
    };
    const loadTasks = async () => {
      const box = document.getElementById("task-list");
      const res = await api("list_tasks", { limit: 20 }).catch(() => ({ ok: false }));
      if (!res.ok) { box.innerHTML = `<p class="empty-hint">載入失敗：${App.esc(res.error || "連線問題")}</p>`; return; }
      if (!res.tasks.length) { box.innerHTML = '<p class="empty-hint">目前沒有任務</p>'; return; }
      const sorted = [...res.tasks.filter(t => t.status === "待審"), ...res.tasks.filter(t => t.status !== "待審")];
      box.innerHTML = sorted.map(t => `
        <div style="margin:10px 0;${t.status === "待審" ? "border-left:4px solid #ff9f43;padding-left:8px;background:#fff9f2" : ""}">
          <span class="badge" style="${STATUS_STYLE[t.status] || ""}">${App.esc(t.status || "—")}</span>
          ${t.status === "待審" ? "🔔 " : ""}${taskBody(t.text)}
          <span class="meta">${App.fmtDateShort(String(t.created).slice(0, 10))}</span>
          ${t.output_url ? ` <a href="${App.esc(t.output_url)}" target="_blank" rel="noopener">產出</a>` : ""}
          ${t.status === "待審" && t.page_url ? ` <a href="${App.esc(t.page_url)}" target="_blank" rel="noopener"><strong>去審核 →</strong></a>` : ""}
          ${t.error ? `<br /><span class="meta" style="color:#c92a2a">${App.esc(t.error)}</span>` : ""}
        </div>`).join("");
    };
    document.getElementById("task-refresh").addEventListener("click", loadTasks);
    loadTasks();

    // 兌換申請：待處理（核可／駁回）＋購買明細兩個檢視
    const RD_STATUS_STYLE = {
      "待處理": "background:#fff3bf;color:#8a6d00",
      "已完成": "background:#d3f9d8;color:#2b8a3e",
      "已駁回": "background:#ffe3e3;color:#c92a2a",
    };
    let redeemView = "pending";
    const loadRedeems = async () => {
      const box = document.getElementById("redeem-list");
      box.innerHTML = '<p class="empty-hint">載入中…</p>';
      const params = redeemView === "pending" ? { status: "待處理", limit: 30 } : { status: "all", limit: 50 };
      const res = await api("list_redeems", params).catch(() => ({ ok: false }));
      if (!res.ok) { box.innerHTML = `<p class="empty-hint">載入失敗：${App.esc(res.error || "連線問題")}</p>`; return; }
      if (!res.items.length) {
        box.innerHTML = `<p class="empty-hint">${redeemView === "pending" ? "目前沒有待處理的申請 🎉" : "還沒有任何兌換紀錄"}</p>`;
        return;
      }
      box.innerHTML = res.items.map(r => `
        <p style="${r.status === "待處理" ? "border-left:4px solid #f0932b;padding-left:8px;background:#fff9f2" : ""}">
          <span class="badge" style="${RD_STATUS_STYLE[r.status] || ""}">${App.esc(r.status || "—")}</span>
          <strong>座號 ${r.seat}</strong>　${App.esc(r.item)}　🪙 ${r.price} 幣
          <span class="meta">${App.fmtDateShort(String(r.created).slice(0, 10))}</span>
          ${r.status === "待處理" ? `
            <button class="badge rd-approve" data-id="${App.esc(r.page_id)}" style="cursor:pointer;border:none;background:#d3f9d8;color:#2b8a3e">✅ 核可</button>
            <button class="badge rd-reject" data-id="${App.esc(r.page_id)}" style="cursor:pointer;border:none;background:#ffe3e3;color:#c92a2a">❌ 駁回</button>` : ""}
          ${r.note ? `<br /><span class="meta">${App.esc(r.note)}</span>` : ""}
        </p>`).join("");

      document.querySelectorAll(".rd-approve").forEach(btn => btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "⏳ 處理中…";
        let res = await api("approve_redeem", { page_id: btn.dataset.id }).catch(() => ({ ok: false, error: "連線失敗" }));
        if (!res.ok && res.insufficient) {
          if (confirm(`${res.error}。\n仍要核可（允許餘額變負數）嗎？`)) {
            res = await api("approve_redeem", { page_id: btn.dataset.id, force: true }).catch(() => ({ ok: false, error: "連線失敗" }));
          } else { loadRedeems(); return; }
        }
        if (res.ok) alert(`✅ 已核可：座號 ${res.seat} 兌換「${res.item}」，扣 ${res.price} 幣，餘額 ${res.balance} 幣${res.stock_msg || ""}${
          res.uses ? `\n🎟️ 已發特權券 ${res.uses} 次，之後在「特權執行」區塊扣次數。` : ""}\n記得按「立即更新班網」讓存摺更新。`);
        else alert(`❌ ${res.error || "核可失敗"}`);
        loadRedeems();
        if (res.ok && res.uses) loadPrivs();
      }));
      document.querySelectorAll(".rd-reject").forEach(btn => btn.addEventListener("click", async () => {
        const reason = prompt("駁回原因（會顯示在明細，例：庫存不足、先完成本週任務）：", "");
        if (reason === null) return;
        btn.disabled = true; btn.textContent = "⏳ 處理中…";
        const res = await api("reject_redeem", { page_id: btn.dataset.id, reason }).catch(() => ({ ok: false, error: "連線失敗" }));
        if (!res.ok) alert(`❌ ${res.error || "駁回失敗"}`);
        loadRedeems();
      }));
    };
    const rdTabPending = document.getElementById("rd-tab-pending");
    const rdTabAll = document.getElementById("rd-tab-all");
    const setRedeemView = view => {
      redeemView = view;
      rdTabPending.style.opacity = view === "pending" ? "1" : ".75";
      rdTabAll.style.opacity = view === "all" ? "1" : ".75";
      loadRedeems();
    };
    rdTabPending.addEventListener("click", () => setRedeemView("pending"));
    rdTabAll.addEventListener("click", () => setRedeemView("all"));
    loadRedeems();

    // 特權執行：持有中（使用一次／撤銷／作廢）＋使用歷史
    let storeIcons = {};
    try {
      const st = await App.fetchJSON("data/store.json");
      storeIcons = Object.fromEntries(st.map(i => [i.name, i.icon]));
    } catch {}
    const privIcon = name => storeIcons[name] || "🎟️";

    let privView = "holding";
    let privItems = [];
    const privBox = () => document.getElementById("priv-list");

    const renderPrivs = () => {
      const box = privBox();
      const seatFilter = Number(document.getElementById("pv-filter").value) || 0;
      const items = seatFilter ? privItems.filter(p => p.seat === seatFilter) : privItems;
      if (!items.length) {
        box.innerHTML = `<p class="empty-hint">${seatFilter ? `座號 ${seatFilter} ` : ""}${
          privView === "holding" ? "目前沒有持有中的特權券" : "還沒有用完或作廢的特權券"}</p>`;
        return;
      }
      const bySeat = {};
      items.forEach(p => (bySeat[p.seat] ||= []).push(p));
      const totalTickets = items.reduce((n, p) => n + (privView === "holding" ? p.remaining : 1), 0);

      box.innerHTML = `
        <p class="meta">${privView === "holding"
          ? `目前 ${Object.keys(bySeat).length} 位同學持有 ${items.length} 張券、共 ${totalTickets} 次可用`
          : `共 ${items.length} 筆`}</p>
        ${Object.keys(bySeat).map(Number).sort((a, b) => a - b).map(seat => `
          <div style="border-left:4px solid #9B59B6;padding:6px 0 6px 10px;margin-bottom:10px">
            <p style="margin:0 0 4px"><strong>座號 ${seat}</strong>
              <span class="meta">${bySeat[seat].length} 張券</span></p>
            ${bySeat[seat].map(p => `
              <p style="margin:2px 0">
                ${privIcon(p.item)} ${App.esc(p.item)}
                ${p.category === "小物" ? `<span class="badge" style="background:#fde7f3;color:#a61e69">小物</span>` : ""}
                ${privView === "holding"
                  ? `<span class="badge" style="background:#f3e5f8;color:#6c3483">剩 ${p.remaining}/${p.total} 次</span>`
                  : `<span class="badge" style="background:#eee;color:#666">已用完／作廢</span>`}
                <span class="meta">取得 ${App.fmtDateShort(String(p.got).slice(0, 10))}${
                  p.last_used ? `　最近 ${App.fmtDateShort(p.last_used)}` : ""}</span>
                ${p.remaining > 0 ? `
                  <button class="badge pv-use" data-id="${App.esc(p.page_id)}" style="cursor:pointer;border:none;background:#d3f9d8;color:#2b8a3e">✅ 使用一次</button>
                  <button class="badge pv-void" data-id="${App.esc(p.page_id)}" style="cursor:pointer;border:none;background:#f1f3f5;color:#666">🚫 作廢</button>
                  <button class="badge pv-refund" data-id="${App.esc(p.page_id)}" data-price="${p.price}" data-seat="${p.seat}" data-item="${App.esc(p.item)}" style="cursor:pointer;border:none;background:#ffe3e3;color:#c92a2a">💰 退費</button>` : ""}
                ${p.used > 0 ? `
                  <button class="badge pv-undo" data-id="${App.esc(p.page_id)}" style="cursor:pointer;border:none;background:#fff3bf;color:#8a6d00">↩️ 撤銷</button>` : ""}
                ${p.log ? `<br /><span class="meta">${App.esc(p.log.split("\n")[0])}</span>` : ""}
              </p>`).join("")}
          </div>`).join("")}`;

      const act = async (btn, action, params, okMsg) => {
        btn.disabled = true; btn.textContent = "⏳";
        const res = await api(action, params).catch(() => ({ ok: false, error: "連線失敗" }));
        if (res.ok) alert(okMsg(res));
        else if (!res.duplicate) alert(`❌ ${res.error || "操作失敗"}`);
        return res;
      };
      document.querySelectorAll(".pv-use").forEach(btn => btn.addEventListener("click", async () => {
        let res = await act(btn, "use_privilege", { page_id: btn.dataset.id },
          r => `✅ 座號 ${r.seat}「${r.item}」已扣 1 次，還剩 ${r.remaining}/${r.total} 次`);
        if (!res.ok && res.duplicate) {
          if (confirm(`${res.error}。\n確定要再扣一次嗎？`)) {
            res = await api("use_privilege", { page_id: btn.dataset.id, force: true }).catch(() => ({ ok: false, error: "連線失敗" }));
            if (res.ok) alert(`✅ 座號 ${res.seat}「${res.item}」已扣 1 次，還剩 ${res.remaining}/${res.total} 次`);
            else alert(`❌ ${res.error || "操作失敗"}`);
          }
        }
        loadPrivs();
      }));
      document.querySelectorAll(".pv-undo").forEach(btn => btn.addEventListener("click", async () => {
        if (!confirm("要把這張券的次數加回去嗎？（用於按錯）")) return;
        await act(btn, "undo_privilege", { page_id: btn.dataset.id },
          r => `↩️ 已還原：座號 ${r.seat}「${r.item}」剩 ${r.remaining} 次`);
        loadPrivs();
      }));
      document.querySelectorAll(".pv-void").forEach(btn => btn.addEventListener("click", async () => {
        const reason = prompt("作廢原因（會記在使用紀錄，例：學期末結清、條件未達成）：", "");
        if (reason === null) return;
        await act(btn, "void_privilege", { page_id: btn.dataset.id, reason },
          r => `🚫 已作廢：座號 ${r.seat}「${r.item}」${r.voided} 次（不退幣）`);
        loadPrivs();
      }));
      // 退費：券收回＋幣退回帳本＋庫存加回。動錢，所以先讓老師看到金額再確認一次。
      document.querySelectorAll(".pv-refund").forEach(btn => btn.addEventListener("click", async () => {
        const { price, seat, item } = btn.dataset;
        if (!confirm(`要退 ${price} 幣給座號 ${seat} 嗎？\n「${item}」這張券會收回，庫存加回 1。`)) return;
        const reason = prompt("退費原因（會記在帳本事由與使用紀錄）：", "老師退費");
        if (reason === null) return;
        await act(btn, "refund_privilege", { page_id: btn.dataset.id, reason },
          r => `💰 已退費：座號 ${r.seat}「${r.item}」退回 ${r.refunded} 幣${r.msg || ""}\n記得按「立即更新班網」讓存摺更新。`);
        loadPrivs();
      }));
    };

    const loadPrivs = async () => {
      privBox().innerHTML = '<p class="empty-hint">載入中…</p>';
      const res = await api("list_privileges", privView === "holding" ? { view: "holding" } : { view: "history", limit: 50 })
        .catch(() => ({ ok: false }));
      if (!res.ok) { privBox().innerHTML = `<p class="empty-hint">載入失敗：${App.esc(res.error || "連線問題")}</p>`; return; }
      privItems = res.items;
      renderPrivs();
    };
    const pvHolding = document.getElementById("pv-tab-holding");
    const pvHistory = document.getElementById("pv-tab-history");
    const setPrivView = view => {
      privView = view;
      pvHolding.style.opacity = view === "holding" ? "1" : ".75";
      pvHistory.style.opacity = view === "history" ? "1" : ".75";
      loadPrivs();
    };
    pvHolding.addEventListener("click", () => setPrivView("holding"));
    pvHistory.addEventListener("click", () => setPrivView("history"));
    document.getElementById("pv-filter").addEventListener("input", renderPrivs);
    document.getElementById("pv-refresh").addEventListener("click", loadPrivs);
    loadPrivs();

    // 🧪 提案審核：待審核（計畫審核中／成果審核中）＋本學年全部
    const PP_REVIEW = ["計畫審核中", "成果審核中"];
    const PP_COLOR = { "草稿": "#868e96", "計畫審核中": "#F0932B", "計畫需修改": "#E67E22", "計畫不通過": "#8395A7",
      "試行中": "#54A0FF", "成果審核中": "#9B59B6", "延長試行": "#FF6B81", "成果通過": "#10AC84", "成果未通過": "#8395A7" };
    const PP_PLAN = ["類型", "問題", "點子", "好處", "困難與解決", "成功標準", "需要協助"];
    const PP_RESULT = ["實際做法", "試行前", "試行後", "達成", "同學回饋", "反思", "命名候選"];
    let ppView = "review";
    let ppItems = [];
    let ppXp = { plan: 10, result: 20 };
    const ppRows = (obj, keys) => keys.filter(k => obj[k]).map(k =>
      `<p style="margin:4px 0;white-space:pre-line"><strong>${App.esc(k)}：</strong>${App.esc(obj[k])}</p>`).join("");
    const renderProposals = () => {
      const box = document.getElementById("proposal-list");
      const items = (ppView === "review" ? ppItems.filter(p => PP_REVIEW.includes(p.status)) : [...ppItems])
        .sort((a, b) => (PP_REVIEW.includes(b.status) - PP_REVIEW.includes(a.status)) || (a.seat - b.seat));
      if (!items.length) {
        box.innerHTML = `<p class="empty-hint">${ppView === "review" ? "目前沒有等你審核的提案 🎉" : "本學年還沒有任何提案"}</p>`;
        return;
      }
      box.innerHTML = items.map(p => {
        const pl = p.plan, rs = p.result;
        const stage = p.status === "計畫審核中" ? "plan" : p.status === "成果審核中" ? "result" : "";
        const hasResult = PP_RESULT.some(k => rs[k]);
        return `
        <details class="pp-review" ${stage ? "open" : ""} style="border-left:4px solid ${PP_COLOR[p.status] || "#8395A7"};padding:6px 0 6px 10px;margin-bottom:12px">
          <summary style="cursor:pointer">
            <span class="badge" style="background:${PP_COLOR[p.status] || "#8395A7"};color:#fff">${App.esc(p.status)}</span>
            <strong>座號 ${p.seat}</strong>　${App.esc(pl["提案名稱"] || "（未命名）")}
            <span class="meta">${p.submitted ? `送出 ${App.fmtDateShort(p.submitted.slice(0, 10))}` : `建立 ${App.fmtDateShort(p.created.slice(0, 10))}`}
              ${p.xp_plan ? "・計畫XP已發" : ""}${p.xp_result ? "・成果XP已發" : ""}${p.naming ? "・🏷️ 命名權已頒" : ""}</span>
          </summary>
          <div class="pp-review-grid">
            <div><h4 style="margin:6px 0">📝 表一｜計畫書</h4>
              ${ppRows(pl, PP_PLAN)}
              ${pl["試行起"] ? `<p style="margin:4px 0"><strong>試行期間：</strong>${App.esc(pl["試行起"])} ～ ${App.esc(pl["試行迄"])}</p>` : ""}
              ${pl["記錄方式"].length ? `<p style="margin:4px 0"><strong>記錄方式：</strong>${pl["記錄方式"].map(App.esc).join("、")}</p>` : ""}
              <p style="margin:4px 0"><strong>護欄自檢：</strong>${pl["護欄自檢"].length}／5 ${pl["護欄自檢"].length === 5 ? "✅" : "⚠️"}</p>
              ${p.plan_comment ? `<p class="meta" style="white-space:pre-line">👩‍🏫 計畫意見：${App.esc(p.plan_comment)}</p>` : ""}
            </div>
            ${hasResult ? `<div><h4 style="margin:6px 0">📊 表二｜成果回報</h4>
              ${ppRows(rs, PP_RESULT)}
              ${p.result_comment ? `<p class="meta" style="white-space:pre-line">👩‍🏫 成果回饋：${App.esc(p.result_comment)}</p>` : ""}
            </div>` : ""}
          </div>
          ${stage ? `
          <textarea class="pp-comment-input" rows="2" maxlength="800" placeholder="${stage === "plan" ? "理由／建議（修改、不通過必填；通過可不填）" : "理由／回饋（延長、未通過必填；通過可不填）"}"
            style="width:100%;padding:8px;border:1px solid #ccc;border-radius:8px;margin-top:6px"></textarea>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            ${(stage === "plan"
              ? [["通過", `✅ 通過（+${ppXp.plan}）`, "#d3f9d8", "#2b8a3e"], ["修改", "✏️ 修改後再交", "#fff3bf", "#8a6d00"], ["不通過", "❌ 不通過", "#ffe3e3", "#c92a2a"]]
              : [["通過", `🏷️ 通過（+${ppXp.result}＋命名權）`, "#d3f9d8", "#2b8a3e"], ["延長", "⏳ 延長試行", "#fff3bf", "#8a6d00"], ["未通過", "❌ 未通過", "#ffe3e3", "#c92a2a"]]
            ).map(([d, label, bg, fg]) => `<button class="badge pp-decide" data-id="${App.esc(p.id)}" data-stage="${stage}" data-decision="${d}"
                data-seat="${p.seat}" data-name="${App.esc(pl["提案名稱"] || "未命名")}" data-paid="${stage === "plan" ? p.xp_plan : p.xp_result}"
                style="cursor:pointer;border:none;background:${bg};color:${fg};padding:6px 12px">${label}</button>`).join("")}
          </div>` : ""}
        </details>`;
      }).join("");

      box.querySelectorAll(".pp-decide").forEach(btn => btn.addEventListener("click", async () => {
        const { id, stage, decision, seat, name, paid } = btn.dataset;
        const comment = btn.closest(".pp-review").querySelector(".pp-comment-input").value.trim();
        if (decision !== "通過" && !comment) { alert(`「${decision}」要寫理由，學生才知道下一步怎麼做。`); return; }
        const amount = stage === "plan" ? ppXp.plan : ppXp.result;
        const next = stage === "plan"
          ? { "通過": "試行中", "修改": "計畫需修改", "不通過": "計畫不通過" }[decision]
          : { "通過": "成果通過", "延長": "延長試行", "未通過": "成果未通過" }[decision];
        const gain = decision !== "通過" ? "不發 XP。"
          : paid === "true" ? "（這件之前已發過，不會重複發）"
          : `會發：帳本獎勵金 +${amount}（＝貢獻 XP +${amount}、崑山幣 +${amount}）${stage === "result" ? "，並頒 🏷️ 命名權券" : ""}。`;
        if (!confirm(`座號 ${seat}「${name}」→ ${decision}\n狀態改為「${next}」。\n${gain}`)) return;
        btn.closest("div").querySelectorAll("button").forEach(b => { b.disabled = true; });
        btn.textContent = "⏳ 處理中…";
        const res = await api(stage === "plan" ? "proposal_review_plan" : "proposal_review_result",
          { page_id: id, decision, comment }).catch(() => ({ ok: false, error: "連線失敗" }));
        if (res.ok) alert(`✅ 座號 ${res.seat} 已改為「${res.status}」${res.xp ? `，帳本 +${res.xp}` : ""}${res.naming ? "，🏷️ 命名權券已發" : ""}${res.note || ""}`
          + (res.warn ? `\n${res.warn}` : "") + (res.xp ? "\n記得按「立即更新班網」讓存摺更新。" : ""));
        else alert(`❌ ${res.error || "審核失敗"}`);
        loadProposals();
        if (res.naming) loadPrivs();
      }));
    };
    const loadProposals = async () => {
      const box = document.getElementById("proposal-list");
      box.innerHTML = '<p class="empty-hint">載入中…</p>';
      const res = await api("proposal_list").catch(() => ({ ok: false }));
      if (!res.ok) { box.innerHTML = `<p class="empty-hint">載入失敗：${App.esc(res.error || "連線問題（代理可能還沒升級到 v2.4）")}</p>`; return; }
      ppItems = res.items;
      ppXp = { plan: res.xp_plan || 10, result: res.xp_result || 20 };
      renderProposals();
    };
    const ppTabReview = document.getElementById("pp-tab-review");
    const ppTabAll = document.getElementById("pp-tab-all");
    const setPpView = view => {
      ppView = view;
      ppTabReview.style.opacity = view === "review" ? "1" : ".75";
      ppTabAll.style.opacity = view === "all" ? "1" : ".75";
      renderProposals();
    };
    ppTabReview.addEventListener("click", () => setPpView("review"));
    ppTabAll.addEventListener("click", () => setPpView("all"));
    document.getElementById("pp-refresh").addEventListener("click", loadProposals);
    loadProposals();

    // 一鍵更新班網（POST 版）
    document.getElementById("site-update").addEventListener("click", async () => {
      const msg = document.getElementById("site-update-msg");
      msg.textContent = "⏳ 觸發中…";
      const res = await api("trigger_sync").catch(() => ({ ok: false, error: "連線失敗" }));
      msg.textContent = res.ok
        ? "✅ 已觸發更新，約 2～3 分鐘後重新整理頁面即可看到新內容。"
        : `❌ ${res.error || "更新失敗"}`;
    });

    document.getElementById("logout").addEventListener("click", e => {
      e.preventDefault();
      sessionStorage.removeItem("teacherPw");
      renderLogin("已登出");
    });
  };

  // 已有口令 → 直接進面板；否則要求輸入
  if (sessionStorage.getItem("teacherPw")) renderPanel();
  else renderLogin();
})();
