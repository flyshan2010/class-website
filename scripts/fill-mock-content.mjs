/**
 * 一次性：依 115 學年度課程計畫，為 42 週週報與 192 天聯絡簿生成模擬內容。
 * 進度來源：翰林國語（四上第七冊/四下第八冊）、翰林數學、康軒社會 C5-1 課程計畫；
 * SEL 採 CASEL 五能力（自我覺察/自我管理/社會覺察/人際關係技巧/負責任的決策）逐週輪替。
 * 會覆蓋先前的「範本佔位文字」；提醒事項保留原有行事曆提醒（12:00 改 12:40）。
 * 用法：NOTION_TOKEN=ntn_xxx node scripts/fill-mock-content.mjs
 */
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("缺少 NOTION_TOKEN"); process.exit(1); }

const DS = {
  contactbook: "12825acc-e6b6-4273-afdf-a505f6b36ad3",
  weekly: "dcb8db22-0533-4ffc-8662-a9a9eef22eda",
};

const api = async (path, method, body) => {
  for (let a = 0; a < 5; a++) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { await new Promise(r => setTimeout(r, Number(res.headers.get("retry-after") || 2) * 1000)); continue; }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }
  throw new Error("重試多次仍失敗");
};

async function queryAll(dsId) {
  const results = [];
  let cursor;
  do {
    const json = await api(`/data_sources/${dsId}/query`, "POST", cursor ? { start_cursor: cursor } : {});
    results.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return results;
}

const text = prop => (prop?.rich_text || prop?.title || []).map(t => t.plain_text).join("");
const rt = s => ({ rich_text: [{ text: { content: s } }] });

// ══════════ 課程進度（依課程計畫）══════════
// 四上 21 週
const CH1 = [
  "第一課〈美麗島〉：詩歌欣賞、堆疊語詞", "第二課〈請到我的家鄉來〉：課文大意與部件歸納",
  "第三課〈鏡頭下的家鄉〉：觀察與描寫", "統整活動一：我愛家鄉單元統整",
  "第四課〈飛行夢〉：想像與夢想", "第五課〈月光下〉：情境描寫",
  "第六課〈又遠又近的月亮〉：說明文閱讀", "統整活動二：天空的奇想單元統整",
  "愛閱讀一〈通信方式大不同〉", "第壹、貳單元複習",
  "第七課〈松鼠先生的麵包〉：品德故事", "第八課〈平凡的大俠〉：人物描寫",
  "第九課〈王子折箭〉：寓意理解", "統整活動三：品德小故事單元統整",
  "第十課〈海中的熱帶雨林〉：海洋生態", "第十一課〈美食島〉：飲食文化",
  "第十二課〈寧靜的音樂會〉：感官摹寫", "統整活動四：海洋世界單元統整",
  "愛閱讀二〈一起去看海〉", "第參、肆單元複習", "第七冊總複習",
];
const CH2 = [
  "第一課〈稻間鴨〉：自然觀察", "第一課〈稻間鴨〉：深究與習寫",
  "第二課〈綠色魔法學校〉：環保綠建築", "第三課〈石虎兄妹〉：生態保育",
  "統整活動一：與自然共處單元統整", "第四課〈阿里棒棒〉：漁村風情",
  "第五課〈快樂兒童日〉：節日與感受", "第六課〈阿公的祕密〉：家人情感",
  "統整活動二：歡樂好時節單元統整", "愛閱讀一〈玫瑰書閱讀日〉",
  "第壹、貳單元複習", "第七課〈棒球英雄夢〉：運動家精神",
  "第八課〈夢幻全壘打〉：敘事寫作", "第九課〈單車遊日月潭〉：遊記",
  "統整活動三：運動樂趣多單元統整", "第十課〈孫悟空三借芭蕉扇〉：古典故事",
  "第十一課〈最後一片葉子〉：世界名著", "第十二課〈閱讀課〉：閱讀策略",
  "統整活動四：好讀故事館單元統整", "愛閱讀二〈拔一條河〉", "第參、肆單元複習",
];
const MA1 = [
  "單元一 一億以內的數：十萬以內、一億以內的數", "單元一 大數的大小比較與加減、練習園地(一)",
  "單元二 乘法：乘以一、二位數與三位數", "單元二 乘法算式的規律、練習園地(二)",
  "單元三 角度：認識量角器、測量與畫角", "單元三 旋轉角與角度計算、練習園地(三)",
  "單元四 假分數與帶分數：認識與互換", "單元四 分數大小比較、分數數線、練習園地(四)",
  "單元五 公里：長度換算、比較與計算", "學習加油讚(一)：綜合與應用",
  "單元六 除法：除以一、二位數", "單元六 除以三位數、多個0的除法、練習園地(六)",
  "單元七 三角形：分類與畫三角形", "單元七 認識全等、練習園地(七)",
  "單元八 兩步驟問題與併式：加與減、乘除與加減", "單元八 乘與除、練習園地(八)",
  "單元九 二位小數：認識百分位與小數化聚", "單元九 長度與小數、小數加減、練習園地(九)",
  "單元十 統計圖表：報讀與製作長條圖", "單元十 折線圖、學習加油讚(二)", "數學園地與全冊總複習",
];
const MA2 = [
  "單元一 概數：生活中的概數、無條件捨去／進入法", "單元一 概數（續）：捨去與進入法練習",
  "單元一 四捨五入法與概數應用、練習園地(一)", "單元二 四則運算：列式與逐步求解、先乘除後加減",
  "單元二 四則運算的性質、練習園地(二)", "單元三 垂直與平行：認識並做出垂直線、平行線",
  "單元三 四邊形家族、練習園地(三)", "單元四 分數(一)：同分母加減、分數的整數倍",
  "單元五 形體的大小：體積與立方公分", "學習加油讚(一)：綜合與應用",
  "單元六 小數乘法：一、二位小數乘以整數", "單元七 周長與面積：長方形與正方形",
  "單元七 平方公尺、複合圖形面積、練習園地(七)", "單元八 分數(二)：等值分數、異分母比較",
  "單元八 異分母加減、分數與小數、練習園地(八)", "單元九 時間的計算：12/24時制與換算",
  "單元九 跨午、跨日的時間計算、練習園地(九)", "單元十 規律：數的規律、奇偶數",
  "單元十 圖案的規律、練習園地(十)", "學習加油讚(二)與繪本數學", "數學園地與全冊總複習",
];
const SO1 = [
  "第一單元 第1課 家鄉在哪裡", "第一單元 第1課 家鄉在哪裡（續）",
  "第一單元 第2課 家鄉的地形", "第一單元 第2課 家鄉的地形（續）",
  "第一單元 第3課 氣候、水資源與生活", "第一單元 第3課 氣候、水資源與生活（續）",
  "第二單元 第1課 傳統住屋與生活", "第二單元 第1課 傳統住屋與生活（續）",
  "第二單元 第2課 器物與生活", "第二單元 第2課 器物與生活（續）",
  "第三單元 第1課 信仰與生活", "第三單元 第1課 信仰與生活（續）",
  "第三單元 第2課 老街與生活", "第三單元 第2課 老街與生活（續）",
  "第四單元 第1課 生活的作息", "第四單元 第1課 生活的作息（續）",
  "第四單元 第2課 傳統的節慶", "第四單元 第3課 現代的節日",
  "第四單元 第3課 現代的節日（續）", "第四單元總複習", "期末評量與全冊複習",
];
const SO2 = [
  "第一單元 第1課 家鄉的農、漁、畜牧業", "第一單元 第1課 家鄉的農、漁、畜牧業（續）",
  "第一單元 第2課 家鄉的工業", "第一單元 第2課 家鄉的工業（續）",
  "第一單元 第3課 家鄉的服務業", "第一單元 第3課 家鄉的服務業（續）",
  "第二單元 第1課 家鄉人口的分布", "第二單元 第1課 家鄉人口的分布（續）",
  "第二單元 第2課 家鄉人口的變化", "第二單元 第2課 家鄉人口的變化（續）",
  "第三單元 第1課 家鄉的運輸", "第三單元 第2課 訊息的傳遞",
  "第三單元 第2課 訊息的傳遞（續）", "第四單元 第1課 家鄉的風貌",
  "第四單元 第1課 家鄉的風貌（續）", "第四單元 第2課 家鄉的特產",
  "第四單元 第2課 家鄉的特產（續）", "第四單元 第3課 愛我家鄉",
  "第四單元 第3課 愛我家鄉（續）", "全冊總複習", "期末評量與複習",
];
// SEL 五能力輪替（CASEL）
const SEL = [
  "SEL自我覺察：情緒溫度計——每天說出自己的心情與原因",
  "SEL自我管理：課前收心操與作業時間規劃",
  "SEL社會覺察：觀察同學的需要，練習換位思考",
  "SEL人際關係技巧：小組討論的傾聽、輪流與讚美",
  "SEL負責任的決策：生活情境選擇題——想一想後果再行動",
];
const ACTIVITIES = [
  "小組共讀與閱讀分享", "班級躲避球練習賽", "教室布置與環境整理", "社區觀察小任務",
  "跳繩闖關挑戰", "美勞創作時間", "班級才藝小舞台", "圖書館借閱日",
];
const HIGHLIGHTS = [
  "多位同學主動幫忙整理教室，值得表揚", "小組合作完成任務，討論越來越有效率",
  "上台發表的同學越來越有自信", "打掃工作認真負責，教室煥然一新",
  "同學間互相教導功課，展現友愛精神", "全班準時完成作業，學習態度進步",
  "下課能自動收拾與預習，自律表現佳", "對新單元充滿好奇，提問踴躍",
];
const PARENTS = [
  "請每日檢查並簽名聯絡簿", "請聽孩子分享本週學到的內容", "請協助檢查學用品是否齊全",
  "天氣多變，請幫孩子準備適當衣物", "請鼓勵孩子每天閱讀 20 分鐘", "請提醒孩子早睡早起，準時到校",
  "假日可帶孩子走訪家鄉景點，呼應社會課程", "請與孩子聊聊班級活動的感受",
];
const BRING = { 1: "直笛", 2: "跳繩", 3: "美勞用具", 4: "課外閱讀書籍", 5: "抹布、室內鞋帶回清洗" };

// ══════════ 週次計算（與 seed-115 相同）══════════
const SEMESTERS = [
  { name: "四上", start: "2026-08-31", end: "2027-01-20" },
  { name: "四下", start: "2027-02-11", end: "2027-06-30" },
];
const NUM = "零一二三四五六七八九";
const cnum = n => n <= 10 ? (n === 10 ? "十" : NUM[n]) : n < 20 ? "十" + NUM[n % 10] : NUM[Math.floor(n / 10)] + "十" + (n % 10 ? NUM[n % 10] : "");
const D = s => new Date(s + "T00:00:00");
const md = d => `${d.getMonth() + 1}/${d.getDate()}`;

function weekList() {
  const out = [];
  for (const [si, sem] of SEMESTERS.entries()) {
    const start = D(sem.start), end = D(sem.end);
    const mon = new Date(start);
    mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    let n = 1;
    for (let w = new Date(mon); w <= end; w.setDate(w.getDate() + 7), n++) {
      const fri = new Date(w); fri.setDate(fri.getDate() + 4);
      const from = w < start ? start : w;
      const to = fri > end ? end : fri;
      out.push({ sem: si, n, title: `${sem.name}第${cnum(n)}週(${md(from)}-${md(to)})`, monday: new Date(w) });
    }
  }
  return out;
}

const weekContent = w => {
  const i = w.n - 1;
  return {
    chinese: (w.sem === 0 ? CH1 : CH2)[i] || "總複習",
    math: (w.sem === 0 ? MA1 : MA2)[i] || "總複習",
    social: (w.sem === 0 ? SO1 : SO2)[i] || "總複習",
    sel: SEL[i % SEL.length],
    activity: ACTIVITIES[i % ACTIVITIES.length],
    highlight: HIGHLIGHTS[i % HIGHLIGHTS.length],
    parent: PARENTS[i % PARENTS.length],
  };
};

// ══════════ 1. 週報 ══════════
async function fillWeekly() {
  // 動態偵測「國語學習重點」欄位實際名稱（可能是 學習重點-國語 或 學習重點）
  const schema = await api(`/data_sources/${DS.weekly}`, "GET");
  const chineseProp = schema.properties["學習重點-國語"] ? "學習重點-國語" : "學習重點";
  console.log(`國語欄位名稱：${chineseProp}`);
  const weeks = weekList();
  const byTitle = Object.fromEntries(weeks.map(w => [w.title, w]));
  const pages = await queryAll(DS.weekly);
  let updated = 0;
  for (const p of pages) {
    const title = text(p.properties["週次"]);
    const w = byTitle[title];
    if (!w) continue;
    const c = weekContent(w);
    await api(`/pages/${p.id}`, "PATCH", {
      properties: {
        [chineseProp]: rt(c.chinese),
        "學習重點-數學": rt(c.math),
        "學習重點-社會": rt(c.social),
        "學習重點-其他": rt(c.sel),
        "班級活動": rt(c.activity),
        "學生亮點": rt(c.highlight),
        "家長配合事項": rt(c.parent),
      },
    });
    if (++updated % 10 === 0) console.log(`  週報 …${updated}`);
  }
  console.log(`✅ 週報模擬內容 ${updated} 筆`);
}

// ══════════ 2. 聯絡簿 ══════════
function homeworkFor(dow, c) {
  switch (dow) {
    case 1: return `國語甲本：${c.chinese}\n數學習作：${c.math}\n閱讀 20 分鐘`;
    case 2: return `國語乙本：${c.chinese}\n數學課本練習：${c.math}\n社會課本預習：${c.social}`;
    case 3: return `國語語詞造句 3 句\n數學練習卷一張\n${c.sel.replace("SEL", "SEL 小任務—")}`;
    case 4: return `國語課文朗讀給家人聽\n數學習作：${c.math}\n社會學習單：${c.social}`;
    case 5: return `國語閱讀心得一句話\n數學：複習本週單元\n週末日記一篇`;
    default: return "";
  }
}

async function fillContactbook() {
  const weeks = weekList();
  const weekOf = date => weeks.findLast(w => {
    const diff = (D(date) - w.monday) / 864e5;
    return diff >= 0 && diff < 7;
  });
  const pages = await queryAll(DS.contactbook);
  const rows = pages.map(p => ({
    id: p.id,
    date: p.properties["日期"]?.date?.start,
    notes: text(p.properties["提醒事項"]),
  })).filter(r => r.date).sort((a, b) => a.date.localeCompare(b.date));

  let updated = 0;
  for (const r of rows) {
    const w = weekOf(r.date);
    if (!w) continue;
    const c = weekContent(w);
    const dow = D(r.date).getDay();
    const props = {
      "作業": rt(homeworkFor(dow, c)),
      "攜帶物品": rt(BRING[dow] || ""),
    };
    // 提醒事項：只把 12:00 修正為 12:40，其餘保留
    if (r.notes.includes("12:00")) props["提醒事項"] = rt(r.notes.replaceAll("中午 12:00 放學", "中午 12:40 放學"));
    await api(`/pages/${r.id}`, "PATCH", { properties: props });
    if (++updated % 30 === 0) console.log(`  聯絡簿 …${updated}`);
  }
  console.log(`✅ 聯絡簿模擬內容 ${updated} 筆`);
}

await fillWeekly();
await fillContactbook();
console.log("🎉 模擬內容生成完成");
