/**
 * 自學星圖題本寫入｜資料包加密（本機封裝 → 公開 repo 的 so-payload 分支 → workflow 解開）
 *
 * 為什麼要加密：題本內容在私有 repo（classos-private），寫入程式在公開 repo 的 Actions 跑；
 * 待審題目（含答案）不能出現在公開 repo（U42：未上線的內容不進公開處）。
 * 作法：RSA-OAEP(SHA-256) 包一把一次性 AES-256-GCM 金鑰，內容先 gzip 再加密。
 *   公鑰 so-payload.pub.pem 放 repo（兩台電腦都能封裝，本機不必存任何祕密）；
 *   私鑰只在 GitHub Secret SO_PAYLOAD_KEY（與 NOTION_TOKEN 同等級，不外流）。
 * 格式：「SOW1」4 bytes｜金鑰密文長度 2 bytes｜金鑰密文｜iv 12｜tag 16｜密文
 */
import crypto from "node:crypto";
import zlib from "node:zlib";

const MAGIC = Buffer.from("SOW1");

/** 資料包指紋：明文 SHA-256 前 8 碼。dry-run 印出、execute 必須填同一個（防「審過的不是寫進去的」）。 */
export const fingerprint = (plain) => crypto.createHash("sha256").update(plain).digest("hex").slice(0, 8);

export function seal(plain, publicPem) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const ek = crypto.publicEncrypt({ key: publicPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(plain)), c.final()]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(ek.length);
  return Buffer.concat([MAGIC, len, ek, iv, c.getAuthTag(), body]);
}

export function unseal(bin, privatePem) {
  if (!bin.subarray(0, 4).equals(MAGIC)) throw new Error("資料包格式不對（不是 SOW1）");
  const n = bin.readUInt16BE(4);
  let p = 6;
  const ek = bin.subarray(p, (p += n));
  const iv = bin.subarray(p, (p += 12));
  const tag = bin.subarray(p, (p += 16));
  const key = crypto.privateDecrypt({ key: privatePem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, ek);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return zlib.gunzipSync(Buffer.concat([d.update(bin.subarray(p)), d.final()]));
}
