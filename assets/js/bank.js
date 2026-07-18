/* 小小銀行：崑山幣存摺（座號＋查詢碼解密）＋商店櫥窗＋兌換申請＋金融小知識輪播
   加密機制與學習報告相同（PBKDF2＋AES-GCM，data/bank/<座號>.json）
   兌換：登入後商店卡片出現「🛒 我要兌換」→ 送 Apps Script 代理寫入 Notion「🛒 兌換申請」
   （不直接扣款；老師在教師專區核可後才扣崑山幣＋扣庫存） */
(async () => {
  const c = await App.init("bank");
  const main = document.getElementById("main");

  // 商店資料（公開，無個資）
  let store = [];
  try { store = await App.fetchJSON("data/store.json"); } catch { /* 尚未上架 */ }

  // 金融小知識（中年級適齡，輪播）
  const TIPS = [
    "🐷 儲蓄小祕訣：先存一點點，再花剩下的，錢包才不會空空的！",
    "🌱 利息是什麼？把錢存在銀行，銀行會多給你一點點錢當謝禮，存越久長越多。",
    "🤔 買東西前先問自己：這是「需要」還是「想要」？需要先買，想要可以等一等。",
    "🎯 訂一個存錢目標（例如自由閱讀券），每週看存摺離目標越來越近，超有成就感！",
    "💪 崑山幣是用工作和好表現賺來的，每一枚都是你努力的證明。",
    "⏳ 忍住不馬上花掉，存久一點能換到更棒的東西——這叫「延宕滿足」，是超能力喔！",
  ];

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

  const TYPE_META = {
    "薪水": { icon: "💼", color: "#54A0FF" },
    "獎勵金": { icon: "🌟", color: "#1DD1A1" },
    "懲罰金": { icon: "⚠️", color: "#FF6B81" },
    "利息": { icon: "🌱", color: "#FECA57" },
    "消費": { icon: "🛍️", color: "#FF9F43" },
    "調整": { icon: "🔧", color: "#8395A7" },
  };

  // 登入狀態（成功解密存摺後才有；兌換申請需要 座號＋查詢碼＋餘額）
  let session = null; // { seat, code, balance }

  // 這台裝置本節課已申請過的品項（防連按重複申請；代理端另有 3 筆待處理上限）
  const requestedKey = item => `bankRedeem:${session?.seat}:${item.id}`;
  const alreadyRequested = item => !!sessionStorage.getItem(requestedKey(item));

  // 公開區：商店櫥窗＋小知識（表單下方常駐）；登入後多「我要兌換」鈕
  const storeSection = () => {
    const cats = [["特權", "🎟️ 特權商品"], ["小物", "🎁 可愛小物"]];
    const buyBtn = i => {
      if (!session || !i.id || !c.updateProxyUrl) return "";
      if (i.stock <= 0) return "";
      if (alreadyRequested(i)) return `<button class="store-buy" disabled>🕐 已申請，等老師確認</button>`;
      if (session.balance < i.price) return `<button class="store-buy" disabled title="崑山幣還不夠">🪙 還差 ${i.price - session.balance} 幣</button>`;
      return `<button class="store-buy" data-id="${App.esc(i.id)}">🛒 我要兌換</button>`;
    };
    const cards = cat => store.filter(i => i.category === cat).map(i => `
      <div class="store-card ${i.stock <= 0 ? "soldout" : ""}">
        <div class="store-icon">${App.esc(i.icon)}</div>
        <div class="store-name">${App.esc(i.name)}</div>
        <div class="store-price">🪙 ${i.price} 幣</div>
        <div class="store-stock">${i.stock <= 0 ? "😢 售完" : `庫存 ${i.stock}`}</div>
        ${i.note ? `<div class="store-note">${App.esc(i.note)}</div>` : ""}
        ${buyBtn(i)}
      </div>`).join("");
    return `
      <h3 class="bank-section-title">🏪 班級商店櫥窗</h3>
      ${session ? `<p class="meta">看到喜歡的就按「🛒 我要兌換」送出申請，老師確認後才會扣崑山幣喔！</p>` : ""}
      ${store.length ? cats.map(([cat, label]) => {
        const html = cards(cat);
        return html ? `<p class="bank-cat-label">${label}</p><div class="store-grid">${html}</div>` : "";
      }).join("") : `<p class="meta">商店籌備中，敬請期待！</p>`}
      <div class="bank-tip card" id="bank-tip">💡 ${App.esc(TIPS[0])}</div>`;
  };

  // 兌換申請：確認 → 送代理（品項與價格由代理以 Notion 商店為準重新驗證）
  const bindBuyButtons = () => {
    document.querySelectorAll(".store-buy[data-id]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const item = store.find(i => i.id === btn.dataset.id);
        if (!item || !session) return;
        if (!confirm(`要用 ${item.price} 枚崑山幣兌換「${item.name}」嗎？\n送出後等老師確認才會扣款喔！`)) return;
        btn.disabled = true; btn.textContent = "⏳ 申請中…";
        try {
          const res = await fetch(c.updateProxyUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "redeem_request", seat: session.seat, code: session.code, item_id: item.id }),
          }).then(r => r.json());
          if (res.ok) {
            sessionStorage.setItem(requestedKey(item), "1");
            btn.textContent = "🕐 已申請，等老師確認";
          } else {
            btn.disabled = false; btn.textContent = "🛒 我要兌換";
            alert(res.error || "申請失敗，請稍後再試");
          }
        } catch {
          btn.disabled = false; btn.textContent = "🛒 我要兌換";
          alert("連線失敗，請確認網路後再試一次");
        }
      });
    });
  };

  let tipTimer;
  const startTips = () => {
    clearInterval(tipTimer);
    let i = 0;
    tipTimer = setInterval(() => {
      const el = document.getElementById("bank-tip");
      if (!el) { clearInterval(tipTimer); return; }
      i = (i + 1) % TIPS.length;
      el.innerHTML = `💡 ${App.esc(TIPS[i])}`;
    }, 6000);
  };

  const showForm = (msg = "") => {
    session = null;
    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>🏦 小小銀行</h2>
      <div class="card report-gate">
        <p>輸入<strong>座號</strong>與<strong>查詢碼</strong>（和學習報告同一組），查看你的崑山幣存摺。</p>
        <form id="bank-form" class="report-form" autocomplete="off">
          <label>座號<input id="bk-seat" type="number" min="1" max="99" required inputmode="numeric" /></label>
          <label>查詢碼<input id="bk-code" type="password" required /></label>
          <button type="submit">📖 打開存摺</button>
        </form>
        ${msg ? `<p class="report-error">${msg}</p>` : ""}
        <p class="meta" style="margin-top:10px">🔒 存摺內容經加密保護；查詢碼請向老師索取，不要外流。</p>
      </div>
      ${storeSection()}`;
    startTips();
    document.getElementById("bank-form").addEventListener("submit", async e => {
      e.preventDefault();
      const seat = document.getElementById("bk-seat").value.trim();
      const code = document.getElementById("bk-code").value.trim();
      const btn = e.target.querySelector("button");
      btn.disabled = true; btn.textContent = "解密中…";
      try {
        const res = await fetch(`data/bank/${seat}.json`, { cache: "no-cache" });
        if (!res.ok) throw new Error("noseat");
        const acc = await decrypt(await res.json(), seat, code);
        session = { seat: Number(seat), code, balance: acc.balance };
        showPassbook(acc);
      } catch (err) {
        showForm(err.message === "noseat" ? "這個座號目前沒有帳戶，請確認座號或詢問老師。" : "查詢碼不正確，請再試一次或詢問老師。");
      }
    });
  };

  function showPassbook(acc) {
    const rows = acc.tx.slice(0, 30).map(t => {
      const m = TYPE_META[t.type] || TYPE_META["調整"];
      return `
        <tr>
          <td class="tx-date">${App.esc(App.fmtDateShort(t.date))}</td>
          <td><span class="tx-type" style="--tc:${m.color}">${m.icon} ${App.esc(t.type)}</span></td>
          <td class="tx-reason">${App.esc(t.reason)}</td>
          <td class="tx-amount ${t.amount >= 0 ? "plus" : "minus"}">${t.amount >= 0 ? "+" : ""}${t.amount}</td>
          <td class="tx-after">${t.after}</td>
        </tr>`;
    }).join("");

    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>🏦 小小銀行</h2>
      <div class="passbook">
        <div class="passbook-head">
          <div>
            <p class="passbook-owner">👤 ${App.esc(acc.name)}（${acc.seat} 號）的存摺</p>
            <p class="meta">共 ${acc.tx.length} 筆交易${acc.tx.length > 30 ? "，以下顯示最近 30 筆" : ""}</p>
          </div>
          <div class="passbook-balance">
            <span>目前餘額</span>
            <strong>🪙 ${acc.balance}</strong>
          </div>
          <button id="bank-exit" class="report-exit">🔒 離開</button>
        </div>
        ${acc.tx.length ? `
        <table class="passbook-table">
          <thead><tr><th>日期</th><th>類型</th><th>事由</th><th>金額</th><th>餘額</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>` : `<p class="meta" style="padding:12px">還沒有任何交易，開始工作賺崑山幣吧！</p>`}
        <p class="report-footnote">本存摺僅供 ${App.esc(acc.name)} 同學與家長參考，請勿外傳。　${App.esc(c.schoolYear)} ${App.esc(c.className)}</p>
      </div>
      ${storeSection()}`;
    startTips();
    bindBuyButtons();
    document.getElementById("bank-exit").onclick = () => showForm();
  }

  showForm();
})();
