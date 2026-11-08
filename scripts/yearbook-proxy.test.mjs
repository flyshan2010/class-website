// 執行：node --test scripts/yearbook-proxy.test.mjs
// 代理 v2.17 yearbook_list／yearbook_mark 的本機模擬（SPEC_校刊挑選.md）：
// 把 apps-script-proxy-v2.gs 原樣載入 vm，UrlFetchApp 換成記憶體裡的假 Notion，從 doPost 進去跑，不碰真資料。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("./apps-script-proxy-v2.gs", import.meta.url), "utf8");
const DS = { roster: "ad232b7a-c7f8-4a68-b224-5b2d5b16599a", reports: "10dbe7ca-291b-4501-a2b4-2ac30f53a7f1", log: "eb529fa1-59e5-45ef-bfb4-79fc30de79e4" };
const rt = s => [{ plain_text: s, text: { content: s } }];
const sel = s => ({ select: s ? { name: s } : null });

function makeWorld({ today = "2026-12-20", failPatch = false } = {}) {
  let seq = 0;
  const pages = new Map();
  const add = (ds, properties) => { const id = `pg-${++seq}`; pages.set(id, { ds, properties, created: "2026-10-15T02:00:00.000Z" }); return id; };
  const stu = {};
  for (let i = 1; i <= 5; i++)
    stu[i] = add(DS.roster, { 姓名: { title: rt(`學生${i}`) }, 座號: { number: i }, 性別: sel("男"), 在學: { checkbox: true }, 學年: sel("115") });
  const essay = (seat, title, period, extra = {}) => add(DS.reports, {
    學生: { title: rt(`${seat} 學生${seat}`) }, 座號: { number: seat }, 學生檔案: { relation: seat ? [{ id: stu[seat] }] : [] },
    報告類型: sel("作文批改"), 學年: sel("115"), 期間: { rich_text: rt(period) },
    作文_題目: { rich_text: rt(title) }, 作文_原文: { rich_text: rt("　　" + title + "的內文。") },
    作文_文體: sel("記敘"), 作文_總評等第: sel("甲"), ...extra });
  const E = {
    a: essay(1, "下課十分鐘", "2026-10-15"),
    b: essay(2, "營養午餐", "2026-11-02"),
    c: essay(2, "第二篇", "2026-11-20"),
    d: essay(3, "春天", "2027-03-10"),                                   // 下學期
    old: essay(4, "舊選的", "2026-10-01", { 校刊投稿: sel("115上"), 校刊定稿: { rich_text: rt("舊選的\n舊稿") } }),
  };
  add(DS.reports, { 學生: { title: rt("週報") }, 座號: { number: 1 }, 報告類型: sel("每週"), 學年: sel("115"), 期間: { rich_text: rt("四上第1週") } });
  add(DS.reports, { 學生: { title: rt("去年") }, 座號: { number: 1 }, 報告類型: sel("作文批改"), 學年: sel("114"), 期間: { rich_text: rt("2025-10-01") }, 作文_原文: { rich_text: rt("x") } });
  const calls = { writes: 0 };
  const match = (props, f) => {
    if (!f) return true;
    if (f.and) return f.and.every(x => match(props, x));
    const p = props[f.property];
    if (f.checkbox) return !!p?.checkbox === f.checkbox.equals;
    if (f.select) return p?.select?.name === f.select.equals;
    if (f.rich_text) return (p?.rich_text || []).map(x => x.plain_text).join("") === f.rich_text.equals;
    throw new Error("假 Notion 不支援的篩選 " + JSON.stringify(f));
  };
  const norm = props => {
    const o = {};
    for (const [k, v] of Object.entries(props)) {
      if (v.rich_text) o[k] = { rich_text: v.rich_text.map(x => ({ plain_text: x.text.content, text: x.text })) };
      else o[k] = JSON.parse(JSON.stringify(v));
    }
    return o;
  };
  const resp = (code, data) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(data) });
  const UrlFetchApp = {
    fetch(url, opts) {
      const path = url.replace("https://api.notion.com/v1/", ""), body = opts.payload ? JSON.parse(opts.payload) : null;
      let m;
      if ((m = path.match(/^data_sources\/([^/]+)\/query$/))) {
        const rows = [...pages].filter(([, p]) => p.ds === m[1] && match(p.properties, body.filter)).map(([id, p]) => ({ id, properties: p.properties, created_time: p.created }));
        return resp(200, { results: rows, has_more: false });
      }
      if (path === "pages" && opts.method === "post") {
        if (failPatch) return resp(500, {});
        calls.writes++; const id = add(body.parent.data_source_id, norm(body.properties));
        return resp(200, { id });
      }
      if ((m = path.match(/^pages\/(.+)$/)) && opts.method === "patch") {
        if (failPatch) return resp(500, {});
        calls.writes++; Object.assign(pages.get(m[1]).properties, norm(body.properties));
        return resp(200, { id: m[1] });
      }
      return resp(400, { message: "假 Notion 未實作 " + path });
    },
  };
  const [Y, M, D] = today.split("-");
  const ctx = {
    UrlFetchApp, console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ PASSWORD: "pw", NOTION_TOKEN: "t" })[k] ?? null }) },
    Utilities: { formatDate: (_d, _tz, fmt) => fmt.replace("yyyy", Y).replace("MM", M).replace("dd", D).replace("HH:mm", "10:00") },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: { createTextOutput: s => ({ setMimeType() { return s; } }), MimeType: { JSON: "json" } },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ pw: "pw", ...body }) } }));
  return { post, pages, E, calls };
}

test("yearbook_list：只回本學年作文批改，帶名冊姓名與學期", () => {
  const w = makeWorld();
  const r = w.post({ action: "yearbook_list" });
  assert.equal(r.ok, true);
  assert.equal(r.year, "115");
  assert.equal(r.essays.length, 5);                     // 週報、114 學年都不算
  const a = r.essays.find(e => e.id === w.E.a);
  assert.equal(a.name, "學生1"); assert.equal(a.sem, "上"); assert.equal(a.grade, "甲"); assert.equal(a.genre, "記敘");
  assert.equal(r.essays.find(e => e.id === w.E.d).sem, "下");
  assert.equal(r.essays.find(e => e.id === w.E.old).mark, "115上");
});

test("口令錯誤擋下", () => {
  const w = makeWorld();
  assert.equal(w.post({ action: "yearbook_list", pw: "x" }).error, "口令錯誤");
});

test("yearbook_mark：寫標記與定稿、清掉同學期舊選、回讀相符", () => {
  const w = makeWorld();
  const r = w.post({ action: "yearbook_mark", sem: "上", items: [
    { id: w.E.a, title: "下課十分鐘", text: "　　定稿一。", theme: "校園生活" },
    { id: w.E.b, title: "營養午餐的祕密", text: "　　定稿二。\n　　第二段。", theme: "食安相關之議題" },
  ] });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.label, "115上"); assert.equal(r.count, 2); assert.equal(r.cleared, 1);
  const pa = w.pages.get(w.E.b).properties;
  assert.equal(pa.校刊投稿.select.name, "115上");
  assert.equal(pa.校刊定稿.rich_text.map(x => x.plain_text).join(""), "〔2・食安相關之議題〕\n營養午餐的祕密\n　　定稿二。\n　　第二段。");
  assert.equal(w.pages.get(w.E.old).properties.校刊投稿.select, null);
});

test("yearbook_mark：不合規整筆不寫", () => {
  const w = makeWorld();
  const ok2 = [{ id: w.E.a, title: "t", text: "x", theme: "其他" }];
  assert.match(w.post({ action: "yearbook_mark", sem: "上", items: ok2 }).error, /篇數/);
  assert.match(w.post({ action: "yearbook_mark", sem: "上", items: [...ok2, { id: "pg-999", title: "t", text: "x" }] }).error, /不是本學年/);
  assert.match(w.post({ action: "yearbook_mark", sem: "上", items: [{ id: w.E.b, title: "t", text: "x", theme: "其他" }, { id: w.E.c, title: "t", text: "x", theme: "其他" }] }).error, /一人限一件/);
  assert.match(w.post({ action: "yearbook_mark", sem: "上", items: [...ok2, { id: w.E.b, title: "", text: "x", theme: "其他" }] }).error, /題目/);
  assert.match(w.post({ action: "yearbook_mark", sem: "春", items: ok2 }).error, /學期/);
  assert.match(w.post({ action: "yearbook_mark", sem: "上", items: [...ok2, { id: w.E.b, title: "t", text: "x" }] }).error, /主題/);
  assert.equal(w.calls.writes, 0);
});

test("yearbook_mark：Notion 寫失敗要回錯，不可說成功", () => {
  const w = makeWorld({ failPatch: true });
  const r = w.post({ action: "yearbook_mark", sem: "上", items: [{ id: w.E.a, title: "a", text: "x", theme: "其他" }, { id: w.E.b, title: "b", text: "y", theme: "其他" }] });
  assert.equal(r.ok, false); assert.match(r.error, /沒寫進/);
});

test("長定稿切段（每段 ≤1900）且回讀拼回原文", () => {
  const w = makeWorld();
  const long = "字".repeat(4100);
  const r = w.post({ action: "yearbook_mark", sem: "上", items: [{ id: w.E.a, title: "長", text: long, theme: "其他" }, { id: w.E.b, title: "b", text: "y", theme: "其他" }] });
  assert.equal(r.ok, true, r.error);
  const segs = w.pages.get(w.E.a).properties.校刊定稿.rich_text;
  assert.ok(segs.length === 3 && segs.every(s => s.plain_text.length <= 1900));
});

// ── v2.18 ✨ 一鍵微修 ──
import { createRequire } from "node:module";
const Yc = createRequire(import.meta.url)("../assets/js/yearbook-core.js");

test("yearbook_polish：寫〔待微修〕底稿、格式與前端核心一致、list 帶回", () => {
  const w = makeWorld();
  const base = "　　老師改過的底稿。\n　　第二段。";
  const r = w.post({ action: "yearbook_polish", items: [{ id: w.E.a, text: base }] });
  assert.equal(r.ok, true, r.error); assert.equal(r.count, 1);
  const got = w.pages.get(w.E.a).properties.校刊微修建議.rich_text.map(x => x.plain_text).join("");
  assert.equal(got, Yc.polishPending(base, r.at));
  const p = Yc.parsePolish(w.post({ action: "yearbook_list" }).essays.find(e => e.id === w.E.a).polish);
  assert.equal(p.state, "pending"); assert.equal(p.base, base);
});

test("yearbook_polish：不合規不寫、寫失敗回錯", () => {
  const w = makeWorld();
  assert.match(w.post({ action: "yearbook_polish", items: [] }).error, /1–5/);
  assert.match(w.post({ action: "yearbook_polish", items: [{ id: "pg-999", text: "x" }] }).error, /不是本學年/);
  assert.match(w.post({ action: "yearbook_polish", items: [{ id: w.E.a, text: "  " }] }).error, /空白/);
  assert.equal(w.calls.writes, 0);
  const f = makeWorld({ failPatch: true });
  assert.match(f.post({ action: "yearbook_polish", items: [{ id: f.E.a, text: "x" }] }).error, /沒寫進/);
});

const logs = w => [...w.pages.values()].filter(p => p.ds === DS.log).map(p => p.properties);
const txt = p => (p?.rich_text || p?.title || []).map(x => x.plain_text ?? x.text?.content).join("");

test("v2.19 yearbook_mark：入選學生記亮點＋20、事件id 防重複、換掉的作品提醒老師", () => {
  const w = makeWorld();
  const two = [{ id: w.E.a, title: "下課十分鐘", text: "　　一。", theme: "校園生活" }, { id: w.E.b, title: "營養午餐", text: "　　二。", theme: "其他" }];
  const r = w.post({ action: "yearbook_mark", sem: "上", items: two });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.coinNew, 2); assert.equal(r.coinKept, 0); assert.deepEqual(r.coinWarn, []);
  const L = logs(w);
  assert.equal(L.length, 2);
  assert.equal(txt(L[0].事件描述), "作文〈下課十分鐘〉獲選校刊（115上）");
  assert.equal(L[0].金幣影響.number, 20); assert.equal(L[0].類別.select.name, "亮點"); assert.equal(L[0].正負向.select.name, "＋");
  assert.equal(L[0].學年.select.name, "115"); assert.equal(L[0].學生.relation[0].id, w.pages.get(w.E.a).properties.學生檔案.relation[0].id);
  assert.match(txt(L[0].事件id), /^yb:/);
  // 重交同兩篇 → 不重複發
  const r2 = w.post({ action: "yearbook_mark", sem: "上", items: two });
  assert.equal(r2.coinNew, 0); assert.equal(r2.coinKept, 2); assert.equal(logs(w).length, 2);
  // 把 b 換成 c（同座號 2 的另一篇）→ c 新記一筆，b 已發的不自動扣、回 coinWarn
  const r3 = w.post({ action: "yearbook_mark", sem: "上", items: [two[0], { id: w.E.c, title: "第二篇", text: "　　三。", theme: "其他" }] });
  assert.equal(r3.coinNew, 1); assert.equal(r3.coinWarn.length, 1); assert.match(r3.coinWarn[0], /營養午餐/);
});

test("v2.19 yearbook_mark：已在其他學期入選的作品不可再交", () => {
  const w = makeWorld({ today: "2027-05-20" });
  const r = w.post({ action: "yearbook_mark", sem: "下", items: [
    { id: w.E.old, title: "舊選的", text: "　　x。", theme: "其他" }, { id: w.E.d, title: "春天", text: "　　y。", theme: "其他" }] });
  assert.equal(r.ok, false); assert.match(r.error, /已在 115上 入選過/);
});
