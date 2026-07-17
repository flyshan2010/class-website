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

    main.innerHTML = `
      <section class="card" style="--accent:#FF9F43">
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

      <section class="card" style="--accent:#54a0ff">
        <h2>📋 任務狀態（最近 20 筆）</h2>
        <p class="meta">「待審」項目請點進 Notion 檢查後勾發布。</p>
        <div id="task-list"><p class="empty-hint">載入中…</p></div>
        <button id="task-refresh" class="emotion-draw" style="margin-top:8px">🔄 重新整理</button>
      </section>

      <section class="card" style="--accent:#10ac84">
        <h2>⚡ 班網維護</h2>
        <button id="site-update" class="emotion-draw">🔄 立即更新班網</button>
        <p class="meta" id="site-update-msg"></p>
        <p class="meta" style="margin-top:6px"><a href="#" id="logout">登出教師專區</a></p>
      </section>`;

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
        <p style="${t.status === "待審" ? "border-left:4px solid #ff9f43;padding-left:8px;background:#fff9f2" : ""}">
          <span class="badge" style="${STATUS_STYLE[t.status] || ""}">${App.esc(t.status || "—")}</span>
          ${t.status === "待審" ? "🔔 " : ""}${App.esc(t.text)}
          <span class="meta">${App.fmtDateShort(String(t.created).slice(0, 10))}</span>
          ${t.output_url ? ` <a href="${App.esc(t.output_url)}" target="_blank" rel="noopener">產出</a>` : ""}
          ${t.status === "待審" && t.page_url ? ` <a href="${App.esc(t.page_url)}" target="_blank" rel="noopener"><strong>去審核 →</strong></a>` : ""}
          ${t.error ? `<br /><span class="meta" style="color:#c92a2a">${App.esc(t.error)}</span>` : ""}
        </p>`).join("");
    };
    document.getElementById("task-refresh").addEventListener("click", loadTasks);
    loadTasks();

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
