/**
 * 浮動調價演練入口：`SIM_TODAY=2026-12-25 SIM_STATE=/tmp/x.json node --import ./scripts/classos/sim/price/hooks.mjs scripts/classos/f33-price-draft.mjs`
 * ① 把 f33／f34 的 Notion 層換成 fake-notion.mjs（狀態存在 SIM_STATE 的 JSON，**完全不連 Notion**）
 * ② 把「今天」釘在 SIM_TODAY（台北中午），讓 execute 路徑也能用假日期跑——正式腳本的假日期只准 dry-run。
 */
import { register } from "node:module";
register("./resolve.mjs", import.meta.url);
if (process.env.SIM_TODAY) {
  const fixed = Date.parse(`${process.env.SIM_TODAY}T04:00:00Z`);
  const Real = Date;
  globalThis.Date = class extends Real {
    constructor(...a) { a.length ? super(...a) : super(fixed); }
    static now() { return fixed; }
  };
}
