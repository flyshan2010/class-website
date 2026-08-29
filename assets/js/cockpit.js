/* 🚀 教學駕駛艙：老師上課前打開的「今天要教什麼」單一入口
   ─────────────────────────────────────────────────────────
   兩種檢視（分頁切換）
   ① 📅 行事曆（預設）：選一天 → 由早到晚的節次時間軸，每節掛上該節進度與五段教材連結
   ② 📚 依單元    ：原本的「科目 → 單元 → 課卡」摺疊清單，備課找教材時用

   資料來源
   ・data/daily-plan.json   每週每科要教的內容（由 scripts/build-daily-plan.py 從進度表 xlsx 產生，
                            **不含節次對齊**）
   ・data/schedule.json     日課表（節次時間、每天每節的科目／老師／教室；Notion 每天自動同步）
   ・data/morning-launch.json 早自修 SEL 微儀式（五個主題日 × 四步驟）
   ・data/lessons.json      教學單元與五段連結（Notion「🚀 教學單元」勾「顯示」者，無個資）

   節次對齊在這裡即時算（見 alignWeek）——不是事先算好存檔。
   因為日課表是 Notion 每天自動同步下來的，隨時可能變；若把進度釘死在「第七節」這種
   節次名上，日課表一改就只有一半資料被更新，會把數學進度掛到資訊課那一格而毫無警告
   （2026-08-07 實測確認過的錯法）。改成開頁時依當下的日課表現算，日課表怎麼改都自動跟上。

   時間規則（使用者指定）
   ・已過的日期整頁變暗，一眼看得出不是今天
   ・「今天」只留還沒上的節次，上完的自動收起（可按「顯示全天」攤開回看）
   ・過去／未來的日期一律完整顯示，避免翻回去查卻是空的 */
(async () => {
  await App.init("cockpit");

  const [planDoc, sched, ml, lessons] = await Promise.all([
    App.fetchJSON("data/daily-plan.json").catch(() => ({ days: [], weeks: {} })),
    App.fetchJSON("data/schedule.json").catch(() => ({ periods: [], table: [] })),
    App.fetchJSON("data/morning-launch.json").catch(() => null),
    App.fetchJSON("data/lessons.json").catch(() => []),
  ]);
  const days = planDoc.days || [];
  const dayByDate = new Map(days.map(d => [d.date, d]));

  /* ── 節次對齊（每次開頁依當下的日課表現算） ─────────────────
     日課表裡「導師自己上、且進度表有寫」的科目才會被排進度；科任課只顯示科目與教室。
     科目比對去掉括號註記，所以進度表的「英語」對得上日課表的「英語(彈性)」。 */
  const SUBJ_BASE = s => App.subjBase(s);
  const slots = {};                       // {科目: [{dow, period, order}]}，依星期、節次排好
  sched.periods.forEach((p, i) => {
    (sched.table[i] || []).forEach((cell, d) => {
      if (cell && typeof cell === "object" && cell.subject) {
        const k = SUBJ_BASE(cell.subject);
        (slots[k] = slots[k] || []).push({ dow: d + 1, period: p.name, order: i });
      }
    });
  });
  Object.values(slots).forEach(a => a.sort((x, y) => x.dow - y.dow || x.order - y.order));

  /* ── 日課表節數護欄 ─────────────────────────────────────────
     進度對齊完全依賴日課表，所以日課表被改錯的後果是安靜的：某科少排一節，
     那一科每週就有一節進度默默掉進「彈性補充」，畫面上不會說哪裡不對。
     這裡拿排課的固定節數規則（schedule.json 的 weeklyRules，正本在 scripts/sync-notion.mjs
     的 SCHEDULE_META，repo 管理、Notion 同步不會覆蓋）對一次，對不上就在頁面頂端標出來。
     英語是「正課 1 節＋彈性 1 節」，所以用 App.subjKey 比對（保留彈性身分、只統一寫法），
     不像進度對齊那樣連彈性註記都去掉；老師把「(彈性)」改寫成「(彈)」不會再跳假警示。
     同節並排的第二科（本土語分流那種）不計入節數——那節的主課程只有一個。
     只在駕駛艙顯示——這是教師端的資料檢查，班網日課表頁家長也看得到，不適合出現在那裡。 */
  const scheduleAudit = () => {
    const rules = sched.weeklyRules || {};
    if (!Object.keys(rules).length) return "";
    const cnt = {};
    (sched.table || []).forEach(row => (row || []).forEach(c => {
      if (c && typeof c === "object" && c.subject) {
        const k = App.subjKey(c.subject);
        cnt[k] = (cnt[k] || 0) + 1;
      }
    }));
    const bad = Object.entries(rules)
      .map(([subject, want]) => ({ subject: App.subjKey(subject), want, got: cnt[App.subjKey(subject)] || 0 }))
      .filter(x => x.got !== x.want);
    if (!bad.length) return "";
    const others = Object.keys(cnt).filter(s => !(s in rules));
    return `
      <div class="cp-audit">
        <strong>⚠️ 日課表節數與排課規則不符</strong>
        <ul>${bad.map(x => `<li>${App.esc(x.subject)}：應 ${x.want} 節，日課表排了 <b>${x.got}</b> 節</li>`).join("")}</ul>
        <p class="meta">節數不對，該科每週會有進度排不進節次（掉到下方「彈性補充」）。
        到 Notion「🕐 日課表」改好後按「立即更新班網」即可。${others.length
          ? `<br>未列入檢查的彈性課程：${others.map(App.esc).join("、")}。` : ""}</p>
      </div>`;
  };

  /* 進度表每科每天各寫一條（一週 5 條），但日課表的實際節數不見得是 5（國語 5、數學 4、社會 3）。
     對齊規則：
       ① 該週該科若有條目標了「第N節：」，就只有那些是正課（社會的課前預習／知識延伸不佔節次）；
          沒有任何標記的科目（國語、數學）則全部依序當正課。這是看資料寫法，不綁定特定科目。
       ② 正課依序填進該科當週實際可用的節次（放假日不佔節次）；正課填完還有空節次，
          就接著把非正課的條目也填進去（換班級時某科節數較多才會遇到，免得節次空著）。
       ③ 填不下的 → 該週「彈性補充」，列出來讓老師自己決定要不要挪，不靜默丟掉。 */
  const SECTION_RE = /第\s*\d+\s*節\s*[：:]/;
  // UTC 計算，避免看網頁的裝置時區不同就把星期算歪（同 sync-notion.mjs 的理由）
  const dowOf = iso => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const alignCache = new Map();
  /* 對齊規則（2026-08-21 改為「日期優先」）
     ① 進度寫哪一天，就先掛那天該科的節次——老師在 Notion 拖一下日期，班網就真的跟著調動。
     ② 那天沒有該科的課（調課、放假、日課表換了）才依序遞補到本週剩下的節次，
        遞補順序仍是「正課優先」，節次不夠時保住正課、彈性內容才落到本週彈性補充。
     ③ 全程不看「第幾節」這種節次名，只看當下的日課表 —— 換一份真的日課表不必重排任何進度。 */
  const alignWeek = week => {
    if (alignCache.has(week)) return alignCache.get(week);
    const wk = (planDoc.weeks || {})[String(week)] || {};
    const holidays = new Set(days.filter(d => d.week === week && d.holiday).map(d => d.dow));
    const plan = new Map();               // "星期|節次名" → {subject, text, unit}
    const extras = [];
    Object.keys(wk).forEach(subject => {
      const entries = wk[subject] || [];
      if (!entries.length) return;
      const marked = entries.filter(e => SECTION_RE.test(e.text));
      const core = marked.length ? marked : entries;
      const ordered = [...core, ...entries.filter(e => !core.includes(e))];
      const avail = (slots[subject] || []).filter(s => !holidays.has(s.dow));
      const taken = new Set();            // 已被占用的 avail index
      const put = (idx, e) => {
        taken.add(idx);
        plan.set(`${avail[idx].dow}|${avail[idx].period}`, { subject, text: e.text, unit: e.unit || "", date: e.date || "" });
      };
      // ① 日期優先：同一天有幾節就依序吃掉幾筆（同日多筆進度時按原順序）
      const rest = [];
      for (const e of ordered) {
        const d = e.date ? dowOf(e.date) : 0;
        const idx = avail.findIndex((s, k) => !taken.has(k) && s.dow === d);
        if (idx >= 0) put(idx, e); else rest.push(e);
      }
      // ② 沒對上日期的，依序遞補剩下的節次
      let k = 0;
      for (const e of rest) {
        while (k < avail.length && taken.has(k)) k++;
        if (k >= avail.length) { extras.push({ subject, text: e.text, date: e.date, unit: e.unit || "" }); continue; }
        put(k, e);
      }
    });
    extras.sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Set();
    const uniq = extras.filter(e => {
      const key = `${e.subject}|${e.text}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
    const out = { plan, extras: uniq };
    alignCache.set(week, out);
    return out;
  };

  /* 科目色與圖示：前段是 Notion「🚀 教學單元」用的領域名（依單元檢視），
     後段是日課表 data/schedule.json 用的課名（行事曆檢視的科任課）。 */
  const SUBJECT_COLOR = {
    "國語": "#FF6B81", "數學": "#54A0FF", "社會": "#FF9F43", "自然": "#1DD1A1",
    "英語": "#5F27CD", "健體": "#FECA57", "藝術": "#FF9FF3", "綜合": "#8395A7", "其他": "#8395A7",
    "體育": "#FECA57", "健康": "#FECA57", "崑山活力Go": "#FECA57",
    "音樂": "#48DBFB", "視覺藝術": "#FF9FF3", "玩美": "#FF9FF3",
    "本土語": "#c99a3a", "資訊": "#8395A7",
  };
  const SUBJECT_ORDER = ["國語", "數學", "社會", "自然", "英語", "健體", "藝術", "綜合", "其他"];
  const SUBJECT_ICON = {
    "國語": "📖", "數學": "🔢", "社會": "🗺️", "自然": "🔬",
    "英語": "🔤", "健體": "🤸", "藝術": "🎨", "綜合": "🧩", "其他": "📦",
    "體育": "🤸", "健康": "💪", "崑山活力Go": "🏃",
    "音樂": "🎵", "視覺藝術": "🎨", "玩美": "🖌️",
    "本土語": "🗣️", "資訊": "💻",
  };
  const STATUS_META = {
    "進行中": { icon: "🔥", style: "background:#d0ebff;color:#1864ab" },
    "備課中": { icon: "🌱", style: "background:#fff3bf;color:#8a6d00" },
    "已完成": { icon: "✅", style: "background:#e9ecef;color:#666" },
  };
  const STAGES = ["起始評估", "課程教學", "差異化指導", "學習評量", "成果回流"];
  const LINKS = [
    ["pretest", "0 📝 起始評估"],
    ["site", "1 🖥️ 教學網站"],
    ["differentiated", "2 🎯 差異化教材"],
    ["review", "3 🔁 複習素材"],
    ["exam", "4 💯 單元評量"],
    ["material", "5 📚 原教材"],
  ];

  /* ── 教材對應 ─────────────────────────────────────────────
     把進度表的一句話（「第三課 鏡頭下的家鄉 — 週三：文本形式深究」）換算成
     lessons.json 的課次代碼（國L3-3），才能把五段連結掛到對的節次上。 */
  // 節次代碼末尾可帶一個字母（數L6-2a／2b＝同一小節拆成兩節），不然這兩列會整個抓不到代碼
  const CODE_RE = /(?:^|\s)((?:國|數|社|自|英|健康|藝|綜)[A-Za-z]*\d+(?:-\d+)*[A-Za-z]?|SEL\d+(?:-\d+)*)(?=\s|$)/;
  const codeOf = l => (CODE_RE.exec(l.title || "") || [])[1] || "";
  const lessonByCode = new Map();
  lessons.forEach(l => { const c = codeOf(l); if (c && !lessonByCode.has(c)) lessonByCode.set(c, l); });
  /* 拆節變體索引：數L8-3 → [數L8-3a, 數L8-3b]。
     課本一個小節備課時拆成兩節（8-3a／8-3b）是常態，但進度表寫的還是「8-3」，
     沒有這張表就會出現「教材明明做好了卻說尚未建立」。有了它，lesson-flow 一建好
     變體課次，駕駛艙下次同步就自動掛上，不必再回頭去 Notion 補 relation。 */
  const variantsByBase = new Map();
  lessons.forEach(l => {
    const c = codeOf(l);
    const m = /^(.*\d)[A-Za-z]$/.exec(c);
    if (!m) return;
    if (!variantsByBase.has(m[1])) variantsByBase.set(m[1], []);
    variantsByBase.get(m[1]).push(l);
  });
  /* 複習卷分輪索引：國R2 → [國R2-1, 國R2-2, …]。複習週一科十幾節，教材一定分輪做，
     但進度表那句話只還原得出 `國R2`。只收 R 卷（`<科目>R<1|2>-<輪>`），不動正課的
     `數L8-1` 那種小節編號——正課的單元層對應走 mathUnitCode，兩者不可混在同一張表。 */
  const R_PART_RE = /^((?:國|數|社|自|英|健康)R\d)-(\d+)[A-Za-z]?$/;
  lessons.forEach(l => {
    const m = R_PART_RE.exec(codeOf(l));
    if (!m) return;
    if (!variantsByBase.has(m[1])) variantsByBase.set(m[1], []);
    variantsByBase.get(m[1]).push(l);
  });
  // 排序要用數字：`國R2-10` 不能排在 `國R2-2` 前面（字串比對會排錯）
  const variantKey = l => {
    const c = codeOf(l);
    const m = R_PART_RE.exec(c);
    return m ? String(Number(m[2])).padStart(3, "0") : c;
  };
  variantsByBase.forEach(arr => arr.sort((a, b) => variantKey(a).localeCompare(variantKey(b))));
  // 先找完全相同的代碼，找不到才退回拆節變體（可能一次回傳 a、b 兩節）
  const resolveLessons = code => {
    const exact = lessonByCode.get(code);
    if (exact) return [exact];
    const split = variantsByBase.get(code);
    if (split && split.length) return split.slice();
    // 反向：進度表指到 8-3a，但教材後來合併回一份 8-3——去掉尾碼再找一次
    const m = /^(.*\d)[A-Za-z]$/.exec(code);
    const merged = m && lessonByCode.get(m[1]);
    return merged ? [merged] : [];
  };

  /* 數學「單元內練習」索引：練習園地(七)、單元七全等實作與複習、綜合練習(二) 這類
     沒有小節編號的節次，掛回該單元**最後一小節**的教材（那份本來就含綜合練習與評量）。
     只記錄各單元編號最大的小節（含拆節尾碼），單元還沒備課就回傳單元代碼讓畫面顯示「尚未建立」。 */
  const mathUnitLast = new Map();
  lessons.forEach(l => {
    const m = /^數L(\d+)-(\d+)([A-Za-z]?)$/.exec(codeOf(l));
    if (!m) return;
    const key = m[1], rank = Number(m[2]) * 100 + (m[3] ? m[3].toLowerCase().charCodeAt(0) - 96 : 0);
    const prev = mathUnitLast.get(key);
    if (!prev || rank > prev.rank) mathUnitLast.set(key, { rank, code: `數L${m[1]}-${m[2]}` });
  });
  const mathUnitCode = n => (mathUnitLast.get(String(n)) || {}).code || `數L${n}`;

  const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const cnNum = s => {                               // 「十二」→12、「三」→3
    if (/^\d+$/.test(s)) return Number(s);
    if (s.length === 1) return CN_NUM[s] || 0;
    if (s[0] === "十") return 10 + (CN_NUM[s[1]] || 0);
    if (s[1] === "十") return (CN_NUM[s[0]] || 0) * 10 + (CN_NUM[s[2]] || 0);
    return 0;
  };
  // 國語一課拆四節（字詞語詞及大意／內容理解／形式深究／綜合整理）＝週一～週四；
  // 週五是「課後評量與驗收」，教材沿用第四節那份（綜合整理內含評量卷）。
  const CHI_DAY_TO_PART = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 4 };

  /* 對應教材：Notion「📅 每日課程進度」的『◯◯單元』relation 是唯一正解（entry.unit），
     沒填才退回下面的文字正則猜測，並在畫面標「自動推測」——
     漏填一眼看得出來，而下學期還沒備課的課次（單元列還沒建，relation 填不了）
     也能靠正則先掛上，等 lesson-flow 一建好單元就自動接上。 */
  /* 複習課代碼：`<科目>R<1=期中／2=期末>`（國R1「期中總複習｜L1～L6」等已建）。
     進度表的複習週寫法五花八門（「期末國語總複習」「L6-L10觀念統整複習」「考前觀念澄清」…），
     一律收斂到同一個 R 代碼，教材一建好就自動掛上，不必逐列去 Notion 指定。 */
  const REVIEW_RE = /複習|統整|衝刺|模擬測驗|測驗|訂正|強化|驗收|考前|脈絡整理|澄清|疑難解答/;
  // 「第七單元…單元七全等實作與複習」「練習園地(七)」是單一單元內的複習，屬該單元不屬 R 卷
  const ONE_UNIT_RE = /第[一二三四五六七八九十\d]+單元|單元[一二三四五六七八九十](?![一二三四五六七八九十])|練習園地/;
  // 考後的寒假銜接、閱讀分享不是複習課
  const AFTER_EXAM_RE = /寒假|暑假|閱讀分享|生活應用|課程總結|自主學習/;
  /* 期中／期末的分界自己從進度表長出來：最後一筆標「期中」的日期之後就是期末，
     換學年、考程挪動都不必回來改常數。 */
  const midtermEnd = (() => {
    let last = "";
    Object.values(planDoc.weeks || {}).forEach(subs => Object.values(subs || {}).forEach(es => (es || []).forEach(e => {
      if (/期中/.test(e.text || "") || /R1$/.test(e.unit || "")) last = (e.date || "") > last ? e.date : last;
    })));
    return last;
  })();
  const SUBJECT_ABBR = { 國語: "國", 數學: "數", 社會: "社", 自然: "自", 英語: "英", 健康: "健康" };
  const matchReview = (subject, text, date) => {
    const t = text || "";
    if (AFTER_EXAM_RE.test(t) || !REVIEW_RE.test(t)) return null;
    if (ONE_UNIT_RE.test(t) && !/期中|期末|考前/.test(t)) return null;
    const abbr = SUBJECT_ABBR[subject];
    if (!abbr) return null;
    const term = /期末|考前/.test(t) ? 2
      : /期中/.test(t) ? 1
      : (midtermEnd && date && date > midtermEnd) ? 2 : 1;
    return `${abbr}R${term}`;
  };

  /* 兩張由進度表自己長出來的索引（換學年、挪課都不必改程式）：
     ・chiSeq：`日期|課號` → 該課在同一週已出現幾次，用來補「沒寫週X」的國語節次
     ・mathUnitByDate：日期 → 當天（含之前）最後上過的數學單元編號，給沒寫單元的綜合練習用 */
  const chiSeq = new Map();
  const mathUnitByDate = new Map();
  (() => {
    Object.values(planDoc.weeks || {}).forEach(subs => {
      const seen = new Map();                       // 同一週內：課號 → 已出現次數
      ((subs || {})["國語"] || []).slice()
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .forEach(e => {
          const c = /第([一二三四五六七八九十]+)課/.exec(e.text || "");
          if (!c) return;
          const n = cnNum(c[1]);
          chiSeq.set(`${e.date}|${n}`, seen.get(n) || 0);
          seen.set(n, (seen.get(n) || 0) + 1);
        });
    });
    const math = [];
    Object.values(planDoc.weeks || {}).forEach(subs => math.push(...((subs || {})["數學"] || [])));
    math.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    let last = 0;
    math.forEach(e => {
      const t = e.text || "";
      const m = /(?:^|[\s—－-])(\d+)-\d+/.exec(t);
      const u = /第([一二三四五六七八九十\d]+)單元|單元([一二三四五六七八九十\d]+)/.exec(t);
      if (m) last = Number(m[1]);
      else if (u) last = cnNum(u[1] || u[2]);
      if (last) mathUnitByDate.set(e.date, last);
    });
  })();

  const matchLesson = (subject, text, unit, date) => {
    if (unit) return { lessons: resolveLessons(unit), code: unit, isExam: false, sure: true };
    const t = text || "";
    if (subject === "國語") {
      /* 認不出課次時不要 return null——後面還有複習週的 R 卷規則要跑 */
      const c = /第([一二三四五六七八九十]+)課/.exec(t);
      if (c) {
      const d = /週([一二三四五])[：:]/.exec(t);
      /* 進度表偶爾整週寫同一句（第十二課那五列沒有「週X：」），
         就用該課在同一週的出現順序當節次；第五節照樣沿用第四節教材。 */
      const part = d ? CHI_DAY_TO_PART[d[1]]
        : Math.min(4, (chiSeq.get(`${date}|${cnNum(c[1])}`) || 0) + 1);
      if (!part) return null;
      const code = `國L${cnNum(c[1])}-${part}`;
      return { lessons: resolveLessons(code), code, isExam: d ? d[1] === "五" : part === 4, sure: false };
      }
    }
    if (subject === "數學") {
      const m = /(?:^|[\s—－-])(\d+)-(\d+)/.exec(t);
      if (m) {
        const code = `數L${Number(m[1])}-${Number(m[2])}`;
        return { lessons: resolveLessons(code), code, isExam: false, sure: false };
      }
      /* 單元內練習（練習園地(七)／單元七全等實作與複習／綜合練習(二)）：
         寫了單元編號就用那一單元，沒寫就沿用當天之前最後上過的單元，
         一律掛該單元最後一小節的教材。 */
      const u = /第([一二三四五六七八九十\d]+)單元|單元([一二三四五六七八九十\d]+)/.exec(t);
      if (u || /綜合練習|練習園地/.test(t)) {
        const n = u ? cnNum(u[1] || u[2]) : (mathUnitByDate.get(date) || 0);
        if (n) {
          const code = mathUnitCode(n);
          return { lessons: resolveLessons(code), code, isExam: false, sure: false };
        }
      }
    }
    if (subject === "社會") {
      // 一週三節上一小節，寫法固定「3-2 …」；認不出來就往下走複習週規則
      const m = /^\s*(\d+)-(\d+)/.exec(t);
      if (m) {
        const code = `社${Number(m[1])}-${Number(m[2])}`;
        return { lessons: resolveLessons(code), code, isExam: false, sure: false };
      }
    }
    /* 複習週擺最後：先讓正課的課次規則吃飽（「週五：課後評量與驗收」有「驗收」兩字，
       但它是第八課的第四節，不是期末複習卷），正課認不出來才收斂到 R 卷。 */
    const rv = matchReview(subject, t, date);
    if (rv) return { lessons: resolveLessons(rv), code: rv, isExam: false, sure: false };
    return null;
  };

  /* ── 時間工具 ───────────────────────────────────────────── */
  const todayISO = App.todayISO();
  const nowMin = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
  const toMin = hhmm => { const m = /(\d{1,2}):(\d{2})/.exec(hhmm || ""); return m ? +m[1] * 60 + +m[2] : null; };
  const periodEnd = p => toMin((p.time || "").split(/[-–~]/)[1]);

  /* 預設日期：今天有課就今天；沒有就跳到最近的下一個上課日（學期結束後退回最後一天） */
  const defaultDate = () => {
    if (dayByDate.has(todayISO)) return todayISO;
    const next = days.find(d => d.date >= todayISO);
    return next ? next.date : (days.length ? days[days.length - 1].date : todayISO);
  };
  /* 網址可帶 ?date=YYYY-MM-DD 直接開某一天（方便把某天加書籤或貼給代課老師）；
     切換日期時同步改寫網址，重新整理不會跳回今天。 */
  const qsDate = new URLSearchParams(location.search).get("date");
  let selected = (qsDate && dayByDate.has(qsDate)) ? qsDate : defaultDate();
  let showAll = false;                       // 今天是否攤開已上完的節次
  let viewMonth = selected.slice(0, 7);      // 月曆顯示的月份 YYYY-MM
  const syncURL = () => {
    const u = new URL(location.href);
    u.searchParams.set("date", selected);
    history.replaceState(null, "", u);
  };

  /* ── 月曆（找某一天用） ───────────────────────────────────── */
  const monthGrid = () => {
    const [y, m] = viewMonth.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7;          // 以週一為每週第一天
    const total = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cp-cell blank"></div>');
    for (let d = 1; d <= total; d++) {
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const day = dayByDate.get(iso);
      const cls = ["cp-cell"];
      if (!day) cls.push("off");                     // 沒有課程安排的日子（週末／寒暑假）
      if (day?.holiday) cls.push("holiday");
      if (iso < todayISO) cls.push("past");
      if (iso === todayISO) cls.push("today");
      if (iso === selected) cls.push("sel");
      const tag = day ? (day.holiday ? "🏖" : `W${day.week}`) : "";
      cells.push(day
        ? `<button type="button" class="${cls.join(" ")}" data-date="${iso}">
             <span class="cp-cell-d">${d}</span><span class="cp-cell-t">${tag}</span></button>`
        : `<div class="${cls.join(" ")}"><span class="cp-cell-d">${d}</span></div>`);
    }
    const prev = new Date(y, m - 2, 1), next = new Date(y, m, 1);
    const iso7 = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    return `
      <div class="cp-cal">
        <div class="cp-cal-head">
          <button type="button" class="cp-nav" data-month="${iso7(prev)}">‹</button>
          <strong>${y} 年 ${m} 月</strong>
          <button type="button" class="cp-nav" data-month="${iso7(next)}">›</button>
        </div>
        <div class="cp-cal-grid">
          ${["一", "二", "三", "四", "五", "六", "日"].map(w => `<div class="cp-wd">${w}</div>`).join("")}
          ${cells.join("")}
        </div>
      </div>`;
  };

  /* ── Morning Launch（早自修 SEL 微儀式） ─────────────────────
     週一二四五掛在「早自修」；週三是朝會，依老師決定改掛第一節課前 3 分鐘。 */
  const mlCard = (dow, compactNote) => {
    const d = ml?.days?.find(x => x.dow === dow);
    if (!d) return "";
    const stepName = n => ml.steps.find(s => s.no === n) || {};
    return `
      <div class="cp-ml" style="--ml:${App.esc(d.color)}">
        <div class="cp-ml-head">
          <span class="cp-ml-emoji">${d.emoji}</span>
          <div>
            <strong>🌅 Morning Launch・${App.esc(d.theme)}</strong>
            <div class="meta">3 分鐘心態重置與目標對齊${compactNote ? `｜${App.esc(compactNote)}` : ""}</div>
          </div>
          <a class="cp-ml-go" href="morning-launch.html?dow=${dow}" target="_blank" rel="noopener">▶ 開啟投影</a>
        </div>
        <div class="cp-ml-grid">
          ${d.cards.map(c => {
            const s = stepName(c.step);
            return `
              <div class="cp-ml-card">
                <div class="cp-ml-step">${s.icon || ""} ${App.esc(s.name || "")}</div>
                <div class="cp-ml-title">【${App.esc(c.title)}】</div>
                <div class="cp-ml-prompt">${App.esc(c.prompt || "")}</div>
                ${c.options ? `<div class="cp-ml-opts">${c.options
                  .map(o => `<span>${o.icon} ${App.esc(o.label)}</span>`).join("")}</div>` : ""}
              </div>`;
          }).join("")}
        </div>
      </div>`;
  };

  /* ── 節次卡：導師三科掛進度與教材連結，科任課只標科目／老師／教室 ── */
  const lessonLinks = l => {
    const btns = LINKS.filter(([k]) => l.links?.[k])
      .map(([k, label]) => `<a class="cockpit-link" href="${App.esc(l.links[k])}" target="_blank" rel="noopener">${label}</a>`);
    return btns.length ? `<div class="cockpit-links">${btns.join("")}</div>` : "";
  };

  const classCard = (cell, entry) => {
    const subject = cell.subject || "";
    const base = subject.replace(/\(.*?\)/g, "").trim();
    const color = SUBJECT_COLOR[base] || "#8395A7";
    const head = `
      <div class="cp-slot-head">
        <span class="badge" style="background:${color};color:#fff">${SUBJECT_ICON[base] || "📦"} ${App.esc(subject)}</span>
        <span class="meta">${App.esc(cell.teacher || "")}${cell.room ? `・${App.esc(cell.room)}` : ""}</span>
      </div>`;
    if (!entry) {
      return `<div class="cp-slot" style="--accent:${color}">${head}</div>`;
    }
    const hit = matchLesson(entry.subject, entry.text, entry.unit, entry.date || selected);
    const hits = hit?.lessons || [];
    // 一節可能對到多份教材（同一小節拆成 a／b 兩節），逐份列出，別只掛第一份
    const lessonBlock = l => {
      const c = codeOf(l) || hit.code;
      return `
        <div class="cp-lesson">
          <span class="badge" style="background:${color};color:#fff">${App.esc(c)}</span>
          <strong>${App.esc(l.title)}</strong>
          ${hit.sure && c === hit.code ? "" : '<span class="meta">（自動對應，可到 Notion「📅 每日課程進度」指定）</span>'}
        </div>
        ${(l.points || []).length ? `<ul class="cockpit-points">${l.points.map(p => `<li>${App.esc(p)}</li>`).join("")}</ul>` : ""}
        ${lessonLinks(l)}`;
    };
    return `
      <div class="cp-slot" style="--accent:${color}">
        ${head}
        <p class="cp-progress">${App.esc(entry.text)}</p>
        ${hit?.isExam ? '<p class="meta">📝 本節為課後評量與驗收，教材沿用該課「綜合整理」那份。</p>' : ""}
        ${hits.length ? hits.map(lessonBlock).join("")
          : hit ? `<p class="meta">尚未建立 <b>${App.esc(hit.code)}</b> 的教材——對 AI 說「/lesson-flow 開新單元 ${App.esc(hit.code)}」就會自動掛上。</p>`
                : `<p class="meta">這一節還沒指定單元——到 Notion「📅 每日課程進度」填該日的「${App.esc(subject)}單元」，再按「🔄 立即更新班網」。</p>`}
      </div>`;
  };

  /* ── 當日時間軸 ─────────────────────────────────────────── */
  const dayPanel = () => {
    const day = dayByDate.get(selected);
    if (!day) return '<p class="empty-hint">這一天沒有課程安排。</p>';
    const isToday = selected === todayISO;
    const isPast = selected < todayISO;
    const { plan, extras } = alignWeek(day.week);   // 依當下的日課表現算

    const title = `
      <div class="cp-day-head ${isPast ? "past" : ""}">
        <div>
          <h3>${App.fmtDate(day.date)}<span class="badge cp-week">第 ${day.week} 週</span>
            ${isToday ? '<span class="badge cp-badge-today">今天</span>' : ""}
            ${isPast ? '<span class="badge cp-badge-past">已過</span>' : ""}
          </h3>
          ${day.note ? `<p class="cp-note">📌 ${App.esc(day.note)}</p>` : ""}
        </div>
        <div class="cp-day-nav">
          <button type="button" class="cockpit-link" data-step="-1">‹ 前一天</button>
          <button type="button" class="cockpit-link" data-jump="today">回今天</button>
          <button type="button" class="cockpit-link" data-step="1">後一天 ›</button>
        </div>
      </div>`;

    if (day.holiday) {
      return `${title}
        <div class="cp-holiday">🏖️ 本日不排新課${day.note ? `：${App.esc(day.note)}` : "。"}</div>
        ${extrasBlock(day.week, extras)}`;
    }

    const rows = [];
    let hidden = 0;
    sched.periods.forEach((p, i) => {
      const cell = (sched.table[i] || [])[day.dow - 1];
      if (!cell || (typeof cell === "string" && !cell.trim())) return;      // 半天課的空節次

      const end = periodEnd(p);
      const past = isToday && end !== null && nowMin > end;
      if (past && !showAll) { hidden++; return; }                           // 今天：上完的節次收起

      const isClass = typeof cell === "object";
      const name = isClass ? "" : String(cell);
      // Morning Launch：週三是朝會 → 改掛第一節課前；其餘掛早自修
      const mlHere = ml && ((day.dow !== 3 && name === "早自修") || (day.dow === 3 && p.name === "第一節"));

      rows.push(`
        <div class="cp-row ${isClass ? "" : "break"} ${past ? "done" : ""}">
          <div class="cp-time"><b>${App.esc(p.name)}</b><span>${App.esc(p.time)}</span></div>
          <div class="cp-body">
            ${mlHere ? mlCard(day.dow, day.dow === 3 ? "週三朝會，改在第一節課前 3 分鐘進行" : "") : ""}
            ${isClass ? classCard(cell, plan.get(`${day.dow}|${p.name}`)) : `<div class="cp-break">${App.esc(name)}</div>`}
          </div>
        </div>`);
    });

    const toggle = isToday
      ? `<div class="cp-toggle">
           <button type="button" class="cockpit-link" data-toggle="all" aria-pressed="${showAll}">
             ${showAll ? "🙈 只看接下來的節次" : `👀 顯示全天${hidden ? `（已收起 ${hidden} 節）` : ""}`}
           </button>
         </div>`
      : "";

    const body = rows.length
      ? rows.join("")
      : `<p class="empty-hint">${isToday ? "今天的課都上完了 🎉" : "這一天沒有排定的節次。"}</p>`;

    return `${title}${toggle}<div class="cp-timeline ${isPast ? "past" : ""}">${body}</div>${extrasBlock(day.week, extras)}`;
  };

  /* 本週彈性補充：進度表寫了、但日課表沒有對應節次可放的內容（社會的課前預習／知識延伸、
     數學週五的複習訂正…）。掛在該週每一天，老師任何一天都看得到，自行決定要不要挪。 */
  const extrasBlock = (week, extras) => {
    if (!extras.length) return "";
    return `
      <details class="cp-extras">
        <summary>🧩 第 ${week} 週彈性補充（未排入固定節次，共 ${extras.length} 則）</summary>
        <ul>${extras.map(e => {
          const color = SUBJECT_COLOR[e.subject] || "#8395A7";
          return `<li><span class="badge" style="background:${color};color:#fff">${App.esc(e.subject)}</span>
                  ${App.esc(e.text)}</li>`;
        }).join("")}</ul>
      </details>`;
  };

  /* ── 檢視二：原本的「科目 → 單元」摺疊清單（備課找教材用） ────── */
  // 排序要跟老師的課程計畫一致：複習課（R#）依「複習範圍的最後一課」插在該課之後，
  // 不是一律排到科目最末（社R1 複習 L1～L2 → 排在社2 之後、社3 之前；國R1 複習 L1～L6 → 仍在最末）。
  const pad6 = n => String(n).padStart(6, "0");
  /* 複習卷代碼是「國R1-2」這種兩段式（R1 的第 2 份教材），不是「國R1」。
     R# 底下每一份的複習範圍都一樣，所以範圍要用整組（同 R 基底）的標題一起推，
     只有第一份寫了「｜L1～L6」也算數——否則 R1-2 會被當成沒範圍而漏排到科目最末。 */
  const REV_RE = /R(\d+)(?:-(\d+))?[A-Za-z]?$/;
  const revLastOf = title => {
    const t = (title || "").replace(CODE_RE, " ");        // 先去掉課次代碼，免得「R1-2」被當成範圍
    const range = /(\d+)\s*[～~—–\-至]\s*[A-Za-z]?(\d+)/.exec(t);
    if (range) return Number(range[2]);
    const cn = t.match(/[一二三四五六七八九十]/g);          // 社會寫「單元一、二」
    if (cn) return Math.max(...cn.map(x => CN_NUM[x]));
    return 0;
  };
  const revLastByBase = new Map();                        // 「國R1」→ 複習範圍的最後一課
  lessons.forEach(l => {
    const c = codeOf(l);
    const m = REV_RE.exec(c);
    if (!m) return;
    const base = c.replace(/-\d+[A-Za-z]?$/, "");
    revLastByBase.set(base, Math.max(revLastByBase.get(base) || 0, revLastOf(l.title)));
  });
  const sortKey = l => {
    const c = codeOf(l) || l.title || "";
    const rev = REV_RE.exec(c);
    if (rev) {
      const base = c.replace(/-\d+[A-Za-z]?$/, "");
      const last = revLastByBase.get(base) || 9999;       // 抓不到範圍就當成整學期複習，排最後
      return pad6(last) + "1" + pad6(Number(rev[1])) + pad6(Number(rev[2] || 0));
    }
    const nums = (c.match(/\d+/g) || []).map(Number);
    const suffix = ((/\d([A-Za-z])$/.exec(c) || [])[1] || "").toLowerCase();  // 2a 要排在 2b 前面
    return pad6(nums[0] || 0) + "0" + pad6(nums[1] || 0) + suffix;
  };
  const UNIT_RE = /^(.*\d)-\d+[A-Za-z]?$/;
  const unitOf = l => (UNIT_RE.exec(codeOf(l)) || [])[1] || "";
  const unitNo = u => (/(\d+)$/.exec(u) || [])[1] || "";
  const NODE_NAME_RE = /^(.*?)\s*第[一二三四五六七八九十0-9]+節/;
  const sameCourseName = rows => {
    const names = rows.map(l => {
      const full = (l.title || "").replace(CODE_RE, " ").replace(/\s+/g, " ").trim();
      const m = NODE_NAME_RE.exec(full);
      return m && m[1] ? m[1].trim() : null;
    });
    return names.every(n => n && n === names[0]) ? names[0] : null;
  };
  const UNIT_NAME_RE = /^(.*?)\s*｜/;
  const sameUnitName = rows => {
    const names = rows.map(l => {
      const full = (l.title || "").replace(CODE_RE, " ").replace(/\s+/g, " ").trim();
      const m = UNIT_NAME_RE.exec(full);
      return m && m[1] ? m[1].trim() : null;
    });
    return names.every(n => n && n === names[0]) ? names[0] : null;
  };
  const stageChips = done => `
    <div class="cockpit-stages">
      ${STAGES.map(s => `<span class="cockpit-stage ${done.includes(s) ? "done" : ""}">${done.includes(s) ? "✓" : "○"} ${s}</span>`).join("")}
    </div>`;
  const linkBtns = l => {
    const btns = LINKS.filter(([k]) => l.links[k])
      .map(([k, label]) => `<a class="cockpit-link" href="${App.esc(l.links[k])}" target="_blank" rel="noopener">${label}</a>`);
    return btns.length
      ? `<div class="cockpit-links">${btns.join("")}</div>`
      : `<p class="meta">尚未有教學連結——用 /lesson-flow 產出後會自動掛上。</p>`;
  };
  const pointList = pts => (pts && pts.length)
    ? `<ul class="cockpit-points">${pts.map(p => `<li>${App.esc(p)}</li>`).join("")}</ul>` : "";
  const card = (l, stripPrefix) => {
    const st = STATUS_META[l.status] || STATUS_META["備課中"];
    const color = SUBJECT_COLOR[l.subject] || "#8395A7";
    const code = codeOf(l);
    let name = code ? (l.title || "").replace(CODE_RE, " ").replace(/\s+/g, " ").trim() : l.title;
    if (stripPrefix && name.startsWith(stripPrefix)) name = name.slice(stripPrefix.length).trim();
    const meta = [l.grade, l.version, l.date ? `${App.fmtDateShort(l.date)} 開始` : ""]
      .filter(Boolean).map(App.esc).join(" ・ ");
    return `
      <div class="card cockpit-card" style="--accent:${color}">
        <div class="cockpit-head">
          ${code ? `<span class="badge" style="background:${color};color:#fff">${App.esc(code)}</span>` : ""}
          <strong class="cockpit-title">${App.esc(name)}</strong>
          <span class="badge" style="${st.style}">${st.icon} ${App.esc(l.status)}</span>
        </div>
        ${meta ? `<p class="meta cockpit-meta">${meta}</p>` : ""}
        ${pointList(l.points)}
        ${stageChips(l.stages || [])}
        ${linkBtns(l)}
        ${l.note ? `<p class="meta">${App.esc(l.note)}</p>` : ""}
      </div>`;
  };
  const subjectsOf = list => {
    const names = [...new Set(list.map(l => l.subject || "其他"))];
    return names.sort((a, b) => {
      const ia = SUBJECT_ORDER.indexOf(a), ib = SUBJECT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, "zh-Hant");
    });
  };
  const blockHead = b => {
    if (b.unit) {
      // 複習卷（國R1-1、國R1-2…）也會被歸成同一個 unit，但它沒有「第 N 單元」的概念
      if (/R\d+$/.test(b.unit)) {
        // 期中／期末只要同組任一份寫了就算（數R1-1「習作範圍總驗收」本身沒寫期中）
        const titles = b.rows.map(r => r.title || "").join(" ");
        const label = /期末/.test(titles) ? "期末複習" : /期中/.test(titles) ? "期中複習" : "複習";
        return `📄 ${App.esc(label)}
                <span class="meta">（${App.esc(b.unit)}・${b.rows.length} 份）</span>`;
      }
      const courseName = sameCourseName(b.rows);
      if (courseName) {
        return `📄 第 ${App.esc(unitNo(b.unit))} 課
                <span class="meta">（${App.esc(b.unit)}${App.esc(courseName)} ${b.rows.length}節）</span>`;
      }
      const unitName = sameUnitName(b.rows);
      return unitName
        ? `📘 第 ${App.esc(unitNo(b.unit))} 單元
           <span class="meta">（${App.esc(b.unit)} ${App.esc(unitName)}・${b.rows.length} 課）</span>`
        : `📘 第 ${App.esc(unitNo(b.unit))} 單元
           <span class="meta">（${App.esc(b.unit)}・${b.rows.length} 課）</span>`;
    }
    const l = b.rows[0], code = codeOf(l);
    const name = code ? (l.title || "").replace(CODE_RE, " ").replace(/\s+/g, " ").trim() : l.title;
    if (!code) return `📄 ${App.esc(l.title || "")}`;
    // 複習課（國R1、數R1…）沒有課次概念，標「期中／期末複習」而不是「第 1 課」
    if (/R\d+$/.test(code)) {
      const label = /期末/.test(l.title || "") ? "期末複習"
                  : /期中/.test(l.title || "") ? "期中複習" : "複習";
      return `📄 ${label} <span class="meta">（${App.esc(code)}・${App.esc(name)}）</span>`;
    }
    return `📄 第 ${App.esc(unitNo(code))} 課 <span class="meta">（${App.esc(code)}・${App.esc(name)}）</span>`;
  };
  const unitBlocks = (rows, color) => {
    const blocks = [];
    rows.forEach(l => {
      const unit = unitOf(l);
      const last = blocks[blocks.length - 1];
      if (unit && last && last.unit === unit) last.rows.push(l);
      else blocks.push({ unit, rows: [l] });
    });
    return blocks.map(b => {
      let stripPrefix = null;
      if (b.unit) {
        const courseName = sameCourseName(b.rows);
        if (courseName) stripPrefix = courseName;
        else {
          const unitName = sameUnitName(b.rows);
          if (unitName) stripPrefix = `${unitName}｜`;
        }
      }
      return `
        <details class="cockpit-unit-box">
          <summary class="cockpit-unit" style="--accent:${color}">
            <span>${blockHead(b)}</span>
          </summary>
          ${b.rows.map(l => card(l, stripPrefix)).join("")}
        </details>`;
    }).join("");
  };
  const unitPanel = onlyActive => {
    const list = onlyActive ? lessons.filter(l => l.status === "進行中") : lessons;
    const filter = `
      <div class="cockpit-filter" style="display:flex;gap:10px;margin:14px 0 6px">
        <button type="button" class="cockpit-link" data-unitfilter="all" aria-pressed="${!onlyActive}">全部單元</button>
        <button type="button" class="cockpit-link" data-unitfilter="active" aria-pressed="${onlyActive}">🔥 只看進行中</button>
      </div>`;
    if (!list.length) {
      return filter + (onlyActive
        ? '<p class="empty-hint">目前沒有「進行中」的單元。</p>'
        : '<p class="empty-hint">還沒有教學單元。對 AI 說「/lesson-flow 開新單元」開始第一個單元吧！</p>');
    }
    return filter + subjectsOf(list).map(sub => {
      const rows = list.filter(l => (l.subject || "其他") === sub)
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b), "zh-Hant"));
      const color = SUBJECT_COLOR[sub] || "#8395A7";
      return `<h3 class="bank-section-title" style="border-left:6px solid ${color};padding-left:12px">
                ${SUBJECT_ICON[sub] || "📦"} ${App.esc(sub)}
                <span class="meta">（${rows.length} 課）</span>
              </h3>${unitBlocks(rows, color)}`;
    }).join("");
  };

  /* ── 組裝與事件 ─────────────────────────────────────────── */
  let view = "day";
  let unitActiveOnly = false;
  const main = document.getElementById("main");

  const render = () => {
    main.innerHTML = `
      <h2 class="page-title"><span class="dot"></span>🚀 教學駕駛艙</h2>
      <p class="meta">選一天，就看到<b>當天由早到晚</b>的節次、該節進度與教材連結。
      節次來自<a href="schedule.html">日課表</a>，進度來自學期課程進度表，教材連結來自
      Notion「🚀 教學單元」（或對 AI 說「/lesson-flow 開新單元」）。
      <b>已過的日期會變暗</b>；今天只留還沒上的節次。</p>
      ${scheduleAudit()}
      <div class="cp-tabs">
        <button type="button" class="cockpit-link" data-view="day" aria-pressed="${view === "day"}">📅 行事曆</button>
        <button type="button" class="cockpit-link" data-view="unit" aria-pressed="${view === "unit"}">📚 依單元</button>
      </div>
      ${view === "day"
        ? `<div class="cp-layout">${monthGrid()}<div class="cp-day">${dayPanel()}</div></div>`
        : unitPanel(unitActiveOnly)}`;
  };

  main.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.view) { view = btn.dataset.view; return render(); }
    if (btn.dataset.unitfilter) { unitActiveOnly = btn.dataset.unitfilter === "active"; return render(); }
    if (btn.dataset.month) { viewMonth = btn.dataset.month; return render(); }
    if (btn.dataset.toggle === "all") { showAll = !showAll; return render(); }
    if (btn.dataset.jump === "today") {
      selected = defaultDate(); viewMonth = selected.slice(0, 7); showAll = false; syncURL(); return render();
    }
    if (btn.dataset.date) {
      selected = btn.dataset.date; viewMonth = selected.slice(0, 7); showAll = false; syncURL(); return render();
    }
    if (btn.dataset.step) {                       // 前／後一天＝上課日清單裡的前後一筆
      const i = days.findIndex(d => d.date === selected);
      const j = i + Number(btn.dataset.step);
      if (j >= 0 && j < days.length) {
        selected = days[j].date; viewMonth = selected.slice(0, 7); showAll = false; syncURL(); render();
      }
    }
  });

  render();
})();
