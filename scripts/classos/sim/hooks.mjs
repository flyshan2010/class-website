/**
 * 週結模擬（只讀）入口：`node --import ./scripts/classos/sim/hooks.mjs scripts/classos/f24-….mjs`
 * 把 f24 對 ./lib/notion.mjs 的匯入換成模擬層（notion-sim.mjs），f24 本體一個字都不改。
 */
import { register } from "node:module";

register("./resolve.mjs", import.meta.url);
