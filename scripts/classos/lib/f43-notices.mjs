/**
 * f43 的 JSON 切段成 GitHub Actions notice 註記（`::notice title=F43JSON i/N::<片段>`）。
 * 為什麼：雲端排程拿不到 Actions 日誌，但讀得到註記（check-runs/{job}/annotations）。
 * 一個步驟最多 10 則 notice → 最多切 9 段，放不下就加大每段長度。
 * 讀取端照 title 的 i/N 排序接回，段數不齊就丟錯（fail-closed）。
 */
export const NOTICE_TITLE = "F43JSON";
const MAX_PARTS = 9, MIN_SIZE = 1000;
const esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

export function chunks(text) {
  const chars = [...text];
  const size = Math.max(MIN_SIZE, Math.ceil(chars.length / MAX_PARTS));
  const out = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out.length ? out : [""];
}

export function toNotices(text) {
  const cs = chunks(text);
  return cs.map((c, i) => `::notice title=${NOTICE_TITLE} ${i + 1}/${cs.length}::${esc(c)}`);
}
