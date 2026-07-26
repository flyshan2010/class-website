/**
 * ClassOS Phase F｜🧪 沙盒（SPEC_學年升級 §7）
 *
 * 為何只複製 2 個庫而非 SPEC 原訂的 11 個：
 *   升級精靈實際**寫入**的只有「👥 學生名冊」與「⚙️ 網站設定」兩個庫——
 *   其餘 10 庫是靠既有列的 `學年` 值原地封存＋班網同步過濾達成，精靈根本不碰它們。
 *   因此複製這兩個庫即可演練到 100% 的寫入路徑；多建 9 個空庫不增加任何保障。
 *
 * 沙盒以名稱探測（不落地存 ID）：每次執行都用 /v1/search 找「🧪 Phase F 沙盒」頁，
 * 因此在 GitHub Actions 這種無狀態環境也能跨次執行接續。
 */

import { api, apiOrThrow } from "./notion.mjs";

export const SANDBOX_TITLE = "🧪 Phase F 沙盒";
const PARENT_PAGE = "394b1f9d-7e45-81dc-b65e-c41e587d55ba"; // 🏫 班級經營中心

/**
 * 依標題找沙盒頁。回傳 page id 或 null。
 *
 * ⚠️ 刻意**不用** `/v1/search`——Notion 的搜尋索引是最終一致的，剛建立的頁面查不到，
 *    建立後立刻回讀會誤判成失敗（2026-07-26 實際踩過）。
 *    改列父頁的子區塊，這條路即時一致。
 */
export async function findSandboxPage() {
  let cursor;
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100";
    const r = await apiOrThrow("GET", `/blocks/${PARENT_PAGE}/children${q}`);
    for (const b of r.results ?? []) {
      if (b.type === "child_page" && b.child_page?.title === SANDBOX_TITLE && !b.archived) return b.id;
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return null;
}

/** 列出沙盒頁底下的資料庫：{ 標題 → { databaseId, dataSourceId } } */
export async function sandboxDataSources(pageId) {
  const out = {};
  let cursor;
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100";
    const r = await apiOrThrow("GET", `/blocks/${pageId}/children${q}`);
    for (const b of r.results ?? []) {
      if (b.type !== "child_database") continue;
      const db = await apiOrThrow("GET", `/databases/${b.id}`);
      out[b.child_database.title] = {
        databaseId: b.id,
        dataSourceId: db.data_sources?.[0]?.id ?? null,
      };
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** 沙盒的兩個庫（結構比照正式庫，只保留精靈會用到的欄位）。 */
const SCHEMAS = {
  "👥 學生名冊（沙盒）": {
    姓名: { title: {} },
    座號: { number: {} },
    在學: { checkbox: {} },
    查詢碼: { rich_text: {} },
    學年: { select: { options: [{ name: "115" }, { name: "116" }, { name: "117" }] } },
  },
  "⚙️ 網站設定（沙盒）": {
    項目: { title: {} },
    內容: { rich_text: {} },
  },
  // F12 用：模擬 9 支 skill 各寫一列，驗證「學年」算得對不對
  "🧪 模擬寫入（沙盒）": {
    情境: { title: {} },
    skill: { rich_text: {} },
    來源值: { rich_text: {} },
    預期學年: { rich_text: {} },
    學年: { select: { options: [{ name: "114" }, { name: "115" }, { name: "116" }, { name: "117" }] } },
  },
};

/** 種子資料：3 位學生（含 1 位已非在學，用來驗證精靈只動在學列）＋設定兩列。 */
const SEEDS = {
  "👥 學生名冊（沙盒）": [
    { 姓名: "測試甲", 座號: 1, 在學: true,  查詢碼: "TESTA1", 學年: "115" },
    { 姓名: "測試乙", 座號: 2, 在學: true,  查詢碼: "TESTB2", 學年: "115" },
    { 姓名: "測試丙", 座號: 3, 在學: false, 查詢碼: "TESTC3", 學年: "115" },
  ],
  "⚙️ 網站設定（沙盒）": [
    { 項目: "學年度", 內容: "115學年度" },
    { 項目: "班級",   內容: "四年四班" },
  ],
  "🧪 模擬寫入（沙盒）": [],   // 由 F12 寫入
};

function toProps(schema, row) {
  const p = {};
  for (const [k, v] of Object.entries(row)) {
    const type = Object.keys(schema[k])[0];
    if (type === "title") p[k] = { title: [{ text: { content: String(v) } }] };
    else if (type === "rich_text") p[k] = { rich_text: [{ text: { content: String(v) } }] };
    else if (type === "number") p[k] = { number: Number(v) };
    else if (type === "checkbox") p[k] = { checkbox: Boolean(v) };
    else if (type === "select") p[k] = { select: { name: String(v) } };
  }
  return p;
}

/** 建立沙盒頁＋兩個庫＋種子資料。回傳 { pageId, dbs }。 */
export async function buildSandbox() {
  const page = await apiOrThrow("POST", "/pages", {
    parent: { type: "page_id", page_id: PARENT_PAGE },
    properties: { title: { title: [{ text: { content: SANDBOX_TITLE } }] } },
  });
  console.log(`  ✅ 建立沙盒頁 ${page.id}`);

  const dbs = {};
  for (const [title, properties] of Object.entries(SCHEMAS)) {
    const db = await apiOrThrow("POST", "/databases", {
      parent: { type: "page_id", page_id: page.id },
      title: [{ text: { content: title } }],
      initial_data_source: { properties },
    });
    const dsId = db.data_sources?.[0]?.id;
    dbs[title] = { databaseId: db.id, dataSourceId: dsId };
    console.log(`  ✅ 建立 ${title}（data source ${dsId ? dsId.slice(0, 8) : "?"}）`);

    for (const row of SEEDS[title]) {
      await apiOrThrow("POST", "/pages", {
        parent: { type: "data_source_id", data_source_id: dsId },
        properties: toProps(properties, row),
      });
    }
    console.log(`     ↳ 種子資料 ${SEEDS[title].length} 列`);
  }
  return { pageId: page.id, dbs };
}

/** 整頁刪除沙盒（SPEC §7 規則 3）。頁面層級封存，底下的庫一併消失。 */
export async function teardownSandbox(pageId) {
  return api("PATCH", `/pages/${pageId}`, { archived: true });
}
