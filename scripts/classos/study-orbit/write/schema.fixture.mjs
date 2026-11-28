// 自學星圖五張表的 schema（只列寫入會用到的欄；欄名與欄型照 2026-11-21 Notion 實查）——離線測試與本機演練共用
const sel = (...names) => ({ type: "select", select: { options: names.map((name) => ({ name })) } });
const T = { type: "title" }, R = { type: "rich_text" }, N = { type: "number" }, REL = { type: "relation" };
export const SCHEMA = {
  card: { 卡名: T, 科目: sel("國語", "數學", "社會"), 學年: sel("115", "116"), 年級學期: sel("4上", "4下"),
    相關課次: { type: "multi_select", multi_select: { options: [{ name: "國L1" }] } }, 教學頁連結: { type: "url" }, 狀態: sel("草稿", "上架"), 星圖知識點: REL },
  kp: { 代碼: T, 名稱: R, 科目: sel("國語", "數學", "社會"), 題本: REL, 關卡代碼: R, 課本位置: R, 觀念複習卡: REL, 狀態: sel("待審", "可用") },
  bs: { 代碼: T, 卡名: R, 知識點: REL, 關卡代碼: R, 正確的想法: R, 看例子: R, 檢查口訣: R, 狀態: sel("待審", "可用") },
  story: { 關卡代碼: T, 題本: REL, 標題: R, 內文: R, 狀態: sel("待審", "可用") },
  q: { 題目ID: T, 學科: sel("國語"), 年級: sel("4"), 單元: R, 題型: sel("選擇", "配合"), 題幹: R, 選項: R, 正確答案: R, 解析: R,
    難度: sel("易", "中", "難"), 認知層次: sel("理解", "應用", "分析"), 來源: sel("AI生成"), 狀態: sel("待審", "可用"), 盲點: REL, 知識點: REL,
    所屬評量: sel("期中", "期末"), 提示1: R, 提示2: R, 關卡代碼: R, 格: N, 占格: N, 選項盲點: R, 母題: REL, 題組: R, 共用素材: R, 素材類型: sel("文章", "圖表"),
    塔題類: sel("字音", "字義", "字形", "詞義", "情境") },
};
