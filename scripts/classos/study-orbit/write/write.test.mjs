// 自學星圖題本寫入：離線測試（不連 Notion；schema 照 2026-11-21 實際五張表的欄名與欄型）
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { toNotionProps, chunks, mdToBlocks, pageId, mismatches } from "./props.mjs";
import { runWrite, writeStructure, DS, taipeiToday } from "./writer.mjs";
import { fingerprint } from "./fingerprint.mjs";
import { mergeIds } from "./local.mjs";
import { runPromote } from "./promote.mjs";

import { SCHEMA } from "./schema.fixture.mjs";
const DS_TABLE = Object.fromEntries(Object.entries(DS).map(([t, id]) => [id, t]));
const BOOK = "41bb1f9d-7e45-81ed-ae63-ff961c8def7f";
const CARD_BODY = "## 重點整理\n\n- <b>部首</b>：手部是手的動作。\n\n## 例題示範\n\n「滋味」→ 水部。\n\n## 自我檢查\n\n1. 第一題？\n2. 第二題？\n\n<toggle>\n答案\n\n1. 甲　2. 乙\n</toggle>";

// ── 迷你 gen.py：照 gen.py 的欄位與「缺 id 就停」行為（測順序與關聯接續用）──
function fakeGen(what, ids, code, all = false) {
  const need = (t, k) => { if (!ids[t]?.[k]) throw new Error(`ids.json 缺 ${t}:${k}`); return ids[t][k]; };
  const lv = "c-h-4a-7-1";
  if (what === "structure") return { islands: [{ id: "7", name: "品德小故事", unit: 3, levels: [{ code: lv, name: "松鼠先生的麵包・字詞語詞及大意" }] }] };
  const rows = {
    kp: () => [{ 代碼: `${lv}-K1`, 名稱: "部首", 科目: "國語", 題本: [need("book", "c-h-4a")], 關卡代碼: lv, 課本位置: "第七課", 觀念複習卡: [need("card", "松鼠・字詞")], 狀態: "待審" }],
    bs: () => [{ 代碼: `${lv}-B1`, 卡名: "看錯部首", 知識點: [need("kp", `${lv}-K1`)], 關卡代碼: lv, 正確的想法: "想", 看例子: "例", 檢查口訣: "訣", 狀態: "待審" }],
    story: () => [{ 關卡代碼: lv, 題本: [need("book", "c-h-4a")], 標題: "麵包", 內文: "故事", 狀態: "待審" }],
    qroot: () => [q("CH4-0065", null)],
    qchild: () => [q("CH4-0066", "CH4-0065")],
  }[what]();
  function q(id, mother) {
    return { 題目ID: id, 學科: "國語", 年級: "4", 單元: "翰林四上 第七課", 題型: "選擇", 題幹: "題幹", 選項: "A. 甲\nB. 乙", 正確答案: "A", 解析: "解析",
      難度: "易", 認知層次: "理解", 來源: "AI生成", 狀態: "待審", 盲點: [need("bs", `${lv}-B1`)], 知識點: [need("kp", `${lv}-K1`)], 所屬評量: "期末",
      提示1: "一", 提示2: "二", 關卡代碼: lv, 格: 1, 占格: 1, 選項盲點: "B=c-h-4a-7-1-B1", ...(mother ? { 母題: [need("q", mother)] } : {}) };
  }
  // gen.py 預設略過 ids.json 已有的列
  const key = { kp: "代碼", bs: "代碼", story: "關卡代碼", qroot: "題目ID", qchild: "題目ID" }[what];
  const table = { kp: "kp", bs: "bs", story: "story", qroot: "q", qchild: "q" }[what];
  return rows.filter((r) => all || !(r[key] in (ids[table] ?? {}))).map((properties) => ({ properties }));
}

// Notion 格式 → 回傳的 page.properties（模擬 API 回讀）
function echo(props, tamper) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const type = Object.keys(v)[0];
    const val = v[type];
    if (type === "title" || type === "rich_text") out[k] = { type, [type]: val.map((t) => ({ plain_text: tamper === k ? "被改" : t.text.content })) };
    else out[k] = { type, [type]: val };
  }
  return out;
}

function mockApi({ existing = {}, blocks, tamper } = {}) {
  const calls = [];
  let n = 0;
  const codeBlocks = blocks ?? [{ id: "code-1", type: "code", code: { rich_text: [{ plain_text: '{"islands":[]}' }] } }];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    let m;
    if (method === "GET" && (m = path.match(/^\/data_sources\/(.+)$/))) return { ok: true, status: 200, json: { properties: SCHEMA[DS_TABLE[m[1]]] } };
    if (method === "POST" && (m = path.match(/^\/data_sources\/(.+)\/query$/))) {
      const rows = existing[DS_TABLE[m[1]]] ?? [];
      return { ok: true, status: 200, json: { results: rows.map(([key, id]) => ({ id, properties: { [{ card: "卡名", kp: "代碼", bs: "代碼", story: "關卡代碼", q: "題目ID" }[DS_TABLE[m[1]]]]: { type: "title", title: [{ plain_text: key }] } } })), has_more: false } };
    }
    if (method === "POST" && path === "/pages") {
      const id = crypto.randomUUID();
      n++;
      return { ok: true, status: 200, json: { id, properties: echo(body.properties, tamper) } };
    }
    if (method === "GET" && /\/children/.test(path)) return { ok: true, status: 200, json: { results: codeBlocks } };
    if (method === "PATCH" && path.startsWith("/pages/")) return { ok: true, status: 200, json: { properties: echo(body.properties) } };
    if (method === "PATCH" && path.startsWith("/blocks/")) { codeBlocks[0].code.rich_text = body.code.rich_text.map((t) => ({ plain_text: t.text.content })); return { ok: true, status: 200, json: {} }; }
    if (method === "GET" && path.startsWith("/blocks/")) return { ok: true, status: 200, json: codeBlocks[0] };
    throw new Error(`mock 沒處理 ${method} ${path}`);
  };
  return { api, calls, created: () => n };
}

const CARD_PAGE = { properties: { 卡名: "松鼠・字詞", 科目: "國語", 學年: "115", 年級學期: "4上", 相關課次: '["國L7"]', 教學頁連結: "https://example.org/1.teach.html", 狀態: "草稿" }, content: CARD_BODY };
const basePayload = () => ({ levels: ["c-h-4a-7"], cards: [CARD_PAGE], structure: ["c-h-4a"] });
const baseIds = () => ({ book: { "c-h-4a": BOOK }, card: {}, kp: {}, bs: {}, story: {}, q: {} });
const quiet = () => {};
const run = (over = {}) => runWrite({ payload: basePayload(), ids: baseIds(), gen: fakeGen, execute: true, newIds: {}, log: quiet, sleep: async () => {}, ...over });

// ── 屬性轉換 ──
test("number 傳字串擋下、select 打錯字擋下、不在 schema 的欄位擋下", () => {
  assert.throws(() => toNotionProps({ 格: "1" }, SCHEMA.q), /不是數字/);
  assert.throws(() => toNotionProps({ 難度: "很難" }, SCHEMA.q), /沒有選項/);
  assert.throws(() => toNotionProps({ 不存在: "x" }, SCHEMA.q), /不在資料表 schema/);
  assert.deepEqual(toNotionProps({ 格: 3, 素材類型: "" }, SCHEMA.q).properties, { 格: { number: 3 }, 素材類型: { select: null } });
});

test("relation 只收 32 碼 id，正規化成帶連字號；拼湊或缺 id 的佔位字擋下", () => {
  assert.equal(pageId("41bb1f9d7e4581edae63ff961c8def7f"), BOOK);
  assert.throws(() => pageId("<缺 kp:x>"), /格式不對/);
  assert.deepEqual(toNotionProps({ 題本: ["41bb1f9d7e4581edae63ff961c8def7f"] }, SCHEMA.kp).properties.題本, { relation: [{ id: BOOK }] });
});

test("rich_text 超過 1900 字切段、不切斷罕用字；空字串為空陣列", () => {
  const s = "𠮷".repeat(1000) + "字".repeat(1500);
  const c = chunks(s);
  assert.ok(c.every((x) => x.length <= 1900));
  assert.equal(c.join(""), s);
  assert.deepEqual(toNotionProps({ 題組: "" }, SCHEMA.q).properties.題組, { rich_text: [] });
});

test("multi_select 吃 cards.py 的 JSON 字串，新選項只提醒", () => {
  const { properties, warnings } = toNotionProps({ 相關課次: '["國L7"]' }, SCHEMA.card);
  assert.deepEqual(properties.相關課次, { multi_select: [{ name: "國L7" }] });
  assert.match(warnings[0], /將新增選項：國L7/);
});

test("卡片內文轉 blocks：標題、粗體項目、編號、摺疊答案", () => {
  const b = mdToBlocks(CARD_BODY);
  assert.deepEqual(b.map((x) => x.type), ["heading_2", "bulleted_list_item", "heading_2", "paragraph", "heading_2", "numbered_list_item", "numbered_list_item", "toggle"]);
  assert.deepEqual(b[1].bulleted_list_item.rich_text.map((t) => [t.text.content, !!t.annotations?.bold]), [["部首", true], ["：手部是手的動作。", false]]);
  assert.equal(b[7].toggle.rich_text[0].text.content, "答案");
  assert.equal(b[7].toggle.children[0].type, "numbered_list_item");
  assert.throws(() => mdToBlocks("<i>斜體</i>"), /不支援的標籤/);
  assert.throws(() => mdToBlocks("<toggle>\n答案\n內容"), /收尾/);
});

// ── 寫入流程 ──
test("execute：依被關聯順序建頁，下一張表的關聯接上上一張的新 id", async () => {
  const m = mockApi();
  const newIds = {};
  await run({ api: m.api, newIds });
  const posts = m.calls.filter((c) => c.method === "POST" && c.path === "/pages");
  assert.deepEqual(posts.map((c) => DS_TABLE[c.body.parent.data_source_id]), ["card", "kp", "bs", "story", "q", "q"]);
  const [card, kp, bs, , root, child] = posts;
  assert.equal(kp.body.properties.觀念複習卡.relation[0].id, pageId(newIds.card["松鼠・字詞"]));
  assert.equal(bs.body.properties.知識點.relation[0].id, newIds.kp["c-h-4a-7-1-K1"]);
  assert.equal(child.body.properties.母題.relation[0].id, newIds.q["CH4-0065"]);
  assert.equal(root.body.properties.母題, undefined);
  assert.ok(!newIds.card["松鼠・字詞"].includes("-"), "卡片 id 去連字號（ids.json 慣例）");
  assert.equal(card.body.properties.狀態.select.name, "草稿");
  assert.ok([kp, bs, root, child].every((c) => c.body.properties.狀態.select.name === "待審"));
  assert.equal(card.body.children.length, 8);
  assert.equal(m.calls.filter((c) => c.method === "PATCH" && c.path.startsWith("/blocks/")).length, 1, "結構 JSON 更新一次");
  assert.equal(m.calls.filter((c) => c.method === "PATCH" && c.path === `/pages/${BOOK}`).length, 1, "結構有改 → 題本最後更新日期改一次");
});

test("dry-run：照樣查重與轉換、算筆數，但不建頁、不改結構", async () => {
  const m = mockApi();
  const newIds = {};
  const { summary } = await run({ api: m.api, execute: false, newIds });
  assert.equal(m.created(), 0);
  assert.equal(m.calls.filter((c) => c.method === "PATCH").length, 0);
  assert.deepEqual(summary.map((s) => s.create), [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(Object.values(newIds).flatMap(Object.keys), [], "dry-run 不產出真 id");
});

test("查重：Notion 已有同鍵的列只補記 id 不重建（中斷後重跑）；同鍵兩列就停", async () => {
  const kpId = "41bb1f9d-7e45-81e4-a203-ed58a3c1d779";
  const m = mockApi({ existing: { kp: [["c-h-4a-7-1-K1", kpId]] } });
  const newIds = {};
  const { summary } = await run({ api: m.api, newIds });
  assert.equal(newIds.kp["c-h-4a-7-1-K1"], kpId);
  assert.deepEqual(summary[1], { label: "知識點", create: 0, adopt: 1 });
  const dup = mockApi({ existing: { q: [["CH4-0065", kpId], ["CH4-0065", BOOK]] } });
  await assert.rejects(run({ api: dup.api }), /重複的列/);
});

test("ids.json 已有的列（gen.py 略過）不會再送", async () => {
  const ids = baseIds();
  ids.card["松鼠・字詞"] = "3fdb1f9d7e45814bb4e7d1a9aaf1a263";
  const m = mockApi();
  await run({ api: m.api, ids });
  assert.equal(m.calls.filter((c) => c.path === "/pages" && DS_TABLE[c.body.parent.data_source_id] === "card").length, 0);
});

test("沒給關卡範圍就停（避免舊批沒記 id 的子題被重建）", async () => {
  await assert.rejects(run({ api: mockApi().api, payload: { ...basePayload(), levels: [] } }), /關卡範圍/);
});

test("寫入後回讀不符就停", async () => {
  await assert.rejects(run({ api: mockApi({ tamper: "題幹" }).api }), /回讀不符：題幹/);
});

test("建立失敗就停，已建的 id 仍留在 newIds", async () => {
  const m = mockApi();
  let i = 0;
  const api = async (method, path, body) => (method === "POST" && path === "/pages" && ++i === 3 ? { ok: false, status: 502, json: {} } : m.api(method, path, body));
  const newIds = {};
  await assert.rejects(run({ api, newIds }), /5xx 可能其實已建立/);
  assert.equal(Object.keys(newIds.card).length + Object.keys(newIds.kp).length, 2);
});

test("結構 JSON：國語島缺 unit 擋下；內文不是恰一個程式碼區塊擋下；已是最新不改", async () => {
  const gen = (w, ids, code) => (w === "structure" ? { islands: [{ id: "7", name: "x", levels: [] }] } : fakeGen(w, ids, code));
  await assert.rejects(writeStructure({ code: "c-h-4a", ids: baseIds(), gen, api: mockApi().api, execute: true, log: quiet }), /缺 unit/);
  const two = mockApi({ blocks: [{ id: "a", type: "code", code: { rich_text: [] } }, { id: "b", type: "code", code: { rich_text: [] } }] });
  await assert.rejects(writeStructure({ code: "c-h-4a", ids: baseIds(), gen: fakeGen, api: two.api, execute: true, log: quiet }), /恰有 1 個/);
  const same = mockApi({ blocks: [{ id: "a", type: "code", code: { rich_text: [{ plain_text: JSON.stringify(fakeGen("structure")) }] } }] });
  await writeStructure({ code: "c-h-4a", ids: baseIds(), gen: fakeGen, api: same.api, execute: true, log: quiet });
  assert.equal(same.calls.filter((c) => c.method === "PATCH").length, 0);
});

test("mismatches：多選、勾選、數字照型別比", () => {
  assert.deepEqual(mismatches({ 相關課次: '["國L7"]', 格: 2 }, { 相關課次: { type: "multi_select", multi_select: [{ name: "國L7" }] }, 格: { type: "number", number: 2 } }), []);
  assert.deepEqual(mismatches({ 格: 2 }, { 格: { type: "number", number: 3 } }), ["格"]);
});

// ── 指紋與 id 合併 ──
test("指紋 8 碼、同內容同指紋、差一字就不同", () => {
  const plain = Buffer.from(JSON.stringify({ 題幹: "中文內容".repeat(1000) }));
  assert.match(fingerprint(plain), /^[0-9a-f]{8}$/);
  assert.equal(fingerprint(Buffer.from(plain)), fingerprint(plain));
  assert.notEqual(fingerprint(Buffer.from(JSON.stringify({ 題幹: "中文內客".repeat(1000) }))), fingerprint(plain));
});

test("ids 合併：新鍵加入、同鍵同 id（不管連字號）略過、同鍵不同 id 算衝突", () => {
  const ids = { kp: { a: "41bb1f9d-7e45-81e4-a203-ed58a3c1d779" } };
  const r = mergeIds(ids, { kp: { a: "41bb1f9d7e4581e4a203ed58a3c1d779", b: BOOK }, card: { c: "x" } });
  assert.deepEqual(r, { conflicts: [], added: { kp: 1, card: 1 } });
  assert.deepEqual(mergeIds(ids, { kp: { a: BOOK } }).conflicts, ["kp:a"]);
});

// ── 改狀態（promote）──
// Notion 現況＝fakeGen／CARD_PAGE 的應有值寫進去後的樣子；over 可改某列某欄、加多的列
const FULL_IDS = () => ({ book: { "c-h-4a": BOOK }, card: { "松鼠・字詞": "3fdb1f9d7e45814bb4e7d1a9aaf1a263" },
  kp: { "c-h-4a-7-1-K1": "41bb1f9d-7e45-81e4-a203-ed58a3c1d779" }, bs: { "c-h-4a-7-1-B1": "41bb1f9d-7e45-81e4-a203-ed58a3c1d77a" },
  story: { "c-h-4a-7-1": "41bb1f9d-7e45-81e4-a203-ed58a3c1d77b" }, q: { "CH4-0065": "41bb1f9d-7e45-81e4-a203-ed58a3c1d77c", "CH4-0066": "41bb1f9d-7e45-81e4-a203-ed58a3c1d77d" } });
function notionNow({ status = {}, edit = {}, extra = [] } = {}) {
  const ids = FULL_IDS();
  const rows = { card: [CARD_PAGE.properties], kp: fakeGen("kp", ids, null, true), bs: fakeGen("bs", ids, null, true), story: fakeGen("story", ids, null, true),
    q: [...fakeGen("qroot", ids, null, true), ...fakeGen("qchild", ids, null, true)] };
  const key = { card: "卡名", kp: "代碼", bs: "代碼", story: "關卡代碼", q: "題目ID" };
  const pages = {};
  for (const [t, list] of Object.entries(rows)) {
    pages[t] = list.map((r) => r.properties ?? r).concat(extra.filter((e) => e.t === t).map((e) => e.props)).map((props, i) => {
      const k = props[key[t]];
      const p = { ...props, ...(status[k] ? { 狀態: status[k] } : {}), ...(edit[k] ?? {}) };
      return { id: `${t}-${i}-${k}`, properties: echo(toNotionProps(p, SCHEMA[t]).properties) };
    });
  }
  // 卡片表整表讀：另放一張舊批已上架的卡，promote 不該碰它
  pages.card.push({ id: "card-old", properties: echo(toNotionProps({ ...CARD_PAGE.properties, 卡名: "美麗島・字詞", 狀態: "上架" }, SCHEMA.card).properties) });
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    let m;
    if (method === "GET" && (m = path.match(/^\/data_sources\/(.+)$/))) return { ok: true, status: 200, json: { properties: SCHEMA[DS_TABLE[m[1]]] } };
    if (method === "POST" && (m = path.match(/^\/data_sources\/(.+)\/query$/))) return { ok: true, status: 200, json: { results: pages[DS_TABLE[m[1]]], has_more: false } };
    if (method === "PATCH" && path === `/pages/${BOOK}`) return { ok: true, status: 200, json: { properties: echo(body.properties) } };
    if (method === "PATCH" && (m = path.match(/^\/pages\/(.+)$/))) {
      const page = Object.values(pages).flat().find((p) => p.id === m[1]);
      Object.assign(page.properties, echo(body.properties));
      return { ok: true, status: 200, json: page };
    }
    throw new Error(`mock 沒處理 ${method} ${path}`);
  };
  return { api, calls, patches: () => calls.filter((c) => c.method === "PATCH" && c.path !== `/pages/${BOOK}`), dates: () => calls.filter((c) => c.path === `/pages/${BOOK}`) };
}
const promote = (m, over = {}) => runPromote({ payload: basePayload(), ids: FULL_IDS(), gen: fakeGen, api: m.api, execute: true, log: quiet, sleep: async () => {}, ...over });

test("promote dry-run：全批比對通過、算出要改的筆數，一頁都不改", async () => {
  const m = notionNow();
  const { summary } = await promote(m, { execute: false });
  assert.deepEqual(summary.map((s) => [s.label, s.change, s.already]), [["知識點", 1, 0], ["學習盲點", 1, 0], ["故事卡", 1, 0], ["觀念複習卡", 1, 0], ["題目", 2, 0]]);
  assert.equal(m.patches().length, 0);
});

test("promote execute：只改狀態一欄（待審→可用、卡片草稿→上架），不碰舊批卡片", async () => {
  const m = notionNow();
  await promote(m);
  const p = m.patches();
  assert.equal(p.length, 6);
  assert.ok(p.every((c) => Object.keys(c.body.properties).join() === "狀態"));
  assert.deepEqual(p.map((c) => c.body.properties.狀態.select.name), ["可用", "可用", "可用", "上架", "可用", "可用"]);
  assert.ok(!p.some((c) => c.path.endsWith("card-old")));
  const again = await promote(m); // 重跑：全部已是目標狀態
  assert.deepEqual(again.summary.map((s) => s.change), [0, 0, 0, 0, 0]);
  assert.equal(m.dates().length, 1, "題本最後更新日期只在真的改了狀態那一輪改");
});

test("題本最後更新日期：promote 有改才改成當天；結構 JSON 有改才改；回讀不符就停", async () => {
  const m = notionNow();
  await promote(m, { today: "2026-11-22" });
  assert.deepEqual(m.dates().map((c) => c.body.properties.最後更新日期), [{ date: { start: "2026-11-22" } }]);
  const dry = notionNow();
  await promote(dry, { execute: false, today: "2026-11-22" });
  assert.equal(dry.dates().length, 0);
  const s = mockApi();
  await writeStructure({ code: "c-h-4a", ids: baseIds(), gen: fakeGen, api: s.api, execute: true, log: quiet, today: "2026-11-22" });
  assert.deepEqual(s.calls.filter((c) => c.path === `/pages/${BOOK}`).map((c) => c.body.properties.最後更新日期.date.start), ["2026-11-22"]);
  const liar = async (method, path, body) => (path === `/pages/${BOOK}` ? { ok: true, status: 200, json: { properties: { 最後更新日期: { date: { start: "2026-11-20" } } } } } : s.api(method, path, body));
  await assert.rejects(writeStructure({ code: "c-h-4a", ids: baseIds(), gen: (w, i, c) => (w === "structure" ? { islands: [{ id: "7", name: "新", unit: 3, levels: [] }] } : fakeGen(w, i, c)), api: liar, execute: true, log: quiet, today: "2026-11-22" }), /回讀是 2026-11-20/);
  assert.equal(taipeiToday(Date.UTC(2026, 10, 21, 16, 30)), "2026-11-22"); // UTC 16:30＝臺北隔天 00:30
});

test("promote：中斷後重跑只改剩下的", async () => {
  const m = notionNow({ status: { "CH4-0065": "可用" } });
  const { summary } = await promote(m);
  assert.deepEqual(summary.at(-1), { label: "題目", change: 1, already: 1 });
});

test("promote：Notion 內容和 bundle 不同（老師在 Notion 改過）→ 整批一列都不改", async () => {
  const m = notionNow({ edit: { "CH4-0066": { 題幹: "老師改過的題幹" } } });
  await assert.rejects(promote(m), /檢查不通過/);
  assert.equal(m.patches().length, 0);
});

test("promote：Notion 多出 bundle 沒有的列、或狀態不是待審／可用 → 整批不改", async () => {
  const extra = notionNow({ extra: [{ t: "kp", props: { ...fakeGen("kp", FULL_IDS(), null, true)[0].properties, 代碼: "c-h-4a-7-1-K9" } }] });
  await assert.rejects(promote(extra), /檢查不通過/);
  assert.equal(extra.patches().length, 0);
  const stop = notionNow();
  const kpPage = (await stop.api("POST", `/data_sources/${DS.kp}/query`)).json.results[0];
  kpPage.properties.狀態 = { type: "select", select: { name: "停用" } };
  await assert.rejects(promote(stop), /檢查不通過/);
  assert.equal(stop.patches().length, 0);
});
