/**
 * 自學星圖題本寫入｜資料包指紋
 * dry-run 印出、execute 必須填同一個（防「審過的不是寫進去的」）。
 * 資料包不含時間戳，同一個私有 repo commit＋同一組參數＝同一個指紋。
 */
import crypto from "node:crypto";

/** 明文 SHA-256 前 8 碼 */
export const fingerprint = (plain) => crypto.createHash("sha256").update(plain).digest("hex").slice(0, 8);
