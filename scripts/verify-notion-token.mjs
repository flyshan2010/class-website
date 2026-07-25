/**
 * NOTION_TOKEN 權限探針（Phase F 前置驗證，零相依 Node 18+）
 *
 * 目的：確認 GitHub Secret 裡的 integration token 具備 Phase F 所需的四種能力。
 * 設計原則：
 *   1. 全部可逆 —— 封存後立刻還原、加欄位後立刻移除、建頁後立刻封存。
 *   2. 不印個資 —— 只印能力代號、HTTP 狀態、筆數。不印工作區名、標題、學生姓名。
 *      （本 repo 為 PUBLIC，Actions log 公開可讀。）
 *   3. 探針彼此獨立 —— 單一失敗不中斷後續，最後統一總結。
 *
 * 探針對象刻意選「📥 任務收件匣」：其中 11 筆本來就是待刪的 Phase A 測試資料，
 * 不含學生名冊個資，是最低風險的測試場。
 */

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error("缺少 NOTION_TOKEN 環境變數");
  process.exit(1);
}

const NV = "2025-09-03";
const INBOX_DS = "786b7b36-7361-4277-90a5-ac1818dce3b1"; // 📥 任務收件匣
const PROBE_PROP = "_權限測試";

async function api(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": NV,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 回應 */ }
  return { status: res.status, ok: res.ok, json };
}

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "✅ PASS" : "❌ FAIL"}  ${id} ${name} — ${detail}`);
}

// ── 探針 1：身分與讀取權 ─────────────────────────────
let botOk = false;
try {
  const r = await api("GET", "/users/me");
  botOk = r.ok;
  // 只印 type 與 owner.type，不印 workspace_name（可能含教師姓名）
  const detail = r.ok
    ? `HTTP ${r.status}, type=${r.json?.type}, owner=${r.json?.bot?.owner?.type ?? "?"}`
    : `HTTP ${r.status}, code=${r.json?.code ?? "?"}`;
  record("P1", "身分驗證 (GET /users/me)", r.ok, detail);
} catch (e) {
  record("P1", "身分驗證 (GET /users/me)", false, `例外：${e.message}`);
}

// ── 探針 2：查詢資料源（read content）─────────────────
let probePageId = null;
let titleProp = null;
try {
  const r = await api("POST", `/data_sources/${INBOX_DS}/query`, { page_size: 3 });
  if (r.ok) {
    probePageId = r.json?.results?.[0]?.id ?? null;
    record("P2", "讀取資料 (POST /data_sources/query)", true,
      `HTTP ${r.status}, 取得 ${r.json?.results?.length ?? 0} 筆, has_more=${r.json?.has_more}`);
  } else {
    record("P2", "讀取資料 (POST /data_sources/query)", false,
      `HTTP ${r.status}, code=${r.json?.code ?? "?"}`);
  }
} catch (e) {
  record("P2", "讀取資料 (POST /data_sources/query)", false, `例外：${e.message}`);
}

// ── 探針 3：讀 schema，取得 title 欄位名 ───────────────
try {
  const r = await api("GET", `/data_sources/${INBOX_DS}`);
  if (r.ok) {
    const props = r.json?.properties ?? {};
    titleProp = Object.keys(props).find((k) => props[k]?.type === "title") ?? null;
    record("P3", "讀取 schema (GET /data_sources)", true,
      `HTTP ${r.status}, 欄位數=${Object.keys(props).length}, title 欄位=${titleProp ? "已取得" : "未找到"}`);
  } else {
    record("P3", "讀取 schema (GET /data_sources)", false,
      `HTTP ${r.status}, code=${r.json?.code ?? "?"}`);
  }
} catch (e) {
  record("P3", "讀取 schema (GET /data_sources)", false, `例外：${e.message}`);
}

// ── 探針 4：封存＋還原既有頁（update content / 刪除能力）──
// archived=true 等同進 Notion 垃圾桶；archived=false 立刻還原，全程可逆。
if (probePageId) {
  let trashed = false;
  try {
    const r = await api("PATCH", `/pages/${probePageId}`, { archived: true });
    trashed = r.ok;
    record("P4a", "封存頁面 (PATCH archived=true)", r.ok,
      r.ok ? `HTTP ${r.status}` : `HTTP ${r.status}, code=${r.json?.code ?? "?"}`);
  } catch (e) {
    record("P4a", "封存頁面 (PATCH archived=true)", false, `例外：${e.message}`);
  }
  if (trashed) {
    try {
      const r = await api("PATCH", `/pages/${probePageId}`, { archived: false });
      record("P4b", "還原頁面 (PATCH archived=false)", r.ok,
        r.ok ? `HTTP ${r.status}（已復原，無殘留）` : `HTTP ${r.status} ⚠️ 有一頁停在垃圾桶，需人工還原`);
    } catch (e) {
      record("P4b", "還原頁面 (PATCH archived=false)", false, `例外：${e.message} ⚠️ 需人工還原`);
    }
  }
} else {
  record("P4a", "封存頁面 (PATCH archived=true)", false, "跳過：探針 2 未取得可測頁面");
}

// ── 探針 5：新增頁面（insert content）＋立即封存 ────────
// Phase F 路徑 B「建立全新班級」需要建頁能力。
if (titleProp) {
  let newPageId = null;
  try {
    const r = await api("POST", "/pages", {
      parent: { type: "data_source_id", data_source_id: INBOX_DS },
      properties: { [titleProp]: { title: [{ text: { content: "TOKEN權限探針-可刪" } }] } },
    });
    newPageId = r.ok ? r.json?.id : null;
    record("P5a", "建立頁面 (POST /pages)", r.ok,
      r.ok ? `HTTP ${r.status}` : `HTTP ${r.status}, code=${r.json?.code ?? "?"}`);
  } catch (e) {
    record("P5a", "建立頁面 (POST /pages)", false, `例外：${e.message}`);
  }
  if (newPageId) {
    try {
      const r = await api("PATCH", `/pages/${newPageId}`, { archived: true });
      record("P5b", "清除測試頁 (PATCH archived=true)", r.ok,
        r.ok ? `HTTP ${r.status}（已丟垃圾桶，無殘留）` : `HTTP ${r.status} ⚠️ 測試頁殘留在收件匣，需人工刪`);
    } catch (e) {
      record("P5b", "清除測試頁 (PATCH archived=true)", false, `例外：${e.message} ⚠️ 需人工刪`);
    }
  }
} else {
  record("P5a", "建立頁面 (POST /pages)", false, "跳過：探針 3 未取得 title 欄位名");
}

// ── 探針 6：改 schema 加欄位＋移除（Phase F 加「學年」欄的關鍵能力）──
let propAdded = false;
try {
  const r = await api("PATCH", `/data_sources/${INBOX_DS}`, {
    properties: {
      [PROBE_PROP]: { select: { options: [{ name: "115" }, { name: "116" }] } },
    },
  });
  propAdded = r.ok;
  record("P6a", "新增 select 欄位 (PATCH /data_sources)", r.ok,
    r.ok ? `HTTP ${r.status}` : `HTTP ${r.status}, code=${r.json?.code ?? "?"}`);
} catch (e) {
  record("P6a", "新增 select 欄位 (PATCH /data_sources)", false, `例外：${e.message}`);
}
if (propAdded) {
  try {
    const r = await api("PATCH", `/data_sources/${INBOX_DS}`, {
      properties: { [PROBE_PROP]: null },
    });
    record("P6b", "移除測試欄位 (PATCH properties=null)", r.ok,
      r.ok ? `HTTP ${r.status}（已移除，無殘留）` : `HTTP ${r.status} ⚠️ 收件匣殘留「${PROBE_PROP}」欄位，需人工刪`);
  } catch (e) {
    record("P6b", "移除測試欄位 (PATCH properties=null)", false, `例外：${e.message} ⚠️ 需人工刪`);
  }
}

// ── 總結 ────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
console.log("\n════════ 總結 ════════");
console.log(`探針 ${results.length} 項，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
if (failed.length === 0) {
  console.log("結論：token 具備 Phase F 所需全部能力（讀取／改頁／建頁／刪頁／改 schema）。");
} else {
  console.log("結論：以下能力不足，Phase F 執行引擎需調整 ——");
  for (const f of failed) console.log(`  · ${f.id} ${f.name}：${f.detail}`);
}
// 一律以 0 結束：這是診斷腳本，失敗本身就是有效結果，不需讓 workflow 標紅。
