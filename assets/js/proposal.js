/* 🧪 創造提案（學生端）：座號＋查詢碼 → 表一「提案計畫書」／表二「成果回報單」線上暫存與送出
 * 規格：ClassOS_v3.5_藍圖/SPEC_創造提案線上版.md；紙本備援 plans/創造提案權申請書.html（提示句與例子同源）。
 * 資料正本在 Notion「🧪 創造提案」，經 Apps Script 代理 v2.4（proposal_get／save／submit）讀寫。
 * 驗證身分、狀態推進、必填與護欄檢查**全在代理端**；這裡的檢查只是早點提醒學生。
 * 學生寫的文字一律用 .value／App.esc 帶入，不直接拼進 HTML。 */
(async () => {
  const c = await App.init("proposal");
  const main = document.getElementById("main");
  const SS_KEY = "proposalLogin"; // 小小銀行「✏️ 我的創造提案」按鈕帶過來的登入（只存在這個分頁）

  if (!c.updateProxyUrl) {
    main.innerHTML = `<section class="card"><h2>🧪 創造提案</h2><p class="empty-hint">系統還沒設定好，請告訴老師。</p></section>`;
    return;
  }

  // ---------- 欄位定義（提示句與例子沿用紙本申請書） ----------
  const TYPES = ["新常規", "修改常規", "新班規", "修改班規", "新商店品項", "修改商店品項"];
  const RECORD = ["次數表", "照片（不拍臉）", "訪問同學", "其他"];
  const GUARDS = [
    ["沒有違反校規", "沒有違反校規（例如：上課時間離開教室）"],
    ["不用花錢不用買東西", "不用花錢、不用買東西（包含要老師或家長出錢）"],
    ["不會增加同學的負擔", "不會增加同學的負擔（例如：多寫作業、占用下課時間）"],
    ["不是花幣就不用負責", "不是「花幣就不用負責」（例如：付幣就不用訂正、不用打掃）"],
    ["沒有其他進行中的提案", "我目前沒有其他進行中的提案"],
  ];
  const ACHIEVE = ["達到", "部分達到", "沒達到"];
  const PLAN_TEXT = [
    { key: "問題", label: "1. 我發現的問題", hint: "現在發生什麼事？什麼時候、在哪裡？影響到誰？我觀察到幾次？",
      eg: "下課後掃把常常亂放，隔天打掃的人要先找掃把，浪費 3～5 分鐘。" },
    { key: "點子", label: "2. 我的點子（具體做法）", hint: "誰來做？什麼時候做？怎麼做？寫到別人照著就能做的程度。",
      eg: "掃具櫃貼上「掃具的家」編號貼紙，最後一個用的人負責放回對應位置，衛生股長放學前看一眼。" },
    { key: "好處", label: "3. 對全班的好處", hint: "全班有誰會因為這個變好？（不是只讓自己方便）" },
    { key: "困難與解決", label: "4. 可能遇到的困難，我打算怎麼解決", hint: "先想想哪裡可能卡住，再寫你的辦法。" },
    { key: "成功標準", label: "5. 怎樣算成功", hint: "要可以數、可以比，不要只寫「變得更好」。",
      eg: "試行 2 週，打掃開始時「找不到掃具」的次數從每週 4 次降到 1 次以下。" },
    { key: "需要協助", label: "6. 需要的協助（可不填）", hint: "需要老師或同學幫什麼？不需要就寫「不需要」。", optional: true, short: true },
  ];
  const RESULT_TEXT = [
    { key: "實際做法", label: "1. 我實際做了什麼", hint: "和計畫一樣嗎？哪裡有改？為什麼改？" },
    { key: "試行前", label: "2. 試行前我觀察到的數字", hint: "例：每週找不到掃具 4 次", short: true },
    { key: "試行後", label: "3. 試行後我觀察到的數字", hint: "例：每週 1 次", short: true },
    { key: "同學回饋", label: "4. 同學的回饋", hint: "至少問 3 位同學。只寫他說了什麼，不寫名字。" },
    { key: "反思", label: "5. 我學到什麼／如果再做一次會怎麼改", hint: "" },
    { key: "命名候選", label: "6. 我想幫這個點子取的名字（命名權，可不填）", hint: "不能有自己的姓名或座號。例：閃電歸位法", optional: true, short: true },
  ];
  const PLAN_EDITABLE = ["草稿", "計畫需修改"];
  const RESULT_EDITABLE = ["試行中", "延長試行"];
  const ACTIVE = ["草稿", "計畫審核中", "計畫需修改", "試行中", "成果審核中", "延長試行"];
  const SHOW_RESULT = ["試行中", "成果審核中", "延長試行", "成果通過", "成果未通過"];
  const STATUS = {
    "草稿": { step: 1, color: "#868e96", msg: "還沒送出。寫完按「📨 送出計畫書」，老師才會開始審核。" },
    "計畫審核中": { step: 2, color: "#F0932B", msg: "計畫書已送出，等老師審核中。這段時間不能修改。" },
    "計畫需修改": { step: 1, color: "#E67E22", msg: "老師請你修改計畫書，看完下面老師的意見，改好再送出一次。" },
    "計畫不通過": { step: 5, color: "#8395A7", msg: "這次計畫沒有通過，看看老師的理由。之後可以再換一張提案權重新提。" },
    "試行中": { step: 3, color: "#54A0FF", msg: "計畫通過了（貢獻 XP ＋10）！開始試行，邊做邊記錄，做完填下面的成果回報單再送出。" },
    "成果審核中": { step: 4, color: "#9B59B6", msg: "成果回報單已送出，等老師裁決中。" },
    "延長試行": { step: 3, color: "#FF6B81", msg: "老師請你再試一段時間。看完老師的回饋，更新成果回報單後再送出。" },
    "成果通過": { step: 5, color: "#10AC84", msg: "🎉 成果通過！貢獻 XP ＋20，還獲得 🏷️ 命名權，這個點子會正式納入班級制度。" },
    "成果未通過": { step: 5, color: "#8395A7", msg: "這次成果沒有通過，前面的 ＋10 會保留。看看老師的回饋，下次可以再挑戰！" },
  };
  const STEPS = ["① 計畫", "② 審核", "③ 試行回報", "④ 裁決"];

  // ---------- 狀態 ----------
  let login = null;     // { seat, code }
  let data = null;      // proposal_get 回應
  let current = null;   // 正在看的提案（null＝新提案）
  let dirty = false;
  let busy = false;

  window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  const api = async (action, params = {}) => {
    const res = await fetch(c.updateProxyUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, seat: login.seat, code: login.code, ...params }),
    });
    return res.json();
  };
  const hhmm = iso => (iso || "").slice(11, 16);

  // ---------- 登入 ----------
  const showLogin = (msg = "") => {
    login = null; data = null; current = null; dirty = false;
    try { sessionStorage.removeItem(SS_KEY); } catch {}
    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>🧪 創造提案</h2>
      <div class="card report-gate">
        <p>換到 <strong>🧪 創造提案權</strong> 的同學，在這裡線上寫提案。<br />輸入<strong>座號</strong>與<strong>查詢碼</strong>（和存摺、學習報告同一組）。</p>
        <form id="pp-form" class="report-form" autocomplete="off">
          <label>座號<input id="pp-seat" type="number" min="1" max="99" required inputmode="numeric" /></label>
          <label>查詢碼<input id="pp-code" type="password" required /></label>
          <button type="submit">🔓 打開我的提案</button>
        </form>
        ${msg ? `<p class="report-error">${App.esc(msg)}</p>` : ""}
        <p class="meta" style="margin-top:10px">🔒 只有你自己（和老師）看得到你的提案；查詢碼不要給別人。</p>
      </div>`;
    document.getElementById("pp-form").addEventListener("submit", e => {
      e.preventDefault();
      const btn = e.target.querySelector("button");
      btn.disabled = true; btn.textContent = "讀取中…";
      enter({ seat: Number(document.getElementById("pp-seat").value), code: document.getElementById("pp-code").value.trim() });
    });
  };

  const enter = async who => {
    login = who;
    let res;
    try { res = await api("proposal_get"); } catch { res = { ok: false, error: "連線失敗，請確認網路後再試一次" }; }
    if (!res.ok) { showLogin(res.error || "讀取失敗，請再試一次"); return; }
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(who)); } catch {}
    data = res;
    current = res.proposals.find(p => ACTIVE.includes(p.status)) || null;
    render();
  };

  const reload = async () => {
    const keepId = current?.id;
    let res;
    try { res = await api("proposal_get"); } catch { res = { ok: false, error: "連線失敗" }; }
    if (!res.ok) { alert(res.error || "讀取失敗"); return; }
    data = res;
    current = res.proposals.find(p => p.id === keepId) || res.proposals.find(p => ACTIVE.includes(p.status)) || null;
    dirty = false;
    render();
  };

  // ---------- 主畫面 ----------
  function render() {
    const active = data.proposals.find(p => ACTIVE.includes(p.status));
    const past = data.proposals.filter(p => !ACTIVE.includes(p.status) && p.id !== current?.id);
    const showEditor = !!current || (data.can_start && current === null && render.startNew);
    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>🧪 創造提案</h2>
      <div class="card pp-head">
        <p class="passbook-owner">👤 ${App.esc(data.seat)} 號的創造提案</p>
        <button id="pp-exit" class="report-exit">🔒 離開</button>
      </div>
      ${!data.proposals.length && !data.has_ticket ? `
      <div class="card">
        <p>你目前還沒有 <strong>🧪 創造提案權</strong>。</p>
        <p class="meta">到「🏦 小小銀行」商店櫥窗最下面找「🧪 創造提案權」（0 幣，但要達到 💫 超新星：總 XP 1200、貢獻 XP 350），
          按「🛒 我要兌換」送出，老師核可後就可以回來這裡寫提案。</p>
        <p><a class="store-buy pp-link" href="bank.html">🏦 去小小銀行</a></p>
      </div>` : ""}
      ${!active && data.can_start && !showEditor ? `
      <div class="card">
        <p>你有一張可以用的 <strong>🧪 創造提案權</strong>！想讓班級變得更好的點子，寫下來吧。</p>
        <button id="pp-new" class="store-buy">✏️ 開始寫新提案</button>
      </div>` : ""}
      ${!active && !data.can_start && data.proposals.length ? `
      <div class="card"><p class="meta">目前沒有進行中的提案。想再提一件，要先到小小銀行再換一張 🧪 創造提案權。</p></div>` : ""}
      <div id="pp-editor"></div>
      ${past.length ? `
      <h3 class="bank-section-title">📚 我做過的提案</h3>
      ${past.map(p => `
        <div class="card pp-past">
          <span class="badge" style="background:${STATUS[p.status]?.color || "#8395A7"};color:#fff">${App.esc(p.status)}</span>
          <strong>${App.esc(p.plan["提案名稱"] || "（未命名提案）")}</strong>
          <button class="report-tool pp-open" data-id="${App.esc(p.id)}">看內容</button>
        </div>`).join("")}` : ""}`;

    document.getElementById("pp-exit").onclick = () => {
      if (dirty && !confirm("還有沒暫存的內容，確定要離開嗎？")) return;
      showLogin("已離開。");
    };
    const btnNew = document.getElementById("pp-new");
    if (btnNew) btnNew.onclick = () => { render.startNew = true; current = null; render(); };
    main.querySelectorAll(".pp-open").forEach(b => b.onclick = () => {
      if (dirty && !confirm("還有沒暫存的內容，確定要切換嗎？")) return;
      current = data.proposals.find(p => p.id === b.dataset.id) || null;
      dirty = false; render();
    });
    if (current || (data.can_start && render.startNew)) renderEditor(current);
  }

  // ---------- 表單 ----------
  const textField = (part, f, editable) => `
    <div class="pp-field">
      <label for="pp-${part}-${f.key}">${f.label}${f.optional ? "" : ' <span class="pp-req">＊</span>'}</label>
      ${f.hint ? `<p class="pp-hint">${f.hint}</p>` : ""}
      ${f.eg ? `<p class="pp-eg">✏️ 參考例子：${f.eg}</p>` : ""}
      ${f.short
        ? `<input id="pp-${part}-${f.key}" data-part="${part}" data-key="${f.key}" type="text" maxlength="${f.key === "命名候選" ? 30 : 200}" ${editable ? "" : "disabled"} />`
        : `<textarea id="pp-${part}-${f.key}" data-part="${part}" data-key="${f.key}" rows="4" maxlength="800" ${editable ? "" : "disabled"}></textarea>
           <span class="pp-count" data-for="pp-${part}-${f.key}"></span>`}
    </div>`;

  function renderEditor(p) {
    const box = document.getElementById("pp-editor");
    const status = p?.status || "草稿";
    const meta = STATUS[status] || STATUS["草稿"];
    const planEditable = !p || PLAN_EDITABLE.includes(status);
    const showResult = !!p && SHOW_RESULT.includes(status);
    const resultEditable = !!p && RESULT_EDITABLE.includes(status);
    const step = meta.step;

    box.innerHTML = `
      <div class="card pp-card">
        <div class="pp-steps">${STEPS.map((s, i) =>
          `<span class="pp-step ${i + 1 < step ? "done" : i + 1 === step ? "now" : ""}">${i + 1 < step ? "✅ " : ""}${s}</span>`).join("")}</div>
        <p class="pp-status"><span class="badge" style="background:${meta.color};color:#fff">${App.esc(p ? status : "新提案")}</span>
          ${App.esc(p ? meta.msg : "先寫表一「提案計畫書」。可以隨時按「💾 暫存」，換電腦登入也還在。")}</p>
        ${p?.plan_comment ? `<div class="pp-comment"><strong>👩‍🏫 老師對計畫書的意見</strong>${p.plan_reviewed ? `<span class="meta">（${App.esc(App.fmtDateShort(p.plan_reviewed))}）</span>` : ""}<p>${App.esc(p.plan_comment)}</p></div>` : ""}
        ${p?.result_comment ? `<div class="pp-comment"><strong>👩‍🏫 老師的成果回饋</strong>${p.result_reviewed ? `<span class="meta">（${App.esc(App.fmtDateShort(p.result_reviewed))}）</span>` : ""}<p>${App.esc(p.result_comment)}</p></div>` : ""}
        ${p?.naming ? `<p class="pp-naming">🏷️ 你獲得了命名權！可以到小小銀行「🎟️ 我的特權」看到這張券。</p>` : ""}
        <p class="pp-note">✋ 寫的時候<strong>不要寫同學的名字</strong>；照片<strong>不拍同學的臉</strong>。</p>
      </div>

      <details class="card pp-card" ${planEditable || !showResult ? "open" : ""}>
        <summary><h3>📝 表一｜提案計畫書</h3></summary>
        <div class="pp-field">
          <label for="pp-plan-提案名稱">提案名稱（暫定） <span class="pp-req">＊</span></label>
          <input id="pp-plan-提案名稱" data-part="plan" data-key="提案名稱" type="text" maxlength="60" ${planEditable ? "" : "disabled"} />
        </div>
        <div class="pp-field">
          <label>提案類型 <span class="pp-req">＊</span></label>
          <p class="pp-hint">常規＝每天怎麼做事；班規＝獎勵與提醒；商店品項＝新的兌換券。</p>
          <div class="pp-checks">${TYPES.map(t => `
            <label><input type="radio" name="pp-type" data-part="plan" data-key="類型" value="${t}" ${planEditable ? "" : "disabled"} /> ${t}</label>`).join("")}</div>
        </div>
        ${PLAN_TEXT.slice(0, 5).map(f => textField("plan", f, planEditable)).join("")}
        <div class="pp-field">
          <label>試行期間 <span class="pp-req">＊</span></label>
          <p class="pp-hint">先小規模試試看，建議 2 週。</p>
          <div class="pp-dates">
            <input id="pp-plan-試行起" data-part="plan" data-key="試行起" type="date" ${planEditable ? "" : "disabled"} />
            <span>到</span>
            <input id="pp-plan-試行迄" data-part="plan" data-key="試行迄" type="date" ${planEditable ? "" : "disabled"} />
          </div>
        </div>
        <div class="pp-field">
          <label>我怎麼記錄 <span class="pp-req">＊</span></label>
          <div class="pp-checks">${RECORD.map(t => `
            <label><input type="checkbox" data-part="plan" data-key="記錄方式" value="${t}" ${planEditable ? "" : "disabled"} /> ${t}</label>`).join("")}</div>
        </div>
        ${textField("plan", PLAN_TEXT[5], planEditable)}
        <div class="pp-field pp-guard">
          <label>🛡️ 護欄自我檢查（每一格都要能打勾才能送出） <span class="pp-req">＊</span></label>
          <div class="pp-checks pp-checks-col">${GUARDS.map(([v, label]) => `
            <label><input type="checkbox" data-part="plan" data-key="護欄自檢" value="${v}" ${planEditable ? "" : "disabled"} /> ${label}</label>`).join("")}</div>
        </div>
        ${planEditable ? `
        <div class="pp-actions">
          <button class="report-tool" data-save="plan">💾 暫存</button>
          <button class="store-buy" data-submit="plan">📨 送出計畫書</button>
          <span class="meta pp-saved" id="pp-saved-plan">${p?.edited ? `上次存檔 ${App.esc(new Date(p.edited).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }))}` : ""}</span>
        </div>` : ""}
      </details>

      ${showResult ? `
      <details class="card pp-card" open>
        <summary><h3>📊 表二｜成果回報單</h3></summary>
        ${p.plan["試行起"] ? `<p class="meta">計畫的試行期間：${App.esc(App.fmtDateShort(p.plan["試行起"]))} 到 ${App.esc(App.fmtDateShort(p.plan["試行迄"]))}；成功標準：${App.esc(p.plan["成功標準"])}</p>` : ""}
        ${RESULT_TEXT.slice(0, 3).map(f => textField("result", f, resultEditable)).join("")}
        <div class="pp-field">
          <label>有沒有達到「成功標準」 <span class="pp-req">＊</span></label>
          <div class="pp-checks">${ACHIEVE.map(t => `
            <label><input type="radio" name="pp-achieve" data-part="result" data-key="達成" value="${t}" ${resultEditable ? "" : "disabled"} /> ${t}</label>`).join("")}</div>
          <p class="pp-hint">沒達到也沒關係——誠實記錄、說清楚原因，也是有價值的成果。</p>
        </div>
        ${RESULT_TEXT.slice(3).map(f => textField("result", f, resultEditable)).join("")}
        ${resultEditable ? `
        <div class="pp-actions">
          <button class="report-tool" data-save="result">💾 暫存</button>
          <button class="store-buy" data-submit="result">📨 送出成果回報單</button>
          <span class="meta pp-saved" id="pp-saved-result"></span>
        </div>` : ""}
      </details>` : ""}`;

    fill(p);
    box.querySelectorAll("input, textarea").forEach(el => el.addEventListener("input", () => { dirty = true; count(el); }));
    box.querySelectorAll("[data-save]").forEach(b => b.onclick = () => save(b.dataset.save, false, b));
    box.querySelectorAll("[data-submit]").forEach(b => b.onclick = () => save(b.dataset.submit, true, b));
  }

  const count = el => {
    const tag = document.querySelector(`.pp-count[data-for="${el.id}"]`);
    if (tag) tag.textContent = `${el.value.length}／800 字`;
  };

  // 以 .value／.checked 帶入（學生文字不經過 innerHTML）
  function fill(p) {
    const src = { plan: p?.plan || {}, result: p?.result || {} };
    document.querySelectorAll("#pp-editor [data-key]").forEach(el => {
      const v = src[el.dataset.part][el.dataset.key];
      if (el.type === "checkbox") el.checked = Array.isArray(v) && v.includes(el.value);
      else if (el.type === "radio") el.checked = v === el.value;
      else { el.value = v || ""; count(el); }
    });
  }

  function collect(part) {
    const out = {};
    document.querySelectorAll(`#pp-editor [data-part="${part}"]`).forEach(el => {
      const k = el.dataset.key;
      if (el.type === "checkbox") { (out[k] ||= []); if (el.checked) out[k].push(el.value); }
      else if (el.type === "radio") { if (!(k in out)) out[k] = ""; if (el.checked) out[k] = el.value; }
      else out[k] = el.value.trim();
    });
    return out;
  }

  // 前端提醒（代理端還會再驗一次，以代理為準）
  function missing(part, f) {
    const miss = [];
    if (part === "plan") {
      ["提案名稱", "類型", ...PLAN_TEXT.filter(x => !x.optional).map(x => x.key), "試行起", "試行迄"]
        .forEach(k => { if (!f[k]) miss.push(k); });
      if (!(f["記錄方式"] || []).length) miss.push("我怎麼記錄");
      if (f["試行起"] && f["試行迄"] && f["試行迄"] < f["試行起"]) miss.push("試行期間（結束不能比開始早）");
      const lack = GUARDS.length - (f["護欄自檢"] || []).length;
      if (lack > 0) miss.push(`護欄自我檢查（還差 ${lack} 格）`);
    } else {
      [...RESULT_TEXT.filter(x => !x.optional).map(x => x.key), "達成"].forEach(k => { if (!f[k]) miss.push(k === "達成" ? "有沒有達到成功標準" : k); });
      if (/\d+\s*號/.test(f["命名候選"] || "")) miss.push("命名不能有座號");
    }
    return miss;
  }

  async function save(part, submit, btn) {
    if (busy) return;
    const fields = collect(part);
    if (submit) {
      const miss = missing(part, fields);
      if (miss.length) { alert(`還有這些沒完成：\n・${miss.join("\n・")}`); return; }
      if (!confirm(part === "plan"
        ? "送出後就不能修改，要等老師審核。確定送出計畫書嗎？"
        : "送出後就不能修改，要等老師裁決。確定送出成果回報單嗎？")) return;
    }
    busy = true;
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = submit ? "⏳ 送出中…" : "⏳ 暫存中…";
    let res;
    try {
      res = await api(submit ? "proposal_submit" : "proposal_save", { proposal_id: current?.id || "", part, fields });
    } catch { res = { ok: false, error: "連線失敗，內容還在畫面上，請確認網路後再按一次" }; }
    busy = false;
    btn.disabled = false; btn.textContent = label;

    if (res.proposal) { // 暫存成功或送出被擋（已先暫存）都會帶回最新內容
      current = res.proposal;
      const i = data.proposals.findIndex(x => x.id === current.id);
      if (i >= 0) data.proposals[i] = current; else data.proposals.push(current);
      data.can_start = false; render.startNew = false;
    }
    if (res.ok && res.submitted) {
      dirty = false;
      alert("📨 送出成功！等老師看完，回來這一頁就能看到結果。");
      render();
      return;
    }
    if (res.ok) {
      dirty = false;
      const tag = document.getElementById(`pp-saved-${part}`);
      if (tag) tag.textContent = `✅ 已暫存 ${hhmm(res.saved_at)}`;
      return;
    }
    if (res.proposal) dirty = false; // 被擋下的送出，內容其實已暫存
    alert(res.error || "操作失敗，請稍後再試");
    if (res.locked) reload();
  }

  // 從小小銀行按鈕過來：沿用同一分頁的登入
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SS_KEY) || "null"); } catch {}
  if (saved?.seat && saved?.code) enter(saved); else showLogin();
})();
