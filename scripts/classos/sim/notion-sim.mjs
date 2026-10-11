/**
 * 模擬層：讀取走真 Notion API，再疊上情境假資料（只在記憶體）；**任何寫入一律拋錯**。
 */
import * as real from "../lib/notion.mjs";
import { inject } from "./scenarios.mjs";

export const DS = real.DS;
export const isExecute = () => false;
export const forEachThrottled = real.forEachThrottled; // f29 匯入用；dry-run 走不到寫入，真要寫也會被下面的 api 拋錯擋下

export async function queryAll(dsId, body = {}) {
  return inject(dsId, await real.queryAll(dsId, body));
}
export async function api(method, apiPath) {
  throw new Error(`模擬模式禁止寫入：${method} ${apiPath}`);
}
export async function updatePage() {
  throw new Error("模擬模式禁止寫入：updatePage");
}
