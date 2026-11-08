/* 📰 校刊挑選核心（SPEC_校刊挑選.md）：規則、檢核、建議挑選、Word（.docx）產生。
 * 純函式、不碰畫面與網路；前端 yearbook.js 與 node 測試 scripts/yearbook.test.mjs 共用同一支。
 * 規則正本＝崑山國小「崑山幼苗」校刊徵稿辦法（115 學年沿用，只換年份；老師 2026-11-08 裁定）。 */
(function (root) {
  "use strict";
  // 各年級：字數、上／下學期主題（辦法表格）
  const RULES = {
    1: { min: 100, max: 200, s1: ["學校趣", "小一嘰嘰喳喳"], s2: ["家庭生活", "生活記趣"], note: "一年級上學期自由參加；可交圖畫＋文字 10–50 字（圖文作品請做成 Word）" },
    2: { min: 200, max: 300, s1: ["閱讀分享", "環境教育相關之議題"], s2: ["美好時光", "生命教育相關之議題", "我愛動物"] },
    3: { min: 300, max: 500, s1: ["家庭生活", "孝親相關之議題", "其他"], s2: ["我的寶貝", "閱讀相關之議題", "其他"] },
    4: { min: 300, max: 500, s1: ["校園生活", "食安相關之議題", "其他"], s2: ["遊記", "運動與我（健促相關）", "其他"] },
    5: { min: 500, max: 700, s1: ["孝道教育相關之議題", "品格教育相關之議題", "其他"], s2: ["話我家鄉", "毒品防制相關之議題", "其他"] },
    6: { min: 500, max: 700, s1: ["旅遊記趣", "性別平等相關之議題", "其他"], s2: ["生涯規劃", "交通安全相關之議題", "其他"] },
  };
  const MIN_N = 2, MAX_N = 5;
  const GRADE_ORDER = ["優", "甲上", "甲", "甲下", "乙上", "乙", "乙下", "丙"];
  const NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

  // 字數＝去掉空白（含全形空白）後的字元數，標點算字（老師 11/08 同意）
  const count = t => String(t || "").replace(/[\s　]/g, "").length;
  const isPoem = w => w.genre === "詩歌";
  const unclear = t => /\[？疑似/.test(String(t || ""));
  const rankOf = g => { const i = GRADE_ORDER.indexOf(g); return i < 0 ? 99 : i; };

  // 「四年四班」「4年4班」→ { grade: 4, cls: 4, code: "404" }
  function parseClass(name) {
    const n = s => (/^\d+$/.test(s) ? Number(s) : s === "十" ? 10 : s.length === 2 && s[0] === "十" ? 10 + NUM[s[1]] : NUM[s]);
    const m = String(name || "").match(/([一二三四五六\d])\s*年\s*([一二三四五六七八九十\d]+)\s*班/);
    if (!m) return null;
    const grade = n(m[1]), cls = n(m[2]);
    if (!grade || !cls) return null;
    return { grade: grade, cls: cls, code: String(grade) + String(cls).padStart(2, "0") };
  }

  // 截止日：上學期＝當年 12/31、下學期＝隔年 5/31（學年 115 → 2026-12-31／2027-05-31）
  function dueOf(year, sem) {
    const y = Number(year) + 1911;
    return sem === "下" ? (y + 1) + "-05-31" : y + "-12-31";
  }

  const themesOf = (grade, sem) => (RULES[grade] || RULES[4])[sem === "下" ? "s2" : "s1"];

  // 單篇提示：[{lv: ok|warn|gold, m, block}]；block＝擋下載與繳交
  function issues(w, grade, sem) {
    const r = RULES[grade] || RULES[4], out = [];
    if (!w.name) out.push({ lv: "warn", m: "對不到名冊（需人工）", block: true });
    if (isPoem(w)) out.push({ lv: "gold", m: "新詩（學年限 2 件，不看字數）" });
    else {
      const n = count(w.text);
      if (n < r.min) out.push({ lv: "warn", m: "字數不足 " + n + "／" + r.min, block: true });
      else if (n > r.max) out.push({ lv: "warn", m: "字數超過 " + n + "／" + r.max, block: true });
      else out.push({ lv: "ok", m: n + " 字 ✓" });
    }
    if (unclear(w.text)) out.push({ lv: "warn", m: "有辨識不清處〔？疑似〕，請對照原稿改掉", block: true });
    if (w.theme && themesOf(grade, sem).indexOf(w.theme) < 0) out.push({ lv: "warn", m: "主題不在本學期清單", block: true });
    return out;
  }

  // 繳交前檢核：[[ok|bad|note, 訊息]]
  function checks(ws, ctx) {
    const r = RULES[ctx.grade] || RULES[4], out = [], n = ws.length;
    out.push([n >= MIN_N && n <= MAX_N ? "ok" : "bad", "篇數 " + n + "（規定 " + MIN_N + "–" + MAX_N + " 篇）"]);
    const seats = ws.map(w => w.seat);
    out.push([new Set(seats).size === seats.length ? "ok" : "bad", "一名學生以 1 件為限"]);
    const t = w => "〈" + (w.title || "未命名") + "〉";
    const badLen = ws.filter(w => !isPoem(w) && (count(w.text) < r.min || count(w.text) > r.max));
    out.push([badLen.length ? "bad" : "ok", badLen.length ? "字數不合：" + badLen.map(t).join("、") : "字數皆在 " + r.min + "–" + r.max + " 字"]);
    const noTheme = ws.filter(w => !w.theme), badTheme = ws.filter(w => w.theme && themesOf(ctx.grade, ctx.sem).indexOf(w.theme) < 0);
    out.push([noTheme.length || badTheme.length ? "bad" : "ok",
      noTheme.length ? "還沒選主題：" + noTheme.map(t).join("、") : badTheme.length ? "主題不在清單：" + badTheme.map(t).join("、") : "主題皆符合本學期清單"]);
    const blur = ws.filter(w => unclear(w.text));
    if (blur.length) out.push(["bad", "還有辨識不清處：" + blur.map(t).join("、")]);
    const noName = ws.filter(w => !w.name);
    if (noName.length) out.push(["bad", "對不到名冊：" + noName.map(t).join("、")]);
    const emptyTitle = ws.filter(w => !String(w.title || "").trim());
    if (emptyTitle.length) out.push(["bad", "有作品沒有題目"]);
    out.push([String(ctx.teacher || "").trim() ? "ok" : "bad", String(ctx.teacher || "").trim() ? "指導老師：" + ctx.teacher : "尚未填指導老師姓名"]);
    const poems = ws.filter(isPoem).length;
    if (poems) out.push(["note", "本班選入新詩 " + poems + " 件；中高年級整學年新詩以 2 件為限，請與學年老師確認"]);
    out.push(["note", "內文請用級任老師批閱後的定稿（學校不再另請評審審稿，選入即全數刊出）"]);
    return out;
  }

  // 建議挑選：合字數、無辨識不清、對得到名冊、一人一件，等第高者優先，最多 5 篇（主題留給老師選）
  function suggest(pool, grade, sem) {
    const ok = pool.filter(w => !isPoem(w) && !issues(w, grade, sem).some(i => i.block))
      .slice().sort((a, b) => rankOf(a.grade) - rankOf(b.grade) || b.date.localeCompare(a.date));
    const pick = [], seats = {};
    ok.forEach(w => { if (pick.length < MAX_N && !seats[w.seat]) { pick.push(w.id); seats[w.seat] = true; } });
    return pick;
  }

  const byline = (w, cls, teacher) => cls.grade + " 年 " + cls.cls + " 班 " + w.name + "/指導老師 " + (String(teacher || "").trim() || "○○○");
  const fileName = (code, sem) => code + "校刊投稿" + (sem === "下" ? "下" : "上") + ".docx";

  // ── Word（.docx）：最小 OOXML＋ZIP（不壓縮），離線可用；標題標楷體 16 粗、作者與內文 14 ──
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function run(t, sz, bold) {
    return '<w:r><w:rPr><w:rFonts w:ascii="標楷體" w:hAnsi="標楷體" w:eastAsia="標楷體" w:cs="標楷體" w:hint="eastAsia"/>' +
      (bold ? "<w:b/><w:bCs/>" : "") + '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr><w:t xml:space="preserve">' + esc(t) + "</w:t></w:r>";
  }
  const para = (inner, after) => '<w:p><w:pPr><w:spacing w:after="' + (after || 0) + '" w:line="360" w:lineRule="auto"/></w:pPr>' + inner + "</w:p>";
  function docxXml(ws, cls, teacher, pageBreak) {
    let body = "";
    ws.forEach((w, k) => {
      if (k) body += pageBreak ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : para("");
      body += para(run(w.title, 32, true));
      body += para(run(byline(w, cls, teacher), 28, false), 120);
      String(w.text).replace(/\r/g, "").split("\n").forEach(l => { body += para(l ? run(l, 28, false) : ""); });
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>';
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {
    const enc = new TextEncoder(), parts = [], cen = [];
    let off = 0;
    files.forEach(([name, text]) => {
      const nb = enc.encode(name), db = enc.encode(text), crc = crc32(db);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, db.length, true);
      h.setUint32(22, db.length, true); h.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(h.buffer), nb, db);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, db.length, true); c.setUint32(24, db.length, true);
      c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + db.length;
    });
    const cenLen = cen.reduce((s, a) => s + a.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cenLen, true); e.setUint32(16, off, true);
    const all = parts.concat(cen, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let p = 0;
    all.forEach(a => { out.set(a, p); p += a.length; });
    return out;
  }
  function buildDocx(ws, cls, teacher, pageBreak) {
    return zipStore([
      ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ["word/document.xml", docxXml(ws, cls, teacher, pageBreak)],
    ]);
  }

  // Notion「校刊定稿」＝〔順序・主題〕一行（可無）、題目一行、其後內文
  function splitFinal(s) {
    let t = String(s || ""), order = 0, theme = "";
    const m = t.match(/^〔(\d+)・([^〕]*)〕\n/);
    if (m) { order = Number(m[1]); theme = m[2]; t = t.slice(m[0].length); }
    const i = t.indexOf("\n");
    const o = i < 0 ? { title: t.trim(), text: "" } : { title: t.slice(0, i).trim(), text: t.slice(i + 1) };
    o.order = order; o.theme = theme;
    return o;
  }

  const api = { RULES, MIN_N, MAX_N, GRADE_ORDER, count, isPoem, unclear, parseClass, dueOf, themesOf, issues, checks, suggest, byline, fileName, buildDocx, splitFinal };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Yearbook = api;
})(typeof window !== "undefined" ? window : this);
