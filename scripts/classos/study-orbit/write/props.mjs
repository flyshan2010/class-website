/**
 * 自學星圖題本寫入｜屬性轉換（gen.py／cards.py 的精簡格式 → Notion 官方 API 格式）
 *
 * 欄位名稱與值一律照 gen.py／cards.py 輸出（那是已驗證的正本），這裡只依「資料表 schema 的欄型」換外殼，
 * 不自己決定任何欄位內容。對不上 schema 的一律丟錯（RULE_Notion操作限制 §5c-4：寫不存在的欄位會被靜默丟掉）。
 */

export const RT_MAX = 1900; // Notion 一段 rich_text 上限 2000 字，留餘裕

/** 長字串切段（不切斷 surrogate pair）。空字串回 []。 */
export function chunks(str, max = RT_MAX) {
  const s = String(str ?? "");
  if (!s) return [];
  const out = [];
  let cur = "";
  for (const ch of s) {
    if (cur.length + ch.length > max) { out.push(cur); cur = ""; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** 純文字 → rich_text 陣列（自動切段）。 */
export const rt = (str) => chunks(str).map((content) => ({ type: "text", text: { content } }));

const HEX32 = /^[0-9a-f]{32}$/i;
/** 頁面 id 正規化成帶連字號的 UUID；不是 32 碼十六進位就丟錯（RULE §5c-1：relation 絕不可拼湊）。 */
export function pageId(raw) {
  const h = String(raw ?? "").replace(/-/g, "");
  if (!HEX32.test(h)) throw new Error(`relation 的頁面 id 格式不對：${String(raw).slice(0, 40)}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toLowerCase();
}

/**
 * 精簡 properties → Notion properties。
 * @param {object} simple  gen.py／cards.py 的 properties
 * @param {object} schema  GET /data_sources/{id} 的 properties
 * @returns {{properties:object, warnings:string[]}}
 */
export function toNotionProps(simple, schema) {
  const properties = {};
  const warnings = [];
  for (const [name, v] of Object.entries(simple)) {
    const def = schema[name];
    if (!def) throw new Error(`欄位「${name}」不在資料表 schema 裡`);
    const optNames = () => (def[def.type]?.options ?? []).map((o) => o.name);
    switch (def.type) {
      case "title": properties[name] = { title: rt(v) }; break;
      case "rich_text": properties[name] = { rich_text: rt(v) }; break;
      case "number": {
        const n = typeof v === "number" ? v : NaN; // RULE §5a：number 要傳真數字，字串一律擋
        if (!Number.isFinite(n)) throw new Error(`欄位「${name}」是 number，值不是數字：${JSON.stringify(v)}`);
        properties[name] = { number: n };
        break;
      }
      case "select": {
        if (v === "" || v == null) { properties[name] = { select: null }; break; }
        // select 不在既有選項＝多半是打錯字，fail-closed（API 會默默新增選項）
        if (!optNames().includes(v)) throw new Error(`欄位「${name}」沒有選項「${v}」`);
        properties[name] = { select: { name: v } };
        break;
      }
      case "status": {
        if (!optNames().includes(v)) throw new Error(`欄位「${name}」沒有狀態「${v}」`);
        properties[name] = { status: { name: v } };
        break;
      }
      case "multi_select": {
        const arr = Array.isArray(v) ? v : String(v ?? "").trim().startsWith("[") ? JSON.parse(v) : v ? [v] : [];
        const known = optNames();
        const fresh = arr.filter((x) => !known.includes(x));
        if (fresh.length) warnings.push(`「${name}」將新增選項：${fresh.join("、")}`);
        properties[name] = { multi_select: arr.map((x) => ({ name: x })) };
        break;
      }
      case "relation": {
        if (!Array.isArray(v)) throw new Error(`欄位「${name}」是 relation，值要是陣列`);
        properties[name] = { relation: v.map((x) => ({ id: pageId(x) })) };
        break;
      }
      case "url": properties[name] = { url: v ? String(v) : null }; break;
      case "checkbox": properties[name] = { checkbox: v === true || v === "__YES__" }; break;
      default: throw new Error(`欄位「${name}」的欄型 ${def.type} 不支援寫入`);
    }
  }
  return { properties, warnings };
}

/** Notion 回傳的屬性 → 可比對的值（回讀用）。 */
export function readBack(prop) {
  if (!prop) return undefined;
  switch (prop.type) {
    case "title": return prop.title.map((t) => t.plain_text).join("");
    case "rich_text": return prop.rich_text.map((t) => t.plain_text).join("");
    case "number": return prop.number;
    case "select": return prop.select?.name ?? "";
    case "status": return prop.status?.name ?? "";
    case "multi_select": return prop.multi_select.map((o) => o.name);
    case "url": return prop.url ?? "";
    case "checkbox": return prop.checkbox;
    default: return undefined; // relation 回傳可能截斷，交給 verify.py 回讀
  }
}

/** 寫入後逐欄比對（文字、數字、選項；relation 交給 verify.py）。回傳不符的欄位名。 */
export function mismatches(simple, returned) {
  const bad = [];
  for (const [name, v] of Object.entries(simple)) {
    const got = readBack(returned?.[name]);
    if (got === undefined) continue;
    let want = v;
    if (Array.isArray(got)) want = Array.isArray(v) ? v : String(v ?? "").trim().startsWith("[") ? JSON.parse(v) : v ? [v] : [];
    else if (returned[name].type === "checkbox") want = v === true || v === "__YES__";
    else if (typeof got === "string") want = v == null ? "" : String(v);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(name);
  }
  return bad;
}

// ── 觀念複習卡內文：cards.py 的 Notion 風格 Markdown → blocks ──
// 只支援卡片實際用到的語法：## 標題、- 項目、1. 編號、<b>粗體</b>、<toggle>摘要＋內容</toggle>、一般段落。
// 不認得的標籤一律丟錯，不默默變成字面文字。

/** 行內：<b>…</b>（或 **…**）→ 粗體 rich_text。 */
export function inline(text) {
  const out = [];
  const re = /<b>([\s\S]*?)<\/b>|\*\*([\s\S]*?)\*\*/g;
  let last = 0, m;
  const push = (s, bold) => {
    for (const content of chunks(s)) out.push({ type: "text", text: { content }, ...(bold ? { annotations: { bold: true } } : {}) });
  };
  while ((m = re.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index), false);
    push(m[1] ?? m[2], true);
    last = re.lastIndex;
  }
  if (last < text.length) push(text.slice(last), false);
  const left = out.map((t) => t.text.content).join("").match(/<\/?[a-z]+[^>]*>/i);
  if (left) throw new Error(`卡片內文有不支援的標籤 ${left[0]}`);
  return out;
}

const blk = (type, text, children) => ({ object: "block", type, [type]: { rich_text: inline(text), ...(children?.length ? { children } : {}) } });

export function mdToBlocks(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const parse = (i, stopAtToggleEnd) => {
    const out = [];
    while (i < lines.length) {
      const line = lines[i].trim();
      if (line === "</toggle>") {
        if (!stopAtToggleEnd) throw new Error("卡片內文多了 </toggle>");
        return [out, i + 1];
      }
      if (!line) { i++; continue; }
      if (line === "<toggle>") {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        const summary = (lines[j] ?? "").trim();
        if (!summary || summary === "</toggle>") throw new Error("toggle 缺摘要行");
        const [kids, next] = parse(j + 1, true);
        out.push(blk("toggle", summary, kids));
        i = next;
        continue;
      }
      let m;
      if ((m = line.match(/^(#{1,3}) (.+)$/))) out.push(blk(`heading_${m[1].length}`, m[2]));
      else if ((m = line.match(/^- (.+)$/))) out.push(blk("bulleted_list_item", m[1]));
      else if ((m = line.match(/^\d+\. (.+)$/))) out.push(blk("numbered_list_item", m[1]));
      else out.push(blk("paragraph", line));
      i++;
    }
    if (stopAtToggleEnd) throw new Error("toggle 沒有 </toggle> 收尾");
    return [out, i];
  };
  const [blocks] = parse(0, false);
  if (blocks.length > 100) throw new Error(`卡片內文 ${blocks.length} 個區塊，超過一次建立上限 100`);
  return blocks;
}
