/* 📋 課堂作答弱點分析的畫面（CG 線 P2d，老師 2026-10-23 範本定案：`教學簡報/_工具/改版提案_單節課簡報/範本_P2d弱點分析_示意.html`）
 * 資料是 sync 端算好的（規則正本 scripts/classos/lib/assess-weak.mjs），這裡只畫、不重算（U83）。
 *  - teacher(A, wi)：教師專區儀表板（教師口令加密檔 assess）——全班知識點長條、知識點×節次、座號×知識點。
 *  - parent(a)：學習報告每週期別（查詢碼加密檔 period.assess）——只看自己，不放全班、不排名。
 * rate＝null 代表不到 3 題（資料不足）；低於 60% 標 ⚠／▼。
 */
(function () {
  "use strict";
  const LOW = 60;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const md = d => String(d || "").slice(5).replace("-", "/");
  const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
  const step = p => RAMP[p < 40 ? 0 : p < 55 ? 1 : p < 70 ? 2 : p < 80 ? 3 : p < 90 ? 4 : 5];
  const inkOn = p => p >= 70 ? "#fff" : "#0b0b0b";
  const detail = a => `答對 ${a.o}・答錯 ${a.x}・未答 ${a.n}（共 ${a.rec} 題次）`;

  function css() {
    if (document.getElementById("assess-css")) return;
    const st = document.createElement("style"); st.id = "assess-css";
    st.textContent = `
.av-bars{display:grid;gap:8px}
.av-bar{display:grid;grid-template-columns:5.5em 1fr 9.5em;align-items:center;gap:10px}
.av-bar .k{font-weight:600}
.av-track{position:relative;height:20px;background:#efeeea;border-radius:4px}
.av-fill{position:absolute;left:0;top:0;bottom:0;background:#3987e5;border-radius:0 4px 4px 0}
.av-m60{position:absolute;top:-4px;bottom:-4px;border-left:2px dashed #7a7974}
.av-v{color:#52514e;font-variant-numeric:tabular-nums;font-size:.92em}
.av-w{color:#d03b3b;font-weight:700}
.av-insuf .av-fill{width:100%!important;background:repeating-linear-gradient(45deg,#e6e5e1 0 6px,transparent 6px 10px)}
.av-scroll{overflow-x:auto}
.av-tbl{border-collapse:separate;border-spacing:2px;font-variant-numeric:tabular-nums}
.av-tbl th,.av-tbl td{padding:4px 7px;text-align:center;border-radius:4px;font-size:.88rem}
.av-tbl th{color:#52514e;font-weight:600;white-space:nowrap}
.av-tbl td{min-width:54px}
.av-tbl td.na{background:#f0efec;color:#7a7974}
.av-tbl td.low{outline:2px solid #d03b3b;outline-offset:-2px}
.av-tbl td.low::after{content:" ▼";color:#d03b3b;font-size:.75em}
.av-legend{display:flex;flex-wrap:wrap;gap:12px;align-items:center;color:#52514e;font-size:.82rem;margin:.5em 0 0}
.av-sw{display:inline-block;width:13px;height:13px;border-radius:3px;vertical-align:-2px;margin-right:4px}
.av-ramp{display:inline-flex}.av-ramp i{width:20px;height:11px;display:inline-block}
.av-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 12px}
.av-kpi{border:1px solid #e6e2d6;border-radius:10px;padding:8px 12px}.av-kpi b{display:block;font-size:1.5rem;line-height:1.2}.av-kpi span{color:#52514e;font-size:.85rem}
.av-two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.av-subj{font-weight:700;margin:.4em 0 .3em}
@media (max-width:700px){.av-two{grid-template-columns:1fr}.av-bar{grid-template-columns:4.5em 1fr 7.5em}}`;
    document.head.appendChild(st);
  }

  /* 一組知識點長條（不到 3 題排最後、其餘由低到高） */
  function bars(list, withSubj) {
    return `<div class="av-bars">${[...list].sort((a, b) => ((a.rate == null) - (b.rate == null)) || (a.rate ?? 0) - (b.rate ?? 0)).map(a => {
      const no = a.rate == null, w = !no && a.rate < LOW;
      return `<div class="av-bar${no ? " av-insuf" : ""}" title="${esc((withSubj ? a.subj + "・" : "") + a.kp)}：${esc(detail(a))}${no ? "（不到 3 題，不下判斷）" : ""}">
        <span class="k">${esc(withSubj ? `${a.subj.slice(0, 1)}・${a.kp}` : a.kp)}</span>
        <span class="av-track"><span class="av-fill" style="width:${no ? 100 : a.rate}%"></span><span class="av-m60" style="left:${LOW}%"></span></span>
        <span class="av-v">${no ? `資料不足（${a.rec} 題）` : `${w ? `<span class="av-w">⚠ ${a.rate}%</span>` : `${a.rate}%`}　${a.o}/${a.rec}`}</span></div>`;
    }).join("")}</div>`;
  }
  const legend = warnText => `<div class="av-legend"><span><i class="av-sw" style="background:#3987e5"></i>得分率</span><span><i class="av-sw" style="border-left:2px dashed #7a7974;width:2px;border-radius:0"></i>60% 參考線</span><span><span class="av-w">⚠</span> 低於 60%，${warnText}</span><span><i class="av-sw" style="background:repeating-linear-gradient(45deg,#7a7974 0 2px,transparent 2px 5px)"></i>不到 3 題＝資料不足</span></div>`;
  const cell = (a, t, low) => {
    if (!a) return `<td class="na" title="${esc(t)}：這節沒考">—</td>`;
    if (a.rate == null) return `<td class="na" title="${esc(t)}：${esc(detail(a))}">不足</td>`;
    return `<td class="${low && a.rate < LOW ? "low" : ""}" title="${esc(t)}：${esc(detail(a))}" style="background:${step(a.rate)};color:${inkOn(a.rate)}">${a.rate}%</td>`;
  };

  /* 教師版：A＝儀表板 assess（依週，舊→新）；wi＝選的週 index */
  function teacher(A, wi) {
    css();
    if (!A || !A.length) return `<div class="dash-card" style="margin-top:12px"><h4>📋 課堂作答弱點分析</h4>
      <p class="meta">還沒有課堂作答紀錄。上課時用電子白板「📋 記錄本題」，收班送出、同步班網後就會出現。</p></div>`;
    const W = A[wi], multi = new Set(W.classKp.map(k => k.subj)).size > 1;
    const key = a => `${a.subj}|${a.kp}`;
    const kps = [...W.classKp].sort((a, b) => ((a.rate == null) - (b.rate == null)) || (a.rate ?? 0) - (b.rate ?? 0));
    const weakest = kps.find(k => k.rate != null);
    const name = a => multi ? `${a.subj.slice(0, 1)}・${a.kp}` : a.kp;
    const seats = Object.keys(W.bySeat).map(Number).sort((a, b) => a - b);
    const lessonTbl = `<tr><th>知識點</th>${W.lessons.map(l => `<th>${esc(l.lesson)}<br><small>${md(l.date)}・${l.n} 人</small></th>`).join("")}</tr>` +
      kps.map(k => `<tr><th>${esc(name(k))}</th>${W.lessons.map(l => cell(l.kp.find(x => key(x) === key(k)), `${l.lesson}｜${name(k)}`, false)).join("")}</tr>`).join("");
    const seatTbl = `<tr><th>座號</th>${kps.map(k => `<th>${esc(name(k))}</th>`).join("")}</tr>` +
      seats.map(s => `<tr><th>${s}</th>${kps.map(k => {
        const a = W.bySeat[s].find(x => key(x) === key(k));
        return a ? cell(a, `${s} 號｜${name(k)}`, true) : `<td class="na" title="${s} 號｜${esc(name(k))}：沒有作答紀錄">不足</td>`;
      }).join("")}</tr>`).join("");
    return `<div class="dash-card" style="margin-top:12px" id="assess-sec">
      <h4>📋 課堂作答弱點分析 <small>電子白板「記錄本題」的作答明細；未答算在分母</small>
        ${A.length > 1 ? `<select data-aw style="float:right">${A.map((x, i) => `<option value="${i}"${i === wi ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select>` : `<span class="meta" style="float:right">${esc(W.label)}</span>`}</h4>
      <div class="av-kpis">
        <div class="av-kpi"><b>${W.lessons.length} 節</b><span>本週有記錄的節次</span></div>
        <div class="av-kpi"><b>${W.rows} 筆</b><span>作答紀錄（每生每節 1 筆）</span></div>
        <div class="av-kpi"><b>${W.overall ?? "—"}%</b><span>全班整體得分率</span></div>
        <div class="av-kpi"><b>${weakest ? `${esc(name(weakest))} ${weakest.rate}%` : "—"}</b><span>最需要補強的知識點</span></div>
      </div>
      <h4 style="margin-top:4px">全班：各知識點得分率</h4>${bars(W.classKp, multi)}${legend("建議重講或補救")}
      <h4 style="margin-top:14px">全班：知識點 × 節次</h4>
      <div class="av-scroll"><table class="av-tbl">${lessonTbl}</table></div>
      <div class="av-legend"><span>得分率</span><span class="av-ramp">${RAMP.map(c => `<i style="background:${c}"></i>`).join("")}</span><span>低 → 高</span><span><i class="av-sw" style="background:#f0efec"></i>這節沒考／不足</span></div>
      <h4 style="margin-top:14px">座號 × 知識點 <small>只在教師專區</small></h4>
      <div class="av-scroll"><table class="av-tbl">${seatTbl}</table></div>
      <div class="av-legend"><span><i class="av-sw" style="outline:2px solid #d03b3b;outline-offset:-2px"></i>▼ 低於 60%（且至少 3 題）</span><span><i class="av-sw" style="background:#f0efec"></i>不足＝不到 3 題，不下判斷</span></div>
    </div>`;
  }

  /* 家長版：a＝period.assess（只有自己那週） */
  function parent(a) {
    css();
    if (!a || !a.subjects?.length) return "";
    const multi = a.subjects.length > 1;
    const left = a.subjects.map(s => `${multi ? `<div class="av-subj">${esc(s.subj)}</div>` : ""}${bars(s.kp, false)}`).join("");
    const subjName = a.subjects.map(s => s.subj).join("、");
    const right = `<p style="margin-top:0"><b>本週課堂作答（${esc(subjName)}）</b></p>` +
      (a.strong.length ? `<p>👍 ${esc(a.strong.join("、"))}掌握得很穩。</p>` : "") +
      (a.weak.length ? `<p>📌 ${esc(a.weak.join("、"))}還不太熟，建議回家一起看課本的例句、練習 2–3 題。</p>`
        : `<p>有判斷的知識點都在 60% 以上，維持上課專心作答的習慣。</p>`) +
      (a.few.length ? `<p class="av-v">${esc(a.few.join("、"))}本週題數不到 3 題，先不判斷。</p>` : "");
    return `<div class="report-box" style="--bc:#3987e5">
      <span class="report-badge" style="--bc:#3987e5">📋 本週課堂作答（知識點）</span>
      <div class="av-two"><div>${left}</div><div>${right}</div></div>
      ${legend("需要多練習")}
      <p class="av-v" style="margin:.5em 0 0">上課時全班舉卡作答、老師當場記錄。得分率＝答對 ÷（答對＋答錯＋沒作答），缺席的題目不算。只看孩子自己，不放全班平均、不排名。</p>
    </div>`;
  }

  window.AssessView = { teacher, parent };
})();
