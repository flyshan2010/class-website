/**
 * 115學年度預排腳本（一次性）：
 * 1. 聯絡簿：8/31–1/20、2/11–6/30 每個上課日一筆（排除六日與國定假日），發布=未勾
 * 2. 班級週報：四上/四下各週一筆（週次格式：四上第一週(8/31-9/4)），狀態=草稿
 * 3. 常用網站：封存舊示範連結、批次建立新分類清單
 * 用法：NOTION_TOKEN=ntn_xxx node scripts/seed-115.mjs
 */
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("缺少 NOTION_TOKEN"); process.exit(1); }

const DS = {
  contactbook: "12825acc-e6b6-4273-afdf-a505f6b36ad3",
  weekly: "dcb8db22-0533-4ffc-8662-a9a9eef22eda",
  links: "3c3bf383-49b4-4492-9e65-f4d36ce62ef4",
};

const api = async (path, method, body) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") || 2) * 1000;
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }
  throw new Error("重試多次仍失敗");
};

const createPage = (dsId, properties) =>
  api("/pages", "POST", { parent: { type: "data_source_id", data_source_id: dsId }, properties });

const t = s => ({ title: [{ text: { content: s } }] });
const rt = s => ({ rich_text: [{ text: { content: s } }] });
const sel = s => ({ select: { name: s } });

// ── 115學年度國定假日（已查證：2026下半年＋2027 政府行事曆）──
const HOLIDAYS = new Set([
  "2026-09-25", // 中秋節（五）
  "2026-09-28", // 教師節（一）
  "2026-10-09", // 國慶日補假（10/10 六）
  "2026-10-26", // 光復節補假（10/25 日）
  "2026-12-25", // 行憲紀念日（五）
  "2027-01-01", // 元旦（五）
  "2027-03-01", // 和平紀念日補假（2/28 日）
  "2027-04-05", // 清明節（一）
  "2027-04-06", // 兒童節補假（4/4 日）
  "2027-04-30", // 勞動節補假（5/1 六）
  "2027-06-09", // 端午節（三）
]);

const SEMESTERS = [
  { name: "四上", start: "2026-08-31", end: "2027-01-20" },
  { name: "四下", start: "2027-02-11", end: "2027-06-30" },
];

const D = s => new Date(s + "T00:00:00");
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
const WD = "日一二三四五六";

// ── 1. 聯絡簿上課日 ──
function schoolDays() {
  const days = [];
  for (const sem of SEMESTERS) {
    for (let d = D(sem.start); d <= D(sem.end); d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      if (HOLIDAYS.has(iso(d))) continue;
      days.push({ date: iso(d), label: `${md(d)}（${WD[dow]}）` });
    }
  }
  return days;
}

// ── 2. 週次 ──
const NUM = "零一二三四五六七八九";
const cnum = n => {
  if (n <= 10) return n === 10 ? "十" : NUM[n];
  if (n < 20) return "十" + NUM[n % 10];
  return NUM[Math.floor(n / 10)] + "十" + (n % 10 ? NUM[n % 10] : "");
};

function weeks() {
  const out = [];
  for (const sem of SEMESTERS) {
    const start = D(sem.start), end = D(sem.end);
    // 該週的星期一
    const mon = new Date(start);
    mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    let n = 1;
    for (let w = new Date(mon); w <= end; w.setDate(w.getDate() + 7), n++) {
      const fri = new Date(w); fri.setDate(fri.getDate() + 4);
      const from = w < start ? start : w;
      const to = fri > end ? end : fri;
      out.push({
        title: `${sem.name}第${cnum(n)}週(${md(from)}-${md(to)})`,
        range: `${from.getFullYear()}/${String(from.getMonth() + 1).padStart(2, "0")}/${String(from.getDate()).padStart(2, "0")} ～ ${to.getFullYear()}/${String(to.getMonth() + 1).padStart(2, "0")}/${String(to.getDate()).padStart(2, "0")}`,
      });
    }
  }
  return out;
}

// ── 3. 常用網站 ──
const OLD_LINK_PAGES = [ // 舊示範連結（教育局保留）
  "394b1f9d-7e45-8146-8cb4-c1d617459d97", // 因材網
  "394b1f9d-7e45-8183-a0f7-d4cfdd9bd647", // 均一
  "394b1f9d-7e45-8106-8d3c-e13c54b604eb", // PaGamO
  "394b1f9d-7e45-811a-810d-ef34c06b62f8", // 國語辭典
];

const LINKS = [
  // 工具網站
  ["國字筆順學習網", "https://stroke-order.learningweb.moe.edu.tw/home.do", "工具網站", "✍️", ""],
  ["教育部成語典", "https://dict.idioms.moe.edu.tw/", "工具網站", "📚", ""],
  ["教育部國語小字典", "https://dict.mini.moe.edu.tw/", "工具網站", "🔤", "1-4年級用"],
  ["教育部《國語辭典簡編本》", "https://dict.concised.moe.edu.tw/", "工具網站", "📖", "語文教學用"],
  ["雄-筆順練習", "https://gsyan888.github.io/html5_fun/html5_stroke_parts/html5_stroke_parts.html", "工具網站", "🖌️", "筆順練習"],
  ["教育部重編國語辭典修訂本", "https://dict.revised.moe.edu.tw/index.jsp", "工具網站", "📕", "歷史語言辭典，主要記錄語言使用歷程，適用對象為語文研究者"],
  ["MangaChat漫畫日記", "https://studio.mangachat.co/", "工具網站", "💬", "可以打字創造四格漫畫"],
  ["小學堂", "https://xiaoxue.iis.sinica.edu.tw/", "工具網站", "🀄", "文字字體教學"],
  // 閱讀平台
  ["HyRead ebook 臺南市立圖書館", "https://tnml.ebook.hyread.com.tw/", "閱讀平台", "📱", "電子書平台，支援電腦、iPhone/iPad、Android"],
  ["教育雲電子書", "https://oidcebook.nlpi.edu.tw/", "閱讀平台", "📘", ""],
  ["布可星球", "https://read.tn.edu.tw/", "閱讀平台", "🪐", "臺南市閱讀認證平台"],
  ["Hami書城", "https://www.hamibook.com.tw/Homes/book", "閱讀平台", "🏬", "可用 OpenID 登入免費閱讀"],
  ["得報 NEWSY365", "https://newsy365.com/", "閱讀平台", "📰", "專為國中小學生設計的閱讀平台，涵蓋國際、地方、科技、商業新聞"],
  // 自學平台
  ["均一教育平台", "https://www.junyiacademy.org/", "自學平台", "📐", ""],
  ["學習吧", "https://www.learnmode.net/home/", "自學平台", "💡", ""],
  ["教育部因材網", "https://adl.edu.tw/HomePage/home/", "自學平台", "🧠", ""],
  ["樹林國小-民主表達（教學指引）", "https://sites.google.com/view/sules-democracy/%E9%A6%96%E9%A0%81", "自學平台", "🗳️", "宣導"],
  ["114-數學小遊戲：數N題練習", "https://sites.google.com/csps.tyc.edu.tw/mathgame/%E6%95%B8n%E9%A1%8C%E7%B7%B4%E7%BF%92", "自學平台", "🎲", "可練九九乘法、基礎心算"],
  ["雄 HTML5 FUN：PARTDLE 兜一兜", "https://gsyan888.blogspot.com/2024/06/html5-fun-partdle.html", "自學平台", "🧩", "中文語詞部件的組合遊戲"],
  ["識字金銀島", "https://pair-learn.nknu.edu.tw/", "自學平台", "🏝️", ""],
  // 休閒娛樂
  ["因雄崛起", "https://adl.edu.tw/hero/", "休閒娛樂", "🦸", "教育部因材網答題遊戲：獲得金幣、打敗魔王"],
  ["PaGamO", "https://www.pagamo.org/", "休閒娛樂", "🎮", "答題佔領土的遊戲學習平台"],
  ["Mamakid.AI", "https://mamakid.ai/web/", "休閒娛樂", "🤖", "專為學生與兒童設計的 AI 對話式搜索引擎，過濾不當內容"],
  ["國語日報學習頻道", "https://youtube.com/@learning-mdnkids", "休閒娛樂", "📺", "YouTube 頻道"],
  ["國語日報副刊．課外小學堂", "https://youtube.com/channel/UCZiXdc5Rbg0XMuldF7xyyYA", "休閒娛樂", "🗞️", "全文標註注音的中文報紙，含兒童、生活、故事、語文版"],
  ["時空學園：素養解題卡片遊戲", "https://sites.google.com/aiv.com.tw/time-warrior-academy/", "休閒娛樂", "⏳", "與因材網合作的自學網站"],
  ["公共圖書館區域資源中心電影院", "https://ncl.app.visionmedia.com.tw/video", "休閒娛樂", "🎬", ""],
  // 班級事務
  ["學生成績查詢系統", "https://script.google.com/macros/s/AKfycbxwY60Hok2veNzHyvhiM3oQSFenhZyVLpbRgqbzkclIRDCWVof7D1T3To", "班級事務", "💯", "⚠️ 網址不完整，請老師在「網址」欄貼上完整連結"],
];

// ── 執行 ──
const mode = process.argv[2] || "all";

if (mode === "all" || mode === "contactbook") {
  const days = schoolDays();
  console.log(`聯絡簿預排：共 ${days.length} 個上課日`);
  let i = 0;
  for (const d of days) {
    await createPage(DS.contactbook, { "標題": t(d.label), "日期": { date: { start: d.date } } });
    if (++i % 20 === 0) console.log(`  …${i}/${days.length}`);
  }
  console.log(`✅ 聯絡簿 ${days.length} 筆完成`);
}

if (mode === "all" || mode === "weekly") {
  const ws = weeks();
  console.log(`週報預排：共 ${ws.length} 週`);
  for (const w of ws) {
    await createPage(DS.weekly, { "週次": t(w.title), "日期區間": rt(w.range), "狀態": sel("草稿") });
  }
  console.log(`✅ 週報 ${ws.length} 筆完成`);
}

if (mode === "all" || mode === "links") {
  for (const id of OLD_LINK_PAGES) {
    await api(`/pages/${id}`, "PATCH", { in_trash: true }).catch(e => console.warn(`封存 ${id} 失敗：${e.message}`));
  }
  console.log("✅ 舊示範連結已封存");
  for (const [name, url, cat, icon, note] of LINKS) {
    const props = { "名稱": t(name), "網址": { url }, "分類": sel(cat), "圖示": rt(icon) };
    if (note) props["備註"] = rt(note);
    await createPage(DS.links, props);
  }
  console.log(`✅ 常用網站 ${LINKS.length} 筆完成`);
}
console.log("🎉 預排全部完成");
